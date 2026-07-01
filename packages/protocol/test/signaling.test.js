import { test, expect } from 'bun:test';
import { makeToken, makeRoomCode, isValidRoomCode, TOKEN_LENGTH } from '../signaling.js';

test('makeToken is a high-entropy, valid room token', () => {
  const t = makeToken();
  expect(t.length).toBe(TOKEN_LENGTH);
  expect(isValidRoomCode(t)).toBe(true);
});

test('tokens are effectively unique across many draws', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(makeToken());
  expect(seen.size).toBe(500);
});

test('isValidRoomCode admits full-length tokens but rejects junk', () => {
  expect(isValidRoomCode(makeRoomCode(64))).toBe(true);
  expect(isValidRoomCode('abc')).toBe(false); // too short
  expect(isValidRoomCode('a'.repeat(65))).toBe(false); // too long
  expect(isValidRoomCode('UPPER1')).toBe(false); // out-of-alphabet (l/0/1/o excluded)
  expect(isValidRoomCode(makeRoomCode(6))).toBe(true); // legacy short code still valid
});
