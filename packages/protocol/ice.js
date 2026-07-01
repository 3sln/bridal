// Default ICE configuration. STUN handles the common case; a TURN relay is the
// fallback for symmetric-NAT / restrictive networks (the "when needed" path the
// spec calls out).
//
// The relay is Cloudflare Realtime TURN, but it can't live in a static list:
// its credentials are short-lived and minted per session. So clients fetch the
// relay from the backend `/ice` endpoint (see packages/worker/src/turn.js); the
// statics below are only the STUN servers plus the offline fallback used when
// that fetch fails. There is intentionally no static TURN relay here — the prior
// public OpenRelay (metered.ca) was dropped because metered deprecated static
// credentials as unreliable.

export const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// No static TURN relay: the relay is fetched per session from the backend.
// `DEFAULT_ICE_SERVERS` is the STUN-only fallback for when `/ice` is unreachable.
export const DEFAULT_ICE_SERVERS = [...STUN_SERVERS];

/**
 * Build an RTCConfiguration. Pass `{ iceServers }` to fully override (the normal
 * path — clients pass the servers fetched from `/ice`). With no override it
 * returns STUN only; the TURN relay always comes from `/ice`.
 */
export function iceConfig({ iceServers } = {}) {
  return { iceServers: iceServers || DEFAULT_ICE_SERVERS };
}

/**
 * Fetch the backend's `/ice` endpoint to get budget-governed ICE servers
 * (STUN, plus a fresh short-lived Cloudflare TURN credential when the backend
 * has it configured and within budget). Called per connection so each gets its
 * own short-lived credential.
 *
 * Resilient by design: on any failure (offline, backend down, bad response) it
 * returns the built-in `DEFAULT_ICE_SERVERS` so a connection is still attempted.
 *
 * @param {string} backend  backend origin/base URL (e.g. https://bridle.3sln.com)
 * @param {{ room?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<RTCIceServer[]>}
 */
export async function fetchIceServers(backend, { room, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const base = String(backend || '').replace(/\/$/, '');
    if (!base) return DEFAULT_ICE_SERVERS;
    const u = `${base}/ice${room ? `?room=${encodeURIComponent(room)}` : ''}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(u, { signal: ctrl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`ice: HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.iceServers) && data.iceServers.length) return data.iceServers;
    throw new Error('ice: empty iceServers');
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}
