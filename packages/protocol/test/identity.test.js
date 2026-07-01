import { test, expect } from 'bun:test';
import {
  generateKeyPair,
  exportPublicJwk,
  signChallenge,
  verifySignature,
  fingerprintJwk,
} from '../identity.js';

const TOKEN = 'q7r9wx2k4m6n8p3s5t7v9w2x4y';
const NONCE = 'a1b2c3d4-0000-1111-2222-333344445555';

test('a device signature verifies for the right token+nonce', async () => {
  const { publicKey, privateKey } = await generateKeyPair();
  const jwk = await exportPublicJwk(publicKey);
  const sig = await signChallenge(privateKey, TOKEN, NONCE);

  expect(await verifySignature(jwk, sig, TOKEN, NONCE)).toBe(true);
});

test('verification fails on a replayed/altered challenge', async () => {
  const { publicKey, privateKey } = await generateKeyPair();
  const jwk = await exportPublicJwk(publicKey);
  const sig = await signChallenge(privateKey, TOKEN, NONCE);

  expect(await verifySignature(jwk, sig, TOKEN, 'different-nonce')).toBe(false);
  expect(await verifySignature(jwk, sig, 'other-token', NONCE)).toBe(false);
});

test('another device (key) cannot impersonate the pinned one', async () => {
  const real = await generateKeyPair();
  const realJwk = await exportPublicJwk(real.publicKey);
  const pinned = await fingerprintJwk(realJwk);

  const attacker = await generateKeyPair();
  const attackerJwk = await exportPublicJwk(attacker.publicKey);
  // Attacker knows the token+nonce and signs with its own key…
  const sig = await signChallenge(attacker.privateKey, TOKEN, NONCE);

  // …the signature is valid for the attacker's key, but its fingerprint differs
  // from the pinned device, so the host rejects it.
  expect(await verifySignature(attackerJwk, sig, TOKEN, NONCE)).toBe(true);
  expect(await fingerprintJwk(attackerJwk)).not.toBe(pinned);
});

test('fingerprint is stable for the same key', async () => {
  const { publicKey } = await generateKeyPair();
  const jwk = await exportPublicJwk(publicKey);
  expect(await fingerprintJwk(jwk)).toBe(await fingerprintJwk(jwk));
});
