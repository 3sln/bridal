// Offline speech-to-text worker. Runs Whisper entirely in the browser via
// Transformers.js (ONNX Runtime, WebGPU when available, WASM otherwise). The
// model is fetched from the HF hub once and cached by the browser — after that
// it works offline. No audio ever leaves the device.
//
// Main thread sends decoded mono 16 kHz Float32 samples; we return text.

import { pipeline, env } from '@huggingface/transformers';

// We only use remote (hub) models, cached in the browser.
env.allowLocalModels = false;

let asrPromise = null;
let loadedKey = null;

// Transformers.js reports progress per file (config, tokenizer, model weights…),
// each running 0→100 on its own — naively forwarded that reads as a jittery bar
// bouncing around. Aggregate them into a single overall percentage by summing
// bytes across every file we've seen, so the UI gets one steady number.
// The HF hub often serves model files without a Content-Length, so per-file
// totals are frequently unknown — any byte percentage is a lie (small files
// with a known length read 100% before the big weights are even counted). Track
// loaded bytes per file (always known and monotonic) and only compute a percent
// when EVERY file in flight reports a total; otherwise report progress: null and
// let the UI show an indeterminate bar + downloaded size.
const fileBytes = new Map();
function reportProgress(p) {
  if (p && p.file) {
    const prev = fileBytes.get(p.file) || { loaded: 0, total: 0 };
    fileBytes.set(p.file, {
      loaded: typeof p.loaded === 'number' ? p.loaded : prev.loaded,
      total: typeof p.total === 'number' && p.total > 0 ? p.total : prev.total,
    });
  }
  let loaded = 0;
  let total = 0;
  let allKnown = fileBytes.size > 0;
  for (const f of fileBytes.values()) {
    loaded += f.loaded;
    if (f.total > 0) {
      total += f.total;
    } else {
      allKnown = false;
    }
  }
  const progress = allKnown && total > 0 ? Math.min(100, (loaded / total) * 100) : null;
  self.postMessage({ type: 'progress', data: { status: p?.status, progress, loaded } });
}

function getAsr(model, device) {
  const key = `${model}@${device || 'wasm'}`;
  if (!asrPromise || loadedKey !== key) {
    loadedKey = key;
    fileBytes.clear();
    asrPromise = pipeline('automatic-speech-recognition', model, {
      ...(device ? { device } : {}),
      progress_callback: reportProgress,
    }).catch(async (err) => {
      // WebGPU not available / failed → fall back to WASM once.
      if (device) {
        self.postMessage({ type: 'progress', data: { status: 'fallback', message: String(err?.message || err) } });
        loadedKey = `${model}@wasm`;
        fileBytes.clear();
        return pipeline('automatic-speech-recognition', model, {
          progress_callback: reportProgress,
        });
      }
      throw err;
    });
  }
  return asrPromise;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'load') {
      await getAsr(msg.model, msg.device);
      self.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'transcribe') {
      const asr = await getAsr(msg.model, msg.device);
      self.postMessage({ type: 'ready' });
      const opts = { chunk_length_s: 30, stride_length_s: 5 };
      // English-only models reject a language option.
      if (!msg.model.endsWith('.en') && msg.language) opts.language = msg.language;
      const out = await asr(msg.samples, opts);
      self.postMessage({ type: 'result', id: msg.id, text: (out.text || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.message || err) });
  }
};
