import Foundation
import Security

/// READ-ONLY replica of the storage scheme of `@aparajita/capacitor-secure-storage` on iOS (Plugin.swift),
/// promoted from the Android mirror (SecretStoreCompat.kt). It never writes: the member app is the only
/// writer of these entries.
///
///   - iOS Keychain class  : kSecClassGenericPassword
///   - account (key)       : <plugin prefix "capacitor-storage_"> + app key  (KeychainSwift default: empty keyPrefix)
///   - value format        : plain string (iOS Keychain handles encryption natively — no AES/GCM envelope like Android)
///   - plaintext format    : the plugin JSON-encodes string values before storing, so a JS string sits at rest as its
///                           JSON literal ("..."); entries written by older code are the raw string.
///   - accessibility       : plugin default = kSecAttrAccessibleWhenUnlocked
///
/// ## Gate 0 concern (documented)
///
/// The plugin's default accessibility is `kSecAttrAccessibleWhenUnlocked`. A BGAppRefreshTask that runs
/// while the screen is locked will get `errSecInteractionNotAllowed` (−25308) from SecItemCopyMatching.
/// This means the background reader **cannot read the mnemonic while the device is locked**.
///
/// **Mitigation:** When the user opts in to Direct Mode, the app should copy the mnemonic to a separate
/// Keychain entry with `kSecAttrAccessibleAfterFirstUnlock` accessibility. This reader tries that entry
/// first (the "bg-copy" key), falling back to the plugin's own entry (which works when the screen is on
/// or immediately after unlock). The bg-copy write is NOT in this file — it belongs in the app's opt-in
/// toggle (NotifSettingsScreen, app/screens-extras.jsx via a Capacitor plugin call) or in a small native
/// helper the toggle calls.
///
/// Works only inside com.trinityone.app (same app group) — which is why this is an in-app build.
struct KeychainReader {

    /// identity.src.js STORE_KEY — the PLAINTEXT mnemonic. NOT ENC_KEY (".enc", PIN-encrypted, unreadable here).
    static let mnemonicPrefixedKey = "capacitor-storage_trinityone.nostr.mnemonic"

    /// identity.src.js REMEMBER_KEY — JSON {m, until, pub}: the "Stay open on this phone for 30 days" record.
    static let rememberPrefixedKey = "capacitor-storage_trinityone.nostr.remember"

    /// Background-accessible copy of the mnemonic, written by the opt-in toggle with AfterFirstUnlock accessibility.
    /// This is the ONLY entry the background reader should rely on when the screen is locked.
    static let bgMnemonicKey = "trinityone.directpush.bgmnemonic"

    /// Where the mnemonic came from, for the log only.
    struct Key {
        let mnemonic: String
        let source: String
        let recordPub: String
    }

    /// KEY SOURCE (docs/direct-mode-push-plan.md, "KEY SOURCE"):
    ///   0) the bg-accessible copy (AfterFirstUnlock), if present;
    ///   1) the remember-me record, only while until > now;
    ///   2) else the plaintext mnemonic (no-PIN install);
    ///   3) else nil (PIN-only member declined "stay open" — respected,
    ///      and we never try to decrypt the ".enc" blob: there is no PIN here).
    ///
    /// Callers: BackgroundReader.run() (1 caller)
    static func readKey() -> Key? {
        // 0) Try the background-accessible copy first (AfterFirstUnlock). This is the only
        //    entry guaranteed readable when the screen is locked.
        if let bgMnemonic = readKeychainString(account: bgMnemonicKey) {
            let unwrapped = unwrapPluginJson(bgMnemonic)
            if !unwrapped.trimmingCharacters(in: .whitespaces).isEmpty {
                NSLog("DIRECTPUSH KEYREAD bg-copy ok")
                return Key(mnemonic: unwrapped, source: "bg-copy", recordPub: "")
            }
        }

        // 1) Remember-me record
        var rememberForm = "absent"
        if let raw = readKeychainString(account: rememberPrefixedKey) {
            let unwrapped = unwrapPluginJson(raw)
            rememberForm = (unwrapped != raw) ? "wrapped" : "raw"
            if let data = unwrapped.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let m = obj["m"] as? String ?? ""
                let until = (obj["until"] as? NSNumber)?.int64Value ?? 0
                if !m.trimmingCharacters(in: .whitespaces).isEmpty && until > Int64(Date().timeIntervalSince1970) {
                    NSLog("DIRECTPUSH KEYREAD form remember=\(rememberForm) mnemonic=unread")
                    return Key(mnemonic: m, source: "remember", recordPub: obj["pub"] as? String ?? "")
                }
            }
        }

        // 2) Plaintext mnemonic
        let plain = readKeychainString(account: mnemonicPrefixedKey)
        let mnemonicForm: String
        let result: Key?
        if let plain = plain {
            let unwrapped = unwrapPluginJson(plain)
            mnemonicForm = (unwrapped != plain) ? "wrapped" : "raw"
            result = unwrapped.trimmingCharacters(in: .whitespaces).isEmpty ? nil : Key(mnemonic: unwrapped, source: "plaintext", recordPub: "")
        } else {
            mnemonicForm = "absent"
            result = nil
        }
        NSLog("DIRECTPUSH KEYREAD form remember=\(rememberForm) mnemonic=\(mnemonicForm)")
        return result
    }

    /// One layer of the plugin's JSON encoding off (see "plaintext format" above). Only a leading '"' can be a
    /// wrapped value — BIP39 words and a raw {...} record never start with one — and any parse failure, or a
    /// non-string result, returns the input unchanged.
    private static func unwrapPluginJson(_ s: String) -> String {
        guard s.hasPrefix("\"") else { return s }
        guard let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? String else {
            return s
        }
        return obj
    }

    /// Read a single string from the iOS Keychain by account name. Returns nil when the entry is absent
    /// or unreadable (locked screen with WhenUnlocked accessibility, or other SecItem error).
    ///
    /// Callers: readKey() (3 call sites within this file)
    private static func readKeychainString(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound {
                NSLog("DIRECTPUSH Keychain read \(account) status=\(status)")
            }
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// Write the mnemonic to the background-accessible Keychain entry. Called from the app's foreground
    /// opt-in toggle (once, when the user enables Direct Mode). Uses kSecAttrAccessibleAfterFirstUnlock
    /// so the background reader can access it even when the screen is locked.
    ///
    /// Callers: the opt-in toggle in NotifSettingsScreen (via a Capacitor bridge call, not yet wired)
    static func writeBgMnemonic(_ mnemonic: String) -> Bool {
        guard let data = mnemonic.data(using: .utf8) else { return false }

        // Delete any existing entry first
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: bgMnemonicKey
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: bgMnemonicKey,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            NSLog("DIRECTPUSH writeBgMnemonic status=\(status)")
        }
        return status == errSecSuccess
    }

    /// Remove the background-accessible mnemonic copy. Called on opt-out, lock, forget, or church switch.
    ///
    /// Callers: the opt-out path, widgetClearChurch equivalent on iOS (not yet wired)
    static func deleteBgMnemonic() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: bgMnemonicKey
        ]
        SecItemDelete(query as CFDictionary)
    }
}
