// Default ICE configuration. STUN handles the common case; a public TURN relay
// is the fallback for symmetric-NAT / restrictive networks (the "when needed"
// path the spec calls out). Defaults are overridable everywhere — nothing here
// is Cloudflare-specific, and a deployment can supply its own TURN (incl.
// Cloudflare TURN, Twilio NTS, coturn, ...) via config/providers.
//
// The well-known free relay is the Open Relay Project (metered.ca). These are
// the canonical no-signup static credentials, BUT metered now considers static
// credentials unreliable (they "stopped working on different networks") and
// pushes you to a keyed relay you fetch per-session. So treat this as a
// best-effort layer only. For a relay you can actually count on, point clients
// at the backend `/ice` endpoint, which mints short-lived Cloudflare TURN
// credentials (free to 1000 GB/mo) — or swap in a metered API key (free 20 GB/mo).
// See packages/worker/src/turn.js.

export const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const OPEN_RELAY_TURN = [
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export const DEFAULT_ICE_SERVERS = [...STUN_SERVERS, ...OPEN_RELAY_TURN];

/**
 * Build an RTCConfiguration. Pass `{ turn: false }` to use STUN only, or
 * `{ iceServers }` to fully override.
 */
export function iceConfig({ iceServers, turn = true } = {}) {
  if (iceServers) return { iceServers };
  return { iceServers: turn ? DEFAULT_ICE_SERVERS : STUN_SERVERS };
}

/**
 * Fetch the backend's `/ice` endpoint to get budget-governed ICE servers
 * (STUN + OpenRelay, plus a fresh short-lived Cloudflare TURN credential when
 * the backend has it configured and within budget). Called per connection so
 * each gets its own short-lived credential.
 *
 * Resilient by design: on any failure (offline, backend down, bad response) it
 * returns the built-in `DEFAULT_ICE_SERVERS` so a connection is still attempted.
 *
 * @param {string} backend  backend origin/base URL (e.g. https://bridle.3sln.com)
 * @param {{ room?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<RTCIceServer[]>}
 */
export async function fetchIceServers(backend, { room, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
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
