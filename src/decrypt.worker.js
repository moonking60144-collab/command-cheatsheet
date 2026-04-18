// Decrypt worker — uses Web Crypto (SubtleCrypto) directly so we don't
// ship crypto-js. Supports the current AES-256-CBC payloads and the
// future AES-GCM format (selected via the payload's `encryption` field).
//
// AES-CBC with PKCS7 padding is interoperable with CryptoJS, so existing
// ciphertext in secure-categories.json keeps decrypting correctly.

function hexToBytes(hex) {
  const clean = String(hex ?? "").trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64) {
  const binary = atob(String(b64 ?? "").trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pickAlgorithm(target) {
  // Treat anything with "GCM" in the name as AES-GCM; otherwise default
  // to CBC, which matches both the explicit "AES-256-CBC" label and any
  // older payload that predates the field.
  const label = String(target.encryption ?? "").toUpperCase();
  return label.includes("GCM") ? "AES-GCM" : "AES-CBC";
}

async function deriveKey(password, saltBytes, iterations, algorithm) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: algorithm, length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptPayload(target, password) {
  if (!target.ciphertext || !target.salt || !target.iv || !target.iterations) {
    throw new Error("Missing required decryption fields (salt/iv/iterations/ciphertext)");
  }

  const algorithm = pickAlgorithm(target);
  const saltBytes = hexToBytes(target.salt);
  const ivBytes = hexToBytes(target.iv);
  const ciphertextBytes = base64ToBytes(target.ciphertext);
  const key = await deriveKey(password, saltBytes, target.iterations, algorithm);

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: algorithm, iv: ivBytes },
    key,
    ciphertextBytes
  );

  return new TextDecoder().decode(plaintextBytes);
}

self.onmessage = async (event) => {
  const { type, id, target, password } = event.data;

  // The preload path used to give us time to importScripts(crypto-js).
  // SubtleCrypto is built into the worker global, so there's nothing to
  // load — we still ack so the main thread's preloadDecryptWorker() stays
  // a meaningful signal.
  if (type === "preload") {
    self.postMessage({ type: "preload-result", success: true });
    return;
  }

  if (type === "decrypt") {
    // phase distinguishes "couldn't set up crypto" from "decrypted but
    // result was empty / wrong password" so the main thread can show a
    // more useful error message.
    let phase = "init";
    try {
      phase = "decrypt";
      const plaintext = await decryptPayload(target, password);
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
