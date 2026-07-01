// Persistent device identity for this phone. A non-exportable-in-practice ECDSA
// keypair is generated once and kept in IndexedDB (CryptoKey objects survive
// reloads without ever serializing the private key). On each tether connection
// the phone signs the host's challenge so the desktop can pin this device and
// reject any other — the second factor behind the URL token.

import { Provider } from '@3sln/ngin';
import { generateKeyPair, exportPublicJwk, signChallenge } from '@bridle/protocol/identity';

const DB = 'bridle';
const STORE = 'identity';
const KEY = 'device-keypair';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idb(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(out?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

class Identity {
  constructor() {
    this.pair = null;
    this.jwk = null;
  }

  async #keypair() {
    if (this.pair) return this.pair;
    let pair = null;
    try {
      pair = await idb('readonly', (s) => s.get(KEY));
    } catch {
      /* IndexedDB unavailable (private mode) — fall through to ephemeral */
    }
    if (!pair) {
      pair = await generateKeyPair();
      try {
        await idb('readwrite', (s) => s.put(pair, KEY));
      } catch {
        /* couldn't persist — identity is ephemeral this session */
      }
    }
    this.pair = pair;
    return pair;
  }

  /** This device's public key as a JWK (sent to the host for pinning). */
  async publicKeyJwk() {
    if (this.jwk) return this.jwk;
    const { publicKey } = await this.#keypair();
    this.jwk = await exportPublicJwk(publicKey);
    return this.jwk;
  }

  /** Sign the host's `${token}|${nonce}` challenge; returns a base64 signature. */
  async sign(token, nonce) {
    const { privateKey } = await this.#keypair();
    return signChallenge(privateKey, token, nonce);
  }
}

export class IdentityProvider extends Provider {
  constructor() {
    super();
    this.identity = new Identity();
  }
  async obtain() {
    return this.identity;
  }
}
