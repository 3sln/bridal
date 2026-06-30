// Cloudflare adapter: one Durable Object per room, using the **WebSocket
// Hibernation API**. The host (desktop daemon) holds its signaling socket open
// 24/7 so the phone can call in any time — but because the sockets are
// hibernatable, the DO is evicted from memory while idle and only wakes on
// actual signaling traffic. That keeps an always-available tether nearly free.
//
// Hibernation means no reliable in-memory state between events, so we recover
// everything from the live sockets: each socket is tagged + has its role stashed
// via serializeAttachment(). The relay itself is tiny (forward `signal` to the
// other peer; announce join/leave). The platform-neutral SignalingRoom still
// powers the Node/Bun dev-server (and the tests).

import { DurableObject } from 'cloudflare:workers';
import { SIGNAL, ROLE, error, joined, peerJoin, peerLeave } from '@bridle/protocol/signaling';

export class BridleRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const code = url.searchParams.get('room') || 'room';
    if (role !== ROLE.HOST && role !== ROLE.GUEST) return new Response('bad role', { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable accept; tag by role so we can find peers after waking.
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, code });

    // One host + one guest per room.
    const sameRole = this.ctx.getWebSockets(role).filter((ws) => ws !== server);
    if (sameRole.length) {
      send(server, error('role-taken', `role ${role} already present in room ${code}`));
      try {
        server.close(4001, 'role-taken');
      } catch {
        /* noop */
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    send(server, joined(code, role, this.#roles()));
    const other = this.#other(server);
    if (other) send(other, peerJoin(role));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return; // ignore non-JSON / binary on the signaling channel
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === SIGNAL.SIGNAL) {
      const other = this.#other(ws);
      if (other) send(other, { t: SIGNAL.SIGNAL, data: msg.data });
      else send(ws, error('no-peer', 'the other peer is not connected'));
    } else if (msg.t === SIGNAL.LEAVE) {
      try {
        ws.close(1000, 'left');
      } catch {
        /* noop */
      }
    }
  }

  webSocketClose(ws) {
    this.#announceLeave(ws);
  }
  webSocketError(ws) {
    this.#announceLeave(ws);
  }

  #announceLeave(ws) {
    const role = ws.deserializeAttachment()?.role;
    const other = this.#other(ws);
    if (other && role) send(other, peerLeave(role));
  }

  #other(ws) {
    return this.ctx.getWebSockets().find((s) => s !== ws);
  }
  #roles() {
    return this.ctx.getWebSockets().map((s) => s.deserializeAttachment()?.role).filter(Boolean);
  }
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* socket closing */
  }
}
