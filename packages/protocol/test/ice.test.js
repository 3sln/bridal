import { test, expect } from 'bun:test';
import { fetchIceServers, DEFAULT_ICE_SERVERS } from '../ice.js';

test('returns the server-provided iceServers on success', async () => {
  const fetchImpl = async (url) => {
    expect(url).toBe('https://bridle.example/ice?room=ABC123');
    return { ok: true, json: async () => ({ iceServers: [{ urls: 'turn:relay' }] }) };
  };
  const servers = await fetchIceServers('https://bridle.example/', { room: 'ABC123', fetchImpl });
  expect(servers).toEqual([{ urls: 'turn:relay' }]);
});

test('falls back to defaults when the request fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const servers = await fetchIceServers('https://bridle.example', { fetchImpl });
  expect(servers).toBe(DEFAULT_ICE_SERVERS);
});

test('falls back to defaults when the response has no iceServers', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ iceServers: [] }) });
  const servers = await fetchIceServers('https://bridle.example', { fetchImpl });
  expect(servers).toBe(DEFAULT_ICE_SERVERS);
});

test('falls back to defaults for an empty backend', async () => {
  const servers = await fetchIceServers('', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  expect(servers).toBe(DEFAULT_ICE_SERVERS);
});
