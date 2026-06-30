// FrontendController — the desktop's handle on the connected phone. The MCP
// tools (mcp.js) call these methods; each one sends a link message (or a chunked
// asset) to the phone, which renders/plays it. `ask` blocks until the phone
// replies. Everything no-ops loudly when no phone is connected.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  notice as mkNotice,
  speak as mkSpeak,
  markdown as mkMarkdown,
  statusLine as mkStatus,
  ask as mkAsk,
  assetBegin,
  assetEnd,
} from '@bridle/protocol/link';

const CHUNK = 16 * 1024;
const ASK_TIMEOUT_MS = 180_000;

export class FrontendController {
  constructor() {
    this.peer = null;
    this.pending = new Map(); // ask id -> { resolve, reject }
    this.seq = 0;
  }

  attach(peer) {
    this.peer = peer;
  }
  detach() {
    this.peer = null;
    for (const p of this.pending.values()) p.reject(new Error('phone disconnected'));
    this.pending.clear();
  }
  get connected() {
    return !!this.peer;
  }
  #require() {
    if (!this.peer) throw new Error('no phone is connected to bridle right now');
  }

  notify(text, level = 'info') {
    this.#require();
    this.peer.send(mkNotice(text, level));
    return 'shown';
  }
  speak(text) {
    this.#require();
    this.peer.send(mkSpeak(text));
    return 'spoken';
  }
  showMarkdown(md, title) {
    this.#require();
    this.peer.send(mkMarkdown(md, title));
    return 'rendered';
  }
  setStatus(text) {
    this.#require();
    this.peer.send(mkStatus(text));
    return 'ok';
  }

  /** Send a file (by local path or URL) to the phone as a typed asset. */
  async sendAsset(kind, { path, url, name, mime, meta } = {}) {
    this.#require();
    let bytes;
    let fname = name;
    let ctype = mime;
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      ctype = ctype || res.headers.get('content-type') || guessMime(url);
      fname = fname || basename(new URL(url).pathname) || 'asset';
    } else if (path) {
      bytes = await readFile(path);
      fname = fname || basename(path);
      ctype = ctype || guessMime(path);
    } else {
      throw new Error('sendAsset requires path or url');
    }

    const id = `a${++this.seq}`;
    this.peer.send(assetBegin(id, kind, fname, ctype || 'application/octet-stream', bytes.length, meta || {}));
    for (let o = 0; o < bytes.length; o += CHUNK) {
      this.peer.sendBinary(bytes.subarray(o, o + CHUNK));
    }
    this.peer.send(assetEnd(id));
    return `sent ${fname} (${bytes.length} bytes)`;
  }

  /** Ask the user a question on the phone; resolves with their answer. */
  ask(question, choices) {
    this.#require();
    const id = `q${++this.seq}`;
    this.peer.send(mkAsk(id, question, choices || null));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('the user did not answer in time'));
      }, ASK_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (a) => {
          clearTimeout(timer);
          resolve(a);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }
  resolveAsk(id, answer) {
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      p.resolve(answer);
    }
  }
}

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus',
  '.webm': 'audio/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
};
function guessMime(path) {
  return MIME[extname(path).toLowerCase()] || 'application/octet-stream';
}
