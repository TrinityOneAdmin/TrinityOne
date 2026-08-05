// backup.jsx — encrypted file backup/restore for the member app + steward console.
// One passphrase-encrypted file (AES-GCM + PBKDF2 via WebCrypto) holds the recovery key + local data.
// Saved via the OS share sheet (Capacitor Filesystem+Share) so it lands in Drive/OneDrive/Files/etc.
// Restore reads the file back (plain <input type=file>) and re-applies. Exposes window.TrinityBackup.
(function () {
  const TE = new TextEncoder(), TD = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  // WebCrypto is only available in a secure context (https, or localhost). Over plain http on a LAN
  // (e.g. http://192.168.x) crypto.subtle is undefined — give a clear reason, not "importKey of undefined".
  function ensureCrypto() {
    if (!(typeof crypto !== 'undefined' && crypto.subtle)) {
      throw new Error('Backups need a secure connection. Open this over https (your church’s https link) — over plain http the browser disables encryption.');
    }
  }
  const KDF_ITER = 600000;   // legacy PBKDF2-SHA256 iteration count (older backups carry their own count)
  // Import 32 raw bytes as the AES-GCM key.
  async function importAesKey(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  async function pbkdf2Key(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', TE.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter || KDF_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // SECURITY-AUDIT-2026-07-18: prefer memory-hard Argon2id (window.TrinityRecovery.argon2Raw, from noble-hashes)
  // for the derivation. PBKDF2 is GPU-friendly, so a short PIN on a cloud-stored backup would be cheap to
  // brute-force; Argon2id's memory-hardness is what makes a 6-digit PIN actually costly to crack offline. Falls
  // back to PBKDF2 only if the recovery bundle isn't present (so a backup can always be made).
  const haveArgon = () => !!(window.TrinityRecovery && window.TrinityRecovery.argon2Raw);

  // THE FLOOR LIVES HERE, not in the screens. It was stated three different ways across three call sites (6,
  // 6 and 4 characters) and enforced by none of them — encryptObj accepted "" and "a". A screen-level rule is
  // a suggestion; the file is made here.
  //
  // And it is a PASSPHRASE, not a PIN, because of what is inside: this file carries the member's twelve
  // words. Whoever opens it IS them — it unwraps the church's group keys from the relay, so one cracked file
  // opens the congregation's private conversations, not just one person's notes. The app told them to keep it
  // in a cloud drive, where an attacker guesses offline, on their own hardware, for as long as they like. A
  // six-digit PIN is minutes there. Four words are not.
  const PASS_MIN = 12;
  function checkPass(pass) {
    const p = String(pass == null ? '' : pass);
    if (p.length < PASS_MIN) throw new Error('Use a longer passphrase — at least ' + PASS_MIN + ' characters. Four random words is ideal, and easier to remember than a PIN. This file holds your account, so a short code is not enough.');
    if (/^\d+$/.test(p) && p.length < 20) throw new Error('An all-numbers code is quick to guess, even a long one. Add words or letters — four random words is ideal.');
    return p;
  }

  // MEASURED ON A REAL PHONE, and the reason this is NOT raised. An earlier version of this used 64 MiB / t=3
  // to make offline guessing costlier. On an Oppo CPH2477 — mid-range, not the cheapest device this product
  // targets — that took 14.9 SECONDS, against 2.8 seconds for the interactive profile below. Fifteen seconds
  // to save a backup and fifteen more to restore it is not a backup people will make; it pushes them to skip
  // it, and a backup nobody makes protects nobody.
  //
  // It is also the wrong lever. Attacker cost is dominated by the PASSPHRASE, not the KDF: moving from a
  // 6-digit PIN (about a million possibilities) to four random words (tens of trillions) multiplies the work
  // by millions, where 19 MiB → 64 MiB multiplies it by about three. checkPass above is what actually
  // protects this file; this only has to stay memory-hard so a GPU cannot parallelise the guessing cheaply.
  //
  // Note the code comment in src/recovery.src.js estimates ~600ms for this profile — that is a workstation
  // number. The phone is five times slower. Measure on a device before changing it.
  const BACKUP_ARGON = null;   // null → argon2Raw uses ARGON2_DEFAULT (19 MiB / t=2)
  // …and CLAMPED on the way back in, because these come out of an untrusted file. Unbounded, a crafted
  // envelope asking for 4 GiB kills the tab; a carefully-chosen 512 MiB just hangs a cheap phone.
  const clampArgon = (env) => ({
    t: Math.min(Math.max(parseInt(env && env.t, 10) || 2, 1), 8),
    m: Math.min(Math.max(parseInt(env && env.m, 10) || 19456, 8192), 262144),
    p: Math.min(Math.max(parseInt(env && env.p, 10) || 1, 1), 4),
  });

  async function encryptObj(obj, pass) {
    ensureCrypto();
    pass = checkPass(pass);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = TE.encode(JSON.stringify(obj));
    let env;
    if (haveArgon()) {
      const { raw, params } = await window.TrinityRecovery.argon2Raw(pass, salt, BACKUP_ARGON || undefined);
      const key = await importAesKey(raw);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
      env = { v: 2, app: 'trinityone-backup', kdf: 'argon2id', t: params.t, m: params.m, p: params.p, salt: b64(salt), iv: b64(iv), data: b64(ct) };
    } else {
      const key = await pbkdf2Key(pass, salt, KDF_ITER);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
      env = { v: 2, app: 'trinityone-backup', kdf: 'PBKDF2-SHA256', iter: KDF_ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
    }
    return JSON.stringify(env, null, 0);
  }
  async function decryptStr(str, pass) {
    ensureCrypto();
    let env; try { env = JSON.parse(str); } catch { throw new Error('That isn’t a TrinityOne backup file.'); }
    if (!env || env.app !== 'trinityone-backup') throw new Error('That isn’t a TrinityOne backup file.');
    let key;
    if (env.kdf === 'argon2id') {
      if (!haveArgon()) throw new Error('This backup needs the recovery module — reopen the app and try again.');
      const { raw } = await window.TrinityRecovery.argon2Raw(pass, unb64(env.salt), clampArgon(env));
      key = await importAesKey(raw);
    } else {
      key = await pbkdf2Key(pass, unb64(env.salt), env.iter || 150000);   // legacy PBKDF2 backups still restore
    }
    let pt; try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)); }
    catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
    return JSON.parse(TD.decode(pt));
  }

  function snapshot(prefixes) {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && prefixes.some(p => k.startsWith(p))) out[k] = localStorage.getItem(k); }
    return out;
  }
  // AN UNTRUSTED FILE MAY NOT WRITE ANYWHERE IT LIKES. Export filtered by prefix; import filtered by nothing,
  // so a crafted backup could set ANY key — including the one that IS the identity on web/PWA
  // (trinityone.nostr.mnemonic) and the church key's encrypted blob. Worse, the "this will replace your
  // account" warning is keyed on the file's `identity` field, so an attacker simply omitted that field, wrote
  // the seed through `local` instead, and the member saw NO WARNING AT ALL. "Your steward has prepared your
  // restore file, the PIN is 123456" is not a hard sentence to say.
  //
  // Restoring through the same allowlist the export uses closes both: the identity can now only change via
  // the `identity` field, which is exactly what the confirm already guards.
  function restoreLocal(map, allow) {
    const ok = (k) => (allow || []).some(p => String(k).startsWith(p))
      && !/^trinityone\.nostr\.mnemonic/.test(k)    // never the seed, whatever the prefix list says
      // …and never a DEVICE-BOUND key wrap. church-key.enc is bound to the machine that wrote it: on web it is
      // ciphertext only that device's PIN opens, and on native it is merely the MARKER saying the real blob is
      // in this device's hardware store. Restoring another device's copy leaves the steward on "Console locked"
      // holding a PIN that cannot work, or pointing at a Keystore slot that was never written here. The
      // previous code wrote it and then deleted it a line later, which also took THIS device's marker with it —
      // finding K1. Excluding it here is the same rule as the seed, and it fixes old backup files too.
      && !/\.church-key\.enc$/.test(k);
    let skipped = 0;
    Object.keys(map || {}).forEach(k => {
      if (!ok(k)) { skipped++; return; }
      try { localStorage.setItem(k, map[k]); } catch {}
    });
    return skipped;
  }

  const MEMBER_PREFIXES = ['trinityone.mydata', 'trinityone.followedChurches', 'trinityone.activeChurch', 'trinityone.reminders', 'trinityone.onboarded', 'trinityone.relays', 'trinityone.dark', 'trinityone.theme', 'trinityone.settings'];
  const STEWARD_PREFIXES = ['trinityone.steward'];

  async function collectMember() {
    let identity = '';
    try { identity = (window.TrinityIdentity && await window.TrinityIdentity.exportMnemonic()) || ''; } catch {}
    return { v: 1, app: 'trinityone', kind: 'member', createdAt: new Date().toISOString(), identity, local: snapshot(MEMBER_PREFIXES) };
  }
  async function applyMember(obj) {
    // A MISSING `kind` IS NOT CONSENT. `obj.kind &&` treated a file with no kind at all as a member backup.
    if (obj.kind !== 'member') throw new Error(obj.kind ? ('That’s a ' + obj.kind + ' backup, not a member backup.') : 'That file doesn’t say what it is, so it isn’t safe to restore.');
    if (obj.identity && window.TrinityIdentity && window.TrinityIdentity.importMnemonic) {
      try { await window.TrinityIdentity.importMnemonic(obj.identity); } catch { throw new Error('The backup’s identity phrase is invalid.'); }
    }
    restoreLocal(obj.local, MEMBER_PREFIXES);
  }
  function collectSteward() {
    let key = ''; try { key = (window.Steward && window.Steward.exportMnemonic && window.Steward.exportMnemonic()) || ''; } catch {}
    return { v: 1, app: 'trinityone', kind: 'steward', createdAt: new Date().toISOString(), churchKey: key, local: snapshot(STEWARD_PREFIXES) };
  }
  function applySteward(obj) {
    if (obj.kind !== 'steward') throw new Error(obj.kind ? ('That’s a ' + obj.kind + ' backup, not a church backup.') : 'That file doesn’t say what it is, so it isn’t safe to restore.');
    if (obj.churchKey && window.Steward && window.Steward.restoreKey) window.Steward.restoreKey(obj.churchKey);
    // NOT the device-bound wrap — restoreLocal excludes it outright, so the OLD device's blob never lands here
    // and this device's own marker is never disturbed.
    //
    // K1. This used to write the backup's copy and then `removeItem` it on the next line. That removal was
    // unconditional, so it deleted THIS device's marker whether or not the file carried one — and on native the
    // marker is all that points at the hardware store, where the real ciphertext lives untouched. hasEnc() then
    // read false over a key that was still physically present, and a steward who closed the console before
    // setting the new PIN reopened it to "Set up a new church".
    //
    // Nothing needs to be cleared here. restoreKey keeps the seed in memory and sets needsPin; the forced-PIN
    // modal's setPin() overwrites the same slot in both stores. An ABANDONED file restore therefore leaves the
    // previous key intact and openable, which is the same rule cd67c7a established for the phrase path — the
    // steward keeps the church they had instead of losing both.
    restoreLocal(obj.local, STEWARD_PREFIXES.concat([]).filter(Boolean));
  }

  // save the encrypted text. mode 'local' writes a file straight onto the device (no share sheet);
  // mode 'cloud' (default) hands it to the OS so the user can drop it into Drive / OneDrive / Files.
  async function saveFile(filename, text, mode) {
    const Cap = window.Capacitor, P = Cap && Cap.Plugins;
    const native = P && P.Filesystem && Cap.isNativePlatform && Cap.isNativePlatform();
    if (mode === 'local') {
      if (native) {
        const w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8' });
        return { saved: true, where: 'device', uri: w.uri };
      }
      // web/PWA: a download is the on-device equivalent
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { saved: true, where: 'downloads' };
    }
    if (native && P.Share) {
      const w = await P.Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
      await P.Share.share({ title: 'TrinityOne backup', text: 'Save this somewhere safe (Drive, OneDrive…)', url: w.uri });
      return { saved: true, where: 'cloud' };
    }
    try {
      const file = new File([text], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'TrinityOne backup' }); return { saved: true, where: 'cloud' }; }
    } catch {}
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { saved: true, where: 'downloads' };
  }
  const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Couldn’t read that file.')); r.readAsText(file); });

  window.TrinityBackup = { encryptObj, decryptStr, checkPass, PASS_MIN, collectMember, applyMember, collectSteward, applySteward, saveFile, readFile };
})();
