/**
 * Chit Chat — Optional Client-Side End-to-End Encryption (E2EE) Architecture
 * ==========================================================================
 * Implements genuine browser-native cryptography via the Web Crypto API:
 * - Key Agreement: Elliptic Curve Diffie-Hellman (ECDH, P-256 curve)
 * - Symmetric Cipher: AES-GCM (256-bit key, random 96-bit IV per message)
 * - Key Fingerprint: SHA-256 digest of sorted public key coordinates
 */

const PRIVATE_KEY_PREFIX = "chitchat_e2ee_priv_v1_";
const PUBLIC_KEY_PREFIX = "chitchat_e2ee_pub_v1_";

function isWebCryptoAvailable() {
  return Boolean(
    typeof window !== "undefined" &&
      window.crypto &&
      window.crypto.subtle &&
      typeof TextEncoder !== "undefined"
  );
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function ensureUserKeyPair(uid) {
  if (!uid || !isWebCryptoAvailable()) return null;

  const privStorageKey = `${PRIVATE_KEY_PREFIX}${uid}`;
  const pubStorageKey = `${PUBLIC_KEY_PREFIX}${uid}`;

  try {
    const existingPrivRaw = window.localStorage.getItem(privStorageKey);
    const existingPubRaw = window.localStorage.getItem(pubStorageKey);

    if (existingPrivRaw && existingPubRaw) {
      const publicKeyJwk = JSON.parse(existingPubRaw);
      const fingerprint = await computePublicKeyFingerprint(publicKeyJwk);
      return { publicKeyJwk, fingerprint };
    }

    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256"
      },
      true,
      ["deriveKey", "deriveBits"]
    );

    const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

    window.localStorage.setItem(privStorageKey, JSON.stringify(privateKeyJwk));
    window.localStorage.setItem(pubStorageKey, JSON.stringify(publicKeyJwk));

    const fingerprint = await computePublicKeyFingerprint(publicKeyJwk);
    return { publicKeyJwk, fingerprint };
  } catch (err) {
    console.warn("WebCrypto keypair initialization failed:", err);
    return null;
  }
}

export async function rotateUserKeyPair(uid) {
  if (!uid || !isWebCryptoAvailable()) return null;
  window.localStorage.removeItem(`${PRIVATE_KEY_PREFIX}${uid}`);
  window.localStorage.removeItem(`${PUBLIC_KEY_PREFIX}${uid}`);
  return ensureUserKeyPair(uid);
}

export async function computePublicKeyFingerprint(publicKeyJwk) {
  if (!publicKeyJwk || !isWebCryptoAvailable()) return "Unavailable";
  const canonical = `${publicKeyJwk.crv || "P-256"}:${publicKeyJwk.x || ""}:${publicKeyJwk.y || ""}`;
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoded);
  const hashBytes = Array.from(new Uint8Array(hashBuffer)).slice(0, 10);
  return hashBytes
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

async function deriveConversationKey(localUid, peerPublicKeyJwk) {
  const privRaw = window.localStorage.getItem(`${PRIVATE_KEY_PREFIX}${localUid}`);
  if (!privRaw) {
    throw new Error("Local E2EE private key is missing on this device.");
  }
  const privateKeyJwk = JSON.parse(privRaw);

  const privateKey = await window.crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  const peerPublicKey = await window.crypto.subtle.importKey(
    "jwk",
    peerPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: peerPublicKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessageText(plaintext, localUid, peerPublicKeyJwk) {
  const aesKey = await deriveConversationKey(localUid, peerPublicKeyJwk);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    aesKey,
    encoded
  );

  return {
    ciphertext: bufferToBase64(encryptedBuffer),
    iv: bufferToBase64(iv.buffer),
    algorithm: "ECDH-P256-AES256-GCM"
  };
}

export async function decryptMessageText(payload, localUid, peerPublicKeyJwk) {
  if (!payload || !payload.ciphertext || !payload.iv) {
    throw new Error("Invalid encrypted payload.");
  }
  const aesKey = await deriveConversationKey(localUid, peerPublicKeyJwk);
  const ivBuffer = base64ToBuffer(payload.iv);
  const cipherBuffer = base64ToBuffer(payload.ciphertext);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(ivBuffer)
    },
    aesKey,
    cipherBuffer
  );

  return new TextDecoder().decode(decryptedBuffer);
}
