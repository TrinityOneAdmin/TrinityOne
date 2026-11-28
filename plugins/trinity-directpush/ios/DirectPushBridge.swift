import Foundation
import Capacitor

/// Capacitor plugin bridge for iOS Direct Mode Keychain management. Exposes two methods to JS:
///
///   - `writeBgKey()` — reads the mnemonic from the plugin's WhenUnlocked Keychain entries and copies
///     it to a separate entry with AfterFirstUnlock accessibility, so the BGAppRefreshTask reader can
///     access it while the screen is locked. Called from the opt-in toggle (flipDirect in screens-extras.jsx).
///
///   - `deleteBgKey()` — removes the AfterFirstUnlock copy. Called on opt-out, lock, forget, church switch,
///     and new-account (widgetClearChurch / widgetOffForNewAccount in identity.src.js).
///
/// On Android, neither method exists: the Android Keychain (EncryptedSharedPreferences) is always
/// accessible in background, so no copy is needed. The JS calls are wrapped in try/catch and no-op
/// when the plugin is absent.
///
/// Callers (JS): dpBgKeyWrite() in app/screens-extras.jsx (1 call site),
///               dpBgKeyClear() in app/screens-extras.jsx (called from flipDirect, widgetClearChurch,
///               widgetOffForNewAccount — 3 call sites total).
@objc(DirectPushBridge)
public class DirectPushBridge: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DirectPushBridge"
    public let jsName = "DirectPushBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeBgKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteBgKey", returnType: CAPPluginReturnPromise),
    ]

    @objc func writeBgKey(_ call: CAPPluginCall) {
        let ok = KeychainReader.refreshBgCopy()
        NSLog("DIRECTPUSH bridge writeBgKey ok=\(ok)")
        call.resolve(["ok": ok])
    }

    @objc func deleteBgKey(_ call: CAPPluginCall) {
        KeychainReader.deleteBgMnemonic()
        NSLog("DIRECTPUSH bridge deleteBgKey")
        call.resolve()
    }
}
