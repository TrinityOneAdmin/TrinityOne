package com.trinityone.push0spike

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * THROWAWAY Phase-0 spike.
 *
 * Byte-for-byte replica of the storage scheme used by the member app's signing-key plugin,
 * `@aparajita/capacitor-secure-storage` (node_modules/.../android/.../SecureStorage.java):
 *
 *   - SharedPreferences file : "WSSecureStorageSharedPreferences"
 *   - value format           : base64(AES/GCM/NoPadding ciphertext) + '\u0010' + base64(iv)
 *   - AES key                : AndroidKeyStore, alias == the prefixed key, PURPOSE_ENCRYPT|DECRYPT,
 *                              BLOCK_MODE_GCM, ENCRYPTION_PADDING_NONE, 128-bit GCM tag
 *   - Base64 flags           : NO_PADDING | NO_WRAP
 *
 * WHY THIS PROVES P0.3: AndroidKeyStore entries and a SharedPreferences file are scoped to the
 * app's UID. The member app persists its signing key (identity.src.js: ENC_KEY
 * "trinityone.nostr.mnemonic.enc", STORE_KEY "trinityone.nostr.mnemonic", each with the plugin's
 * key prefix) this exact way. A WorkManager worker running INSIDE that same app (same UID) can read
 * it back with the code below WITHOUT any Capacitor JS bridge. This spike runs under its OWN
 * applicationId so it cannot and does not read the owner's real entry (different UID sandbox); it
 * writes a throwaway secret with writeSecret() and reads it back in the worker to prove the native
 * read + inject mechanism end to end. In Phase 1 this same readSecret() ships inside
 * com.trinityone.app and points at the real prefixed alias.
 */
object SecretStoreCompat {
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val SHARED_PREFERENCES = "WSSecureStorageSharedPreferences"
    private const val DATA_IV_SEPARATOR = '\u0010'
    private const val BASE64_FLAGS = Base64.NO_PADDING or Base64.NO_WRAP

    private fun keyStore(): KeyStore =
        KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    private fun getOrCreateSecretKey(alias: String): SecretKey {
        val ks = keyStore()
        val existing = ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build()
        gen.init(spec)
        return gen.generateKey()
    }

    /** Spike-only: write a throwaway secret in the exact plugin format, so readSecret() has something to read. */
    fun writeSecret(ctx: Context, prefixedKey: String, plaintext: String) {
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey(prefixedKey))
        val iv = cipher.iv
        val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val value = Base64.encodeToString(ct, BASE64_FLAGS) +
            DATA_IV_SEPARATOR +
            Base64.encodeToString(iv, BASE64_FLAGS)
        ctx.getSharedPreferences(SHARED_PREFERENCES, Context.MODE_PRIVATE)
            .edit().putString(prefixedKey, value).apply()
    }

    /**
     * The Phase-1 native read path: read the plugin's SharedPreferences value, load the
     * AndroidKeyStore AES key by alias, decrypt. Returns null if the entry is absent.
     */
    fun readSecret(ctx: Context, prefixedKey: String): String? {
        val stored = ctx.getSharedPreferences(SHARED_PREFERENCES, Context.MODE_PRIVATE)
            .getString(prefixedKey, null) ?: return null
        val parts = stored.split(DATA_IV_SEPARATOR)
        if (parts.size != 2) return null
        val ct = Base64.decode(parts[0], BASE64_FLAGS)
        val iv = Base64.decode(parts[1], BASE64_FLAGS)
        val entry = keyStore().getEntry(prefixedKey, null) as? KeyStore.SecretKeyEntry ?: return null
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, entry.secretKey, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
