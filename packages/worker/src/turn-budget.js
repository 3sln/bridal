// Durable Object that governs Cloudflare TURN spend for the whole deployment.
// A single instance (addressed by the fixed name "global") serializes every
// credential request through `decide()`, so the monthly/daily/per-minute caps
// are globally consistent even under concurrent load. SQLite-backed, so it runs
// on the free plan like the signaling room.
//
// When an analytics token is configured, `reserve()` gates on *real* month-to-
// date egress (cached ~10 min to stay cheap); otherwise it gates on the local
// grant-count estimate. Either way the local per-IP / per-minute caps apply.

import { DurableObject } from 'cloudflare:workers';
import { decide } from './turn-governor.js';
import { fetchTurnEgressBytes } from './turn.js';

const USAGE_TTL_MS = 10 * 60 * 1000; // re-poll analytics at most every 10 minutes

export class BridleTurnBudget extends DurableObject {
  /**
   * Check-and-reserve one credential grant.
   * @param {{ ip: string, knobs?: object, analytics?: {token,accountTag}|null }} opts
   * @returns {Promise<{ ok: boolean, reason: string|null, remainingGb: number }>}
   */
  async reserve({ ip, knobs = {}, analytics = null } = {}) {
    const now = Date.now();
    const state = (await this.ctx.storage.get('state')) || {};
    const usedGb = analytics ? await this.#usedGb(analytics, now) : null;
    const r = decide(state, { ip, now, knobs, usedGb });
    await this.ctx.storage.put('state', r.state);
    return { ok: r.ok, reason: r.reason, remainingGb: r.remainingGb };
  }

  // Real month-to-date GB from TURN analytics, cached so we don't hit the
  // GraphQL API on every connection. Falls back to the last cached value (or
  // null → local estimate) if a fresh fetch fails.
  async #usedGb(analytics, now) {
    const cache = await this.ctx.storage.get('usage');
    if (cache && now - cache.at < USAGE_TTL_MS) return cache.egressBytes / 1e9;
    const bytes = await fetchTurnEgressBytes(analytics, now);
    if (bytes == null) return cache ? cache.egressBytes / 1e9 : null;
    await this.ctx.storage.put('usage', { at: now, egressBytes: bytes });
    return bytes / 1e9;
  }
}
