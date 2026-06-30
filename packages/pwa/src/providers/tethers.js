// Known tethers — the desktops/agents this phone can connect to. The app holds a
// persisted list and one is "active" at a time; switching tears down the current
// P2P link and connects to the chosen one (their daemons keep running, so they
// coexist — you're just changing focus). Scanning a QR (URL #room=…) adds one.

import { Provider } from '@3sln/ngin';
import { isValidRoomCode } from '@bridle/protocol/signaling';

const KEY = 'bridle.tethers';

class Tethers extends EventTarget {
  constructor() {
    super();
    const s = read();
    this.items = Array.isArray(s.items) ? s.items : [];
    this.activeId = s.activeId || null;
    this.#seedFromUrl(); // a freshly-scanned QR becomes the active tether
    if (!this.activeId && this.items.length) this.activeId = this.items[0].id;
  }

  #seedFromUrl() {
    try {
      const hash = new URLSearchParams(location.hash.slice(1));
      const qs = new URLSearchParams(location.search);
      const room = hash.get('room') || qs.get('room');
      if (room && isValidRoomCode(room)) {
        const backendUrl = (qs.get('backend') || location.origin).replace(/\/$/, '');
        this.activeId = this.upsert({ room, backendUrl });
        this.#save();
      }
    } catch {
      /* no/invalid hash */
    }
  }

  list() {
    return this.items.slice();
  }
  active() {
    return this.items.find((t) => t.id === this.activeId) || null;
  }
  get(id) {
    return this.items.find((t) => t.id === id) || null;
  }

  /** Add or update a tether; returns its id. */
  upsert({ room, backendUrl, label } = {}) {
    let t = this.items.find((x) => x.room === room && x.backendUrl === backendUrl);
    if (!t) {
      t = { id: newId(), room, backendUrl, label: label || room, auto: !label };
      this.items.push(t);
    } else if (label) {
      t.label = label;
      t.auto = false;
    }
    return t.id;
  }
  add(opts) {
    const id = this.upsert(opts);
    this.#save();
    this.#emit('change');
    return id;
  }
  remove(id) {
    this.items = this.items.filter((t) => t.id !== id);
    if (this.activeId === id) this.activeId = this.items[0]?.id || null;
    this.#save();
    this.#emit('switch');
  }
  setActive(id) {
    if (id !== this.activeId && this.get(id)) {
      this.activeId = id;
      this.#save();
      this.#emit('switch');
    }
  }
  rename(id, label) {
    const t = this.get(id);
    if (t) {
      t.label = label;
      t.auto = false;
      this.#save();
      this.#emit('change');
    }
  }
  /** Update a still-auto label (e.g. from the desktop's hello), keeping user names. */
  setAutoLabel(id, label) {
    const t = this.get(id);
    if (t && t.auto && label) {
      t.label = label;
      this.#save();
      this.#emit('change');
    }
  }

  #save() {
    write({ items: this.items, activeId: this.activeId });
  }
  #emit(kind) {
    this.dispatchEvent(new CustomEvent('change', { detail: { kind } }));
  }
}

function newId() {
  return (globalThis.crypto?.randomUUID?.() || `${Math.random()}`).slice(0, 8);
}
function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export class TethersProvider extends Provider {
  constructor() {
    super();
    this.tethers = new Tethers();
  }
  async obtain() {
    return this.tethers;
  }
}
