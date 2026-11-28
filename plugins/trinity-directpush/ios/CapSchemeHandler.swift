import Foundation
import WebKit

/// WKURLSchemeHandler for the `capacitor` scheme, serving assets from the app bundle for the background
/// WKWebView. This mirrors Android's DirectPushWorker.serve() — the same two-prefix dispatch:
///
///   - `capacitor://localhost/__directpush/*` → directpush assets (bg.html, bg-bundle.js)
///   - `capacitor://localhost/*`              → the app's web assets (public/)
///
/// The background WebView registers this handler on its WKWebViewConfiguration, so requests to
/// `capacitor://localhost/…` are intercepted here. The foreground app's WKWebView (Capacitor's own)
/// uses its own scheme handler (WebViewAssetHandler) and is unaffected.
///
/// Callers: BackgroundReader (1 caller — creates the WKWebViewConfiguration with this handler)
class CapSchemeHandler: NSObject, WKURLSchemeHandler {

    /// The directpush-specific path prefix, matching Android's OWN_PREFIX.
    private static let ownPrefix = "/__directpush/"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "CapSchemeHandler", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "No URL"]))
            return
        }

        // Only serve capacitor://localhost
        guard url.scheme == "capacitor", url.host == "localhost" else {
            urlSchemeTask.didFailWithError(NSError(domain: "CapSchemeHandler", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Not localhost"]))
            return
        }

        let path = url.path.isEmpty ? "/" : url.path

        // Resolve to a bundle resource path:
        //   /__directpush/bg.html   → directpush/bg.html   (in the directpush assets folder)
        //   /vendor/fellowship.js   → public/vendor/fellowship.js  (in the app's web assets)
        //   /                       → public/index.html
        let resourcePath: String
        if path.hasPrefix(CapSchemeHandler.ownPrefix) {
            let suffix = String(path.dropFirst(CapSchemeHandler.ownPrefix.count))
            resourcePath = "directpush/" + suffix
        } else {
            resourcePath = "public" + (path == "/" ? "/index.html" : path)
        }

        // Split into directory + filename for Bundle.main.url(forResource:…)
        let nsPath = resourcePath as NSString
        let directory = nsPath.deletingLastPathComponent
        let filename = nsPath.lastPathComponent
        let nameOnly = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension

        guard let fileURL = Bundle.main.url(forResource: nameOnly, withExtension: ext.isEmpty ? nil : ext,
                                             subdirectory: directory.isEmpty ? nil : directory) else {
            NSLog("DIRECTPUSH asset miss \(resourcePath)")
            // Return a 404 response rather than failing the task entirely
            if let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil,
                                               headerFields: ["Content-Type": "text/plain"]) {
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(Data())
                urlSchemeTask.didFinish()
            } else {
                urlSchemeTask.didFailWithError(NSError(domain: "CapSchemeHandler", code: 404,
                    userInfo: [NSLocalizedDescriptionKey: "Asset not found: \(resourcePath)"]))
            }
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let mimeType = Self.mimeType(for: ext)
            let headers: [String: String] = [
                "Content-Type": mimeType,
                "Cache-Control": "no-cache"
            ]
            if let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: headers) {
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            }
        } catch {
            NSLog("DIRECTPUSH asset read error \(resourcePath): \(error.localizedDescription)")
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel — all reads are synchronous from the bundle.
    }

    /// Map file extension to MIME type, matching Android's DirectPushWorker.serve().
    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js":   return "application/javascript"
        case "json": return "application/json"
        case "css":  return "text/css"
        case "svg":  return "image/svg+xml"
        case "png":  return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        default:     return "application/octet-stream"
        }
    }
}
