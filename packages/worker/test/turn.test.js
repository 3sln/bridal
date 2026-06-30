import { test, expect } from 'bun:test';
import { baseIceServers, mintTurnCredentials, fetchTurnEgressBytes } from '../src/turn.js';

test('baseIceServers returns STUN only (the relay is layered on per session)', () => {
  const servers = baseIceServers();
  expect(servers.some((s) => String(s.urls).includes('stun:'))).toBe(true);
  // No static TURN relay — Cloudflare TURN is prepended at issue time, not here.
  expect(servers.some((s) => String(s.urls).includes('turn:'))).toBe(false);
});

test('mintTurnCredentials posts ttl + customIdentifier and returns the ice entry', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      json: async () => ({ iceServers: { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' } }),
    };
  };
  const entry = await mintTurnCredentials({
    keyId: 'KID',
    apiToken: 'SECRET',
    ttl: 7200,
    customIdentifier: 'room42',
    fetchImpl,
  });
  expect(entry.username).toBe('u');
  expect(seen.url).toContain('/keys/KID/credentials/generate-ice-servers');
  expect(seen.init.headers.authorization).toBe('Bearer SECRET');
  const body = JSON.parse(seen.init.body);
  expect(body.ttl).toBe(7200);
  expect(body.customIdentifier).toBe('room42');
});

test('mintTurnCredentials throws on a non-ok response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await expect(
    mintTurnCredentials({ keyId: 'K', apiToken: 'S', ttl: 60, fetchImpl }),
  ).rejects.toThrow();
});

test('fetchTurnEgressBytes sums egress and returns null on error', async () => {
  const ok = async () => ({
    ok: true,
    json: async () => ({
      data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 1000 } }, { sum: { egressBytes: 500 } }] }] } },
    }),
  });
  expect(await fetchTurnEgressBytes({ token: 't', accountTag: 'a' }, Date.now(), ok)).toBe(1500);

  const bad = async () => ({ ok: false, status: 403, json: async () => ({}) });
  expect(await fetchTurnEgressBytes({ token: 't', accountTag: 'a' }, Date.now(), bad)).toBe(null);

  const throws = async () => {
    throw new Error('network');
  };
  expect(await fetchTurnEgressBytes({ token: 't', accountTag: 'a' }, Date.now(), throws)).toBe(null);
});
