import Foundation
import WebKit
import UserNotifications
import BackgroundTasks

/// The core background reader runner. Mirrors Android's DirectPushWorker.doWork():
///
///   1. Read the member's signing key from the iOS Keychain (KeychainReader).
///   2. Create a WKWebView at `capacitor://localhost` (the app's own origin, sharing localStorage)
///      with CapSchemeHandler registered for the `capacitor` scheme.
///   3. Inject the DPNative bridge shim via WKUserScript (audit RED 1 fix — Android uses @JavascriptInterface).
///   4. Load bg.html, inject the mnemonic on page load, wait for the summary (25s hard timeout).
///   5. On count > 0, post a local notification via UNUserNotificationCenter.
///   6. Destroy the WebView. Report to the BGTask.
///
/// **Content-free boundary:** The notification text is ONLY "You have N new messages". Never includes
/// sender names, message text, group names, or church names.
///
/// **Security:** The mnemonic is in memory only during the WebView's lifetime and is destroyed with it.
/// No relay URLs are added — the reader uses `relaysForChurch()` which is already gated (rule 10).
///
/// Callers: BackgroundRefreshScheduler.handleBGRefresh(_:) (1 caller)
class BackgroundReader: NSObject {

    /// 25-second hard timeout. Apple gives BGAppRefreshTask ~30s; 5s margin for setup/teardown.
    /// Android uses 70s (WorkManager gives 10 min). DO NOT raise this. (Audit RED 2 fix.)
    static let hardTimeoutSeconds: TimeInterval = 25.0

    /// Fixed notification identifier so a newer notification replaces an older one (same as Android's NOTIFY_ID).
    static let notificationIdentifier = "trinityone.directpush.notify"

    /// The origin the background WKWebView serves at — must match the app's foreground origin exactly
    /// for localStorage sharing. Capacitor 6 iOS default = `capacitor://localhost`.
    private static let origin = "capacitor://localhost"
    private static let ownPrefix = "/__directpush/"

    /// Run the background reader. Must be called on the main thread (WKWebView requires it).
    /// Calls `completion` when done (on main thread). The Bool indicates whether a summary was received.
    ///
    /// Callers: BackgroundRefreshScheduler.handleBGRefresh(_:) (1 caller)
    static func run(completion: @escaping (Bool) -> Void) {
        assert(Thread.isMainThread, "BackgroundReader.run must be called on the main thread")

        // ---- Step 1: Read the key natively ----
        guard let keyRec = KeychainReader.readKey() else {
            NSLog("DIRECTPUSH KEYREAD none -> no usable key (PIN install without stay-open, or no identity). Quiet no-op.")
            completion(false)
            return
        }
        let mnemonic = keyRec.mnemonic
        let wordCount = mnemonic.trimmingCharacters(in: .whitespaces).components(separatedBy: .whitespaces).count
        NSLog("DIRECTPUSH KEYREAD ok source=\(keyRec.source) words=\(wordCount) (value never logged)")

        // ---- Step 2: Create the WKWebView ----
        let config = WKWebViewConfiguration()

        // Register our scheme handler for the `capacitor` scheme.
        let schemeHandler = CapSchemeHandler()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "capacitor")

        // Use the default data store so we share localStorage with the foreground app.
        config.websiteDataStore = WKWebsiteDataStore.default()

        // Enable JavaScript and DOM storage.
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        // WKWebpagePreferences for JS: on by default in WKWebView.

        // ---- Step 3: Inject DPNative bridge shim (audit RED 1 fix) ----
        // bg.html calls `window.DPNative.result(json)` — on Android this is a @JavascriptInterface.
        // On iOS WKWebView, DPNative does not exist. The try/catch in bg.html:8 silently swallows the
        // failure, so the reader runs but the summary never reaches native code. Fix: inject before page load.
        let shimScript = WKUserScript(
            source: """
            window.DPNative = {
                result: function(json) { window.webkit.messageHandlers.dpResult.postMessage(json); },
                isDebug: function() { return false; }
            };
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(shimScript)

        // Create the message handler to receive the summary from JS
        let handler = DPResultHandler()
        config.userContentController.add(handler, name: "dpResult")

        // Create a minimal off-screen WKWebView (1x1 — it has no UI)
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)

        // The navigation delegate injects the mnemonic after the page finishes loading
        let navDelegate = BGNavigationDelegate(mnemonic: mnemonic, keySource: keyRec.source, recordPub: keyRec.recordPub)
        webView.navigationDelegate = navDelegate

        // ---- Step 4: Load bg.html and wait for the summary ----
        guard let bgURL = URL(string: "\(origin)\(ownPrefix)bg.html") else {
            NSLog("DIRECTPUSH fatal: could not construct bg.html URL")
            config.userContentController.removeScriptMessageHandler(forName: "dpResult")
            completion(false)
            return
        }
        webView.load(URLRequest(url: bgURL))

        // ---- Step 5: 25s hard timeout (audit RED 2 fix) ----
        var finished = false
        // IMPORTANT: navDelegate is captured here to prevent ARC deallocation. WKWebView holds its
        // navigationDelegate as a WEAK reference; without a strong reference in a surviving closure,
        // the delegate can be collected before didFinish fires, and the mnemonic is never injected.
        let finishOnce: (Bool) -> Void = { [navDelegate] success in
            _ = navDelegate  // prevent "unused capture" warning; the strong ref keeps it alive until cleanup
            guard !finished else { return }
            finished = true

            let summary = handler.summary
            let count = summary?["newSinceCursor"] as? Int ?? 0
            let verdict = summary?["verdict"] as? String ?? (success ? "no-summary" : "timeout")
            NSLog("DIRECTPUSH SUMMARY finished=\(success) verdict=\(verdict) newSinceCursor=\(count)")

            if count > 0 {
                postNotification(count: count)
            }

            // Destroy the WebView
            webView.stopLoading()
            webView.loadHTMLString("", baseURL: nil)
            // Remove the message handler to break the WKScriptMessageHandler → WKUserContentController retain cycle.
            config.userContentController.removeScriptMessageHandler(forName: "dpResult")
            handler.onSummary = nil
            handler.onFatal = nil

            completion(success)
        }

        handler.onSummary = { _ in
            DispatchQueue.main.async { finishOnce(true) }
        }

        handler.onFatal = {
            DispatchQueue.main.async { finishOnce(false) }
        }

        // The hard timeout fires even if no summary arrives (the page may be hung, the REQ may time out,
        // or the expirationHandler may fire). Harvest whatever summary exists.
        DispatchQueue.main.asyncAfter(deadline: .now() + hardTimeoutSeconds) {
            if !finished {
                NSLog("DIRECTPUSH hard timeout (\(hardTimeoutSeconds)s)")
                // Try to harvest the current summary before tearing down
                webView.evaluateJavaScript(
                    "try { window.__dpRep({ stage: 'summary', verdict: 'timeout-ios', newSinceCursor: 0 }); } catch(e) {}"
                ) { _, _ in
                    // Give the message handler a moment to process, then finish
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        finishOnce(false)
                    }
                }
            }
        }
    }

    /// Post a local notification with the message count. Content-free: "You have N new messages".
    /// No names, no text, no group names, no church names.
    ///
    /// Callers: run() (1 call site)
    private static func postNotification(count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "TrinityOne"
        content.body = count == 1 ? "You have 1 new message" : "You have \(count) new messages"
        content.sound = .default
        // Notification tap routing: the app reads userInfo["push"] on tap and navigates to messages.
        content.userInfo = ["push": "msgs"]

        // Use a fixed identifier so newer notifications replace older ones (same as Android's NOTIFY_ID).
        let request = UNNotificationRequest(
            identifier: notificationIdentifier,
            content: content,
            trigger: nil  // deliver immediately
        )

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                NSLog("DIRECTPUSH NOTIFY error: \(error.localizedDescription)")
            } else {
                NSLog("DIRECTPUSH NOTIFY posted generic notification count=\(count)")
            }
        }
    }
}

// MARK: - DPResultHandler (WKScriptMessageHandler)

/// Receives messages from the JS `window.DPNative.result(json)` bridge shim (injected via WKUserScript).
/// Parses the JSON, identifies summary/fatal stages, and notifies BackgroundReader.
///
/// Callers: BackgroundReader.run() (1 caller — registered as script message handler for "dpResult")
private class DPResultHandler: NSObject, WKScriptMessageHandler {
    var summary: [String: Any]?
    var onSummary: (([String: Any]) -> Void)?
    var onFatal: (() -> Void)?

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard let jsonString = message.body as? String else { return }
        guard let data = jsonString.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let stage = obj["stage"] as? String ?? ""

        if stage == "summary" {
            summary = obj
            onSummary?(obj)
        } else if stage == "fatal" {
            NSLog("DIRECTPUSH JS fatal: \(jsonString.prefix(200))")
            onFatal?()
        }
    }
}

// MARK: - BGNavigationDelegate (WKNavigationDelegate)

/// Injects the mnemonic into the page after it finishes loading, mirroring Android's
/// WebViewClient.onPageFinished → evaluateJavascript("window.__dpStart(…)").
///
/// Callers: BackgroundReader.run() (1 caller — set as the WebView's navigationDelegate)
private class BGNavigationDelegate: NSObject, WKNavigationDelegate {
    let mnemonic: String
    let keySource: String
    let recordPub: String

    init(mnemonic: String, keySource: String, recordPub: String) {
        self.mnemonic = mnemonic
        self.keySource = keySource
        self.recordPub = recordPub
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("DIRECTPUSH page finished: \(webView.url?.absoluteString ?? "nil")")
        // Hand the key to the page ONLY now, after the page's own gate-1 read has already run.
        // Quote the mnemonic as a JSON string for safe embedding in JS.
        let mnemonicQuoted = jsonQuote(mnemonic)
        let optsDict: [String: String] = ["source": keySource, "recordPub": recordPub]
        let optsJson = (try? JSONSerialization.data(withJSONObject: optsDict))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let js = "window.__dpStart(\(mnemonicQuoted), \(optsJson));"
        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                NSLog("DIRECTPUSH __dpStart error: \(error.localizedDescription)")
            }
        }
    }

    /// JSON-quote a string for safe embedding in JavaScript source. Escapes backslashes, quotes,
    /// newlines, and other control characters.
    private func jsonQuote(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: s),
              let result = String(data: data, encoding: .utf8) else {
            // Fallback: manual escaping
            let escaped = s.replacingOccurrences(of: "\\", with: "\\\\")
                           .replacingOccurrences(of: "\"", with: "\\\"")
                           .replacingOccurrences(of: "\n", with: "\\n")
                           .replacingOccurrences(of: "\r", with: "\\r")
                           .replacingOccurrences(of: "\t", with: "\\t")
            return "\"\(escaped)\""
        }
        return result
    }
}
