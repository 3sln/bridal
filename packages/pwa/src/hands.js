// Hands-free helpers for eyes-off / driving use: non-visual audio cues
// (earcons), keep-awake (Wake Lock), and hardware media controls (MediaSession —
// so a car/headset/lock-screen play-pause-skip maps onto bridle).
//
// All three degrade gracefully where unsupported.

// ---- earcons: short tones that signal state without looking ---------------
export function createEarcons() {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      ctx = new A();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  const tone = (freq, dur = 0.12, type = 'sine', gain = 0.05) => {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
  };
  return {
    resume: ensure,
    listen: () => tone(660, 0.1), // started listening
    stop: () => tone(440, 0.09), // stopped listening
    think: () => { tone(520, 0.06); setTimeout(() => tone(520, 0.06), 120); }, // processing
    done: () => { tone(720, 0.08); setTimeout(() => tone(960, 0.1), 90); }, // result ready
    error: () => tone(300, 0.18, 'square', 0.05),
  };
}

// ---- wake lock: keep the screen/session alive while in use ----------------
export function createWakeLock() {
  let sentinel = null;
  let wanted = false;
  const acquire = async () => {
    try {
      if (navigator.wakeLock && !sentinel) {
        sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => { sentinel = null; });
      }
    } catch {
      /* denied / unsupported */
    }
  };
  const release = async () => {
    try {
      await sentinel?.release();
    } catch {
      /* noop */
    }
    sentinel = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) acquire();
  });
  return {
    enable: () => { wanted = true; acquire(); },
    disable: () => { wanted = false; release(); },
  };
}

// ---- media session: hardware transport controls --------------------------
// Maps play/pause/stop/prev/next (steering wheel, headset, lock screen) onto
// handlers. Note: on some browsers the controls only surface while a media
// element is actually playing — the audio assets the agent plays will engage it.
export function setupMediaSession(handlers) {
  if (!('mediaSession' in navigator)) return { setState() {}, update() {} };
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({ title: 'bridle', artist: 'voice agent' });
  } catch {
    /* noop */
  }
  const bind = (action, fn) => {
    try {
      ms.setActionHandler(action, fn || null);
    } catch {
      /* action unsupported */
    }
  };
  bind('play', handlers.play);
  bind('pause', handlers.pause);
  bind('stop', handlers.stop);
  bind('previoustrack', handlers.previous);
  bind('nexttrack', handlers.next);
  return {
    setState(playing) {
      try {
        ms.playbackState = playing ? 'playing' : 'paused';
      } catch {
        /* noop */
      }
    },
    update(meta) {
      try {
        ms.metadata = new MediaMetadata({ title: 'bridle', ...meta });
      } catch {
        /* noop */
      }
    },
  };
}
