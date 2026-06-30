// Cloudflare Realtime TURN: credential minting, the free ICE base, and a
// best-effort real-usage probe. Platform-agnostic (fetch is injectable); the
// Worker entry (`worker.js`) supplies the secrets and the budget DO.
//
// TURN is layered on top of the always-free STUN + OpenRelay set and only when
// configured + within budget, so the deployment costs nothing until you opt in
// and can never silently blow past the budget.

import { STUN_SERVERS, OPEN_RELAY_TURN } from '@bridle/protocol/ice';

const TURN_KEYS_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const GRAPHQL_API = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * The free, always-available ICE base: STUN for the common case plus the public
 * OpenRelay TURN as a zero-cost last resort. Cloudflare TURN is prepended to
 * this only when budget allows.
 */
export function baseIceServers() {
  return [...STUN_SERVERS, ...OPEN_RELAY_TURN];
}

/**
 * Mint a short-lived Cloudflare TURN credential. Returns a single RTCIceServer
 * entry ({ urls, username, credential }) on success; throws otherwise so the
 * caller can fall back to the free base.
 */
export async function mintTurnCredentials({ keyId, apiToken, ttl, customIdentifier, fetchImpl = fetch }) {
  const res = await fetchImpl(`${TURN_KEYS_API}/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    // customIdentifier tags the credential so spend shows up per-room in TURN
    // analytics and a specific abuser's credentials can be revoked.
    body: JSON.stringify({ ttl, ...(customIdentifier ? { customIdentifier } : {}) }),
  });
  if (!res.ok) throw new Error(`cloudflare turn: HTTP ${res.status}`);
  const data = await res.json();
  const entry = data?.iceServers;
  if (!entry || !entry.urls) throw new Error('cloudflare turn: malformed response');
  return entry;
}

/**
 * Best-effort month-to-date egress in bytes from the Cloudflare Realtime TURN
 * analytics GraphQL dataset. Returns null on any error or unexpected shape so
 * the governor falls back to its local estimate — analytics tightens the cap
 * when available but never breaks issuance when it isn't.
 */
export async function fetchTurnEgressBytes({ token, accountTag }, now = Date.now(), fetchImpl = fetch) {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const query = `query Usage($a: String!, $start: Time!) {
    viewer { accounts(filter: { accountTag: $a }) {
      callsTurnUsageAdaptiveGroups(filter: { datetime_geq: $start }, limit: 10000) {
        sum { egressBytes }
      }
    } }
  }`;
  try {
    const res = await fetchImpl(GRAPHQL_API, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { a: accountTag, start } }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const groups = j?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(groups)) return null;
    return groups.reduce((sum, g) => sum + (g?.sum?.egressBytes || 0), 0);
  } catch {
    return null;
  }
}
