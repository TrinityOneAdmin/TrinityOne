package church.trinityone.directpush

import android.content.Context
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/**
 * READ-ONLY replica of the storage scheme of `@aparajita/capacitor-secure-storage` (SecureStorage.java), promoted
 * from spikes/push0. It never writes: the member app is the only writer of these entries.
 *
 *   - SharedPreferences file : "WSSecureStorageSharedPreferences"
 *   - preference key         : <plugin prefix "capacitor-storage_"> + app key
 *   - value format           : base64(AES/GCM/NoPadding ciphertext) + '\u0010' + base64(iv)
 *   - AES key                : AndroidKeyStore, alias == the prefixed key, 128-bit GCM tag
 *   - Base64 flags           : NO_PADDING | NO_WRAP
 *
 * Works only inside com.trinityone.app (same UID as the writer) — which is why Commit 1 is an in-app build.
 */
object SecretStoreCompat {
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val SHARED_PREFERENCES = "WSSecureStorageSharedPreferences"
    private const val DATA_IV_SEPARATOR = '\u0010'
    private const val BASE64_FLAGS = Base64.NO_PADDING or Base64.NO_WRAP

    /** identity.src.js STORE_KEY — the PLAINTEXT mnemonic. NOT ENC_KEY (".enc", PIN-encrypted, unreadable here). */
    const val MNEMONIC_PREFIXED_KEY = "capacitor-storage_trinityone.nostr.mnemonic"

    /** identity.src.js REMEMBER_KEY — JSON {m, until, pub}: the "Stay open on this phone for 30 days" record. */
    const val REMEMBER_PREFIXED_KEY = "capacitor-storage_trinityone.nostr.remember"

    /** Where the mnemonic came from, for the log only. */
    data class Key(val mnemonic: String, val source: String)

    /**
     * KEY SOURCE (docs/direct-mode-push-plan.md, "KEY SOURCE"): 1) the remember-me record, only while until > now;
     * 2) else the plaintext mnemonic (no-PIN install); 3) else null (PIN-only member declined "stay open" — respected,
     * and we never try to decrypt the ".enc" blob: there is no PIN here).
     */
    fun readKey(ctx: Context): Key? {
        try {
            val r = readSecret(ctx, REMEMBER_PREFIXED_KEY)
            if (r != null) {
                val o = org.json.JSONObject(r)
                val m = o.optString("m", "")
                val until = o.optLong("until", 0L)
                if (m.isNotBlank() && until > System.currentTimeMillis() / 1000) return Key(m, "remember")
            }
        } catch (e: Throwable) {
            android.util.Log.w("DIRECTPUSH", "remember record unreadable: ${e.javaClass.simpleName}")
        }
        val plain = readSecret(ctx, MNEMONIC_PREFIXED_KEY)
        return if (!plain.isNullOrBlank()) Key(plain, "plaintext") else null
    }

    /** Returns null when the entry is absent (PIN install, or not yet created). Throws on a real decrypt failure. */
    fun readSecret(ctx: Context, prefixedKey: String): String? {
        val stored = ctx.getSharedPreferences(SHARED_PREFERENCES, Context.MODE_PRIVATE)
            .getString(prefixedKey, null) ?: return null
        val parts = stored.split(DATA_IV_SEPARATOR)
        if (parts.size != 2) return null
        val ct = Base64.decode(parts[0], BASE64_FLAGS)
        val iv = Base64.decode(parts[1], BASE64_FLAGS)
        val ks = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val entry = ks.getEntry(prefixedKey, null) as? KeyStore.SecretKeyEntry ?: return null
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, entry.secretKey, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
