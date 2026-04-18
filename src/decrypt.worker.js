// Decrypt worker — runs PBKDF2 + AES off the main thread so the unlock
// button doesn't freeze the UI for ~1s on desktop or several seconds
// on slower devices. crypto-js is loaded lazily via importScripts on
// the first message so the worker boot itself stays cheap.

let cryptoLoaded = false;

function ensureCrypto() {
  if (cryptoLoaded) {
    return;
  }
  // Worker lives in /src/, crypto-js.min.js is at /assets/ — up one level.
  importScripts("../assets/crypto-js.min.js");
  if (!self.CryptoJS?.AES) {
    throw new Error("CryptoJS not available after importScripts");
  }
  cryptoLoaded = true;
}

function isModernPayload(target) {
  return target.kdf === "PBKDF2-SHA256"
    && typeof target.iterations === "number"
    && typeof target.salt === "string"
    && typeof target.iv === "string";
}

function decryptModern(target, password) {
  const salt = self.CryptoJS.enc.Hex.parse(target.salt);
  const iv = self.CryptoJS.enc.Hex.parse(target.iv);
  const ciphertext = self.CryptoJS.enc.Base64.parse(target.ciphertext);
  const key = self.CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: target.iterations,
    hasher: self.CryptoJS.algo.SHA256
  });
  const decryptedBytes = self.CryptoJS.AES.decrypt(
    { ciphertext },
    key,
    {
      iv,
      mode: self.CryptoJS.mode.CBC,
      padding: self.CryptoJS.pad.Pkcs7
    }
  );
  return decryptedBytes.toString(self.CryptoJS.enc.Utf8);
}

function decryptLegacy(ciphertext, password) {
  const decryptedBytes = self.CryptoJS.AES.decrypt(ciphertext, password);
  return decryptedBytes.toString(self.CryptoJS.enc.Utf8);
}

self.onmessage = (event) => {
  const { type, id, target, password } = event.data;

  // Fire-and-forget preload — main thread calls this when the secure
  // panel opens so the importScripts cost happens before the user
  // submits a password.
  if (type === "preload") {
    try {
      ensureCrypto();
      self.postMessage({ type: "preload-result", success: true });
    } catch (error) {
      self.postMessage({
        type: "preload-result",
        success: false,
        error: String(error?.message ?? error)
      });
    }
    return;
  }

  if (type === "decrypt") {
    // phase distinguishes "couldn't load crypto-js" (network/CDN issue)
    // from "decrypted but result was empty / wrong password" so the
    // main thread can show a more useful error message.
    let phase = "init";
    try {
      ensureCrypto();
      phase = "decrypt";
      const plaintext = isModernPayload(target)
        ? decryptModern(target, password)
        : decryptLegacy(target.ciphertext, password);
      if (!plaintext) {
        throw new Error("Decryption produced empty result");
      }
      self.postMessage({ type: "decrypt-result", id, success: true, plaintext });
    } catch (error) {
      self.postMessage({
        type: "decrypt-result",
        id,
        success: false,
        phase,
        error: String(error?.message ?? error)
      });
    }
  }
};
