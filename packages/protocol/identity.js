// Device-identity crypto shared by both ends. The phone holds a persistent
// ECDSA P-256 keypair; on every connection it signs `${token}|${nonce}` so the
// desktop can prove the device possesses the pinned key. We pin a short
// fingerprint of the public key (not the whole JWK) so equality checks are
// trivial and the stored value is opaque.
//
// Uses Web Crypto (`crypto.subtle`), available in browsers, Bun, and Workers.

const enc = new TextEncoder();

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export const challenge = (token, nonce) => `${token || ''}|${nonce || ''}`;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
export function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

/** Stable, opaque fingerprint of a public JWK (sha-256 of its curve point). */
export async function fingerprintJwk(jwk) {
  if (!jwk || !jwk.x || !jwk.y) throw new Error('not an EC public jwk');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${jwk.crv}:${jwk.x}:${jwk.y}`));
  return bytesToB64(new Uint8Array(digest));
}

/** Verify a base64 signature over `challenge(token, nonce)` for a public JWK. */
export async function verifySignature(jwk, sigB64, token, nonce) {
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, b64ToBytes(sigB64), enc.encode(challenge(token, nonce)));
  } catch {
    return false;
  }
}

/** Sign `challenge(token, nonce)` with a private CryptoKey; returns base64. */
export async function signChallenge(privateKey, token, nonce) {
  const sig = await crypto.subtle.sign(SIGN, privateKey, enc.encode(challenge(token, nonce)));
  return bytesToB64(new Uint8Array(sig));
}

export const generateKeyPair = () => crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
export const exportPublicJwk = (publicKey) => crypto.subtle.exportKey('jwk', publicKey);
