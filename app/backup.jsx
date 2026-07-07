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
  const KDF_ITER = 600000;   // OWASP-2023 minimum for PBKDF2-SHA256 (older backups carry their own count)
  async function deriveKey(pass, salt, iter) {
    ensureCrypto();
    const base = await crypto.subtle.importKey('raw', TE.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter || KDF_ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptObj(obj, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, KDF_ITER);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, TE.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 2, app: 'trinityone-backup', kdf: 'PBKDF2-SHA256', iter: KDF_ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) }, null, 0);
  }
  async function decryptStr(str, pass) {
    let env; try { env = JSON.parse(str); } catch { throw new Error('That isn’t a TrinityOne backup file.'); }
    if (!env || env.app !== 'trinityone-backup') throw new Error('That isn’t a TrinityOne backup file.');
    const key = await deriveKey(pass, unb64(env.salt), env.iter || 150000);
    let pt; try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)); }
    catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
    return JSON.parse(TD.decode(pt));
  }

  function snapshot(prefixes) {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && prefixes.some(p => k.startsWith(p))) out[k] = localStorage.getItem(k); }
    return out;
  }
  function restoreLocal(map) { Object.keys(map || {}).forEach(k => { try { localStorage.setItem(k, map[k]); } catch {} }); }

  const MEMBER_PREFIXES = ['trinityone.mydata', 'trinityone.followedChurches', 'trinityone.activeChurch', 'trinityone.reminders', 'trinityone.onboarded', 'trinityone.relays', 'trinityone.dark', 'trinityone.theme', 'trinityone.settings'];
  const STEWARD_PREFIXES = ['trinityone.steward'];

  async function collectMember() {
    let identity = '';
    try { identity = (window.TrinityIdentity && await window.TrinityIdentity.exportMnemonic()) || ''; } catch {}
    return { v: 1, app: 'trinityone', kind: 'member', createdAt: new Date().toISOString(), identity, local: snapshot(MEMBER_PREFIXES) };
  }
  async function applyMember(obj) {
    if (obj.kind && obj.kind !== 'member') throw new Error('That’s a ' + obj.kind + ' backup, not a member backup.');
    if (obj.identity && window.TrinityIdentity && window.TrinityIdentity.importMnemonic) {
      try { await window.TrinityIdentity.importMnemonic(obj.identity); } catch { throw new Error('The backup’s identity phrase is invalid.'); }
    }
    restoreLocal(obj.local);
  }
  function collectSteward() {
    let key = ''; try { key = (window.Steward && window.Steward.exportMnemonic && window.Steward.exportMnemonic()) || ''; } catch {}
    return { v: 1, app: 'trinityone', kind: 'steward', createdAt: new Date().toISOString(), churchKey: key, local: snapshot(STEWARD_PREFIXES) };
  }
  function applySteward(obj) {
    if (obj.kind && obj.kind !== 'steward') throw new Error('That’s a ' + obj.kind + ' backup, not a church backup.');
    if (obj.churchKey && window.Steward && window.Steward.restoreKey) window.Steward.restoreKey(obj.churchKey);
    restoreLocal(obj.local);
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

  window.TrinityBackup = { encryptObj, decryptStr, collectMember, applyMember, collectSteward, applySteward, saveFile, readFile };
})();
