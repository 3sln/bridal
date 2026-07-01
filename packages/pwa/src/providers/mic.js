// Microphone with energy-based voice-activity detection. Continuously reports a
// level (for the UI meter) and segments audio into short SNIPPETS: on sound
// onset it records via MediaRecorder; after a brief energy gap it finalizes the
// clip and emits it. Each snippet is transcribed on-device (Whisper) and the
// conversation layer decides which are real speech vs. noise — so segmentation
// stays cheap and dumb here, and "send on a speech gap" lives where it can see
// the transcript.
//
// The energy gate only decides when to CUT a snippet; it deliberately does NOT
// decide when to send (noise would hold that open). Kept short so speech breaks
// into snippets Whisper can classify.

import { Provider } from '@3sln/ngin';

// Energy-silence that ends a capture snippet. Short: we want frequent snippets
// (at phrase boundaries) so the transcript layer can spot real speech gaps.
const SNIPPET_GAP_MS = 300;

const CANDIDATE_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4', // Safari/iOS
  'audio/ogg;codecs=opus',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return CANDIDATE_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class Microphone extends EventTarget {
  constructor({ getThreshold }) {
    super();
    this.getThreshold = getThreshold;
    this.running = false;
    this.paused = false;
    this.speaking = false;
    this.discarding = false;
    this.stream = null;
    this.ctx = null;
    this.recorder = null;
    this.chunks = [];
  }

  get active() {
    return this.running;
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    await this.ctx.resume().catch(() => {});
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.fftSize);
    this.mime = pickMime();
    this.running = true;
    this.paused = false;
    this.emit('start', {});
    this.#loop();
  }

  #loop() {
    if (!this.running) return;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const x = (this.buf[i] - 128) / 128;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    this.emit('level', { level: rms });

    if (!this.paused) {
      const threshold = this.getThreshold();
      const now = performance.now();
      if (rms > threshold) {
        this.lastVoice = now;
        if (!this.speaking) {
          this.speaking = true;
          this.#startRecorder();
          this.emit('speechstart', {});
        }
      } else if (this.speaking && now - this.lastVoice > SNIPPET_GAP_MS) {
        this.speaking = false;
        this.speechEndedAt = this.lastVoice; // when speech actually stopped
        this.#stopRecorder();
      }
    }
    this.raf = requestAnimationFrame(() => this.#loop());
  }

  #startRecorder() {
    this.chunks = [];
    this.discarding = false;
    this.manual = false; // VAD snippet unless startManual overrides
    try {
      this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }
    this.recStart = performance.now();
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const durationMs = performance.now() - this.recStart;
      if (!this.discarding) {
        const blob = new Blob(this.chunks, { type: this.mime || 'audio/webm' });
        // Drop sub-250ms blips (door slams, lip smacks).
        if (blob.size > 0 && durationMs > 250) {
          const endedAt = this.speechEndedAt || performance.now();
          this.emit('utterance', { blob, mime: blob.type || this.mime || 'audio/webm', durationMs, manual: this.manual, endedAt });
        }
      }
      this.emit('speechend', {});
    };
    this.recorder.start();
  }

  #stopRecorder() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  /** Push-to-talk: begin a single recording immediately, bypassing the VAD. */
  async startManual() {
    if (!this.running) await this.start();
    this.paused = true; // suppress VAD segmentation while held
    this.speaking = false;
    this.#startRecorder();
    this.manual = true; // this clip is a deliberate push-to-talk turn
  }

  /** Push-to-talk: stop and emit the recorded utterance. */
  stopManual() {
    this.#stopRecorder();
  }

  /** Pause utterance capture (level metering continues). Drops any in-flight clip. */
  pause() {
    this.paused = true;
    if (this.speaking) {
      this.speaking = false;
      this.discarding = true;
      this.#stopRecorder();
    }
    this.emit('paused', {});
  }

  resume() {
    if (!this.running) return;
    this.paused = false;
    this.emit('resumed', {});
  }

  async stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.discarding = true;
    this.#stopRecorder();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.speaking = false;
    this.emit('stop', {});
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export class MicProvider extends Provider {
  static deps = ['settings'];
  constructor({ settings }) {
    super();
    this.settings = settings;
    this.mic = null;
  }
  async obtain() {
    if (!this.mic) {
      const settings = await this.settings.obtain();
      this.mic = new Microphone({
        getThreshold: () => settings.get('vadThreshold'),
      });
    }
    return this.mic;
  }
  async dispose() {
    await this.mic?.stop();
    this.mic = null;
  }
}
