// End-to-end encryption for My Money.
// Each person has a random data key (AES-GCM 256). It is stored on the server only "wrapped":
// once with a key derived from their passphrase, once with a key derived from their recovery code
// (PBKDF2-SHA256, 310,000 rounds). The server never sees the passphrase, the recovery code or the data key.
window.Vault = (() => {
  const te = new TextEncoder(), td = new TextDecoder();
  const ITER = 310000;
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  function b64(buf) {
    const a = new Uint8Array(buf); let s = "";
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const b = atob(s), a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  const normRec = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normPass = (p) => String(p || "").normalize("NFKC");

  async function kek(secret, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  }
  async function wrapWith(dek, secret) {
    const salt = rand(16), iv = rand(12);
    const k = await kek(secret, salt);
    const w = await crypto.subtle.wrapKey("raw", dek, k, { name: "AES-GCM", iv });
    return { alg: "pbkdf2-sha256/aes-gcm", iter: ITER, salt: b64(salt), iv: b64(iv), key: b64(w) };
  }
  async function unwrapWith(obj, secret, extractable) {
    const k = await kek(secret, unb64(obj.salt));
    return crypto.subtle.unwrapKey("raw", unb64(obj.key), k, { name: "AES-GCM", iv: unb64(obj.iv) }, { name: "AES-GCM", length: 256 }, !!extractable, ["encrypt", "decrypt"]);
  }
  async function lockDown(k) {
    const raw = await crypto.subtle.exportKey("raw", k);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  function newRecoveryCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols: no 0/O or 1/I
    const r = rand(20); let s = "";
    for (let i = 0; i < 20; i++) { s += A[r[i] % 32]; if (i % 4 === 3 && i < 19) s += "-"; }
    return s;
  }

  async function create(passphrase) {
    const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const code = newRecoveryCode();
    const pass = await wrapWith(dek, normPass(passphrase));
    const rec = await wrapWith(dek, normRec(code));
    return { pass, rec, code, key: await lockDown(dek) };
  }
  async function unlock(vaultRow, passphrase) { return unwrapWith(vaultRow.pass, normPass(passphrase), false); }
  async function recover(vaultRow, code, newPassphrase) {
    const dek = await unwrapWith(vaultRow.rec, normRec(code), true);
    return { pass: await wrapWith(dek, normPass(newPassphrase)), key: await lockDown(dek) };
  }
  async function changePass(vaultRow, oldPassphrase, newPassphrase) {
    const dek = await unwrapWith(vaultRow.pass, normPass(oldPassphrase), true);
    return { pass: await wrapWith(dek, normPass(newPassphrase)) };
  }

  async function enc(key, obj) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
    return "v1." + b64(iv) + "." + b64(ct);
  }
  async function dec(key, s) {
    const [v, iv, ct] = String(s).split(".");
    if (v !== "v1") throw new Error("unknown format");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
    return JSON.parse(td.decode(pt));
  }
  async function encBytes(key, buf) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
    const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
    return out;
  }
  async function decBytes(key, buf) {
    const a = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: a.slice(0, 12) }, key, a.slice(12));
  }

  // Remember the unlocked key on this device only (non-extractable, in IndexedDB).
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("mm-vault", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("k");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function saveKey(uid, key) {
    try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction("k", "readwrite"); t.objectStore("k").put(key, uid); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
    catch (_) { return false; }
  }
  async function loadKey(uid) {
    try { const db = await idb(); return await new Promise((res) => { const t = db.transaction("k", "readonly"); const r = t.objectStore("k").get(uid); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); }
    catch (_) { return null; }
  }
  async function forget() {
    try { const db = await idb(); await new Promise((res) => { const t = db.transaction("k", "readwrite"); t.objectStore("k").clear(); t.oncomplete = res; t.onerror = res; }); } catch (_) {}
  }

  return { create, unlock, recover, changePass, enc, dec, encBytes, decBytes, saveKey, loadKey, forget, normRec };
})();
