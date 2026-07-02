// Persistent registry of tethers — named, server-run tethers. Each remembers its
// room code and agent command so the phone can reconnect anytime and the single
// `bridle server` can run it headless. Stored as `tethers.json` under the OS
// config dir (migrated from the legacy per-tether `setups.json`). Secrets go in a
// sibling per-tether env file with tight permissions, never in the JSON.
//
// The server writes `status.json` (live per-tether state) so the CLI can show
// real status without talking to the process. One `server.pid` lock guards the
// single supervisor.

import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function configDir() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'bridle');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'bridle');
}

const tethersFile = () => join(configDir(), 'tethers.json');
const legacySetupsFile = () => join(configDir(), 'setups.json');
const statusFile = () => join(configDir(), 'status.json');
export const envFileFor = (name) => join(configDir(), `${safeName(name)}.env`);

export function safeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

async function ensureDir() {
  await mkdir(configDir(), { recursive: true });
}

export async function readSetups() {
  try {
    return JSON.parse(await readFile(tethersFile(), 'utf8'));
  } catch {
    // First run on the shared-server build: adopt the legacy per-tether file.
    try {
      const legacy = JSON.parse(await readFile(legacySetupsFile(), 'utf8'));
      await writeFile(tethersFile(), JSON.stringify(legacy, null, 2)).catch(() => {});
      return legacy;
    } catch {
      return {};
    }
  }
}

/** Sync read for hot paths (server watch/status) that can't await. */
export function readSetupsSync() {
  for (const f of [tethersFile(), legacySetupsFile()]) {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      /* try the next */
    }
  }
  return {};
}

export async function getSetup(name) {
  const all = await readSetups();
  return all[safeName(name)] || null;
}

/**
 * Persist a setup. Tethers are NOT deduplicated by name: re-pairing the same
 * directory updates that tether in place, but a different directory naming a
 * colliding tether gets a fresh suffixed key so neither clobbers the other.
 * @param {{name:string, room:string, agent:string[], cwd:string, backendUrl:string, createdAt?:string}} setup
 */
export async function saveSetup(setup) {
  await ensureDir();
  const all = await readSetups();
  let key = safeName(setup.name);
  if (setup.cwd) {
    while (all[key] && all[key].cwd && all[key].cwd !== setup.cwd) {
      const m = key.match(/^(.*?)-(\d+)$/);
      key = m ? `${m[1]}-${Number(m[2]) + 1}` : `${key}-2`;
    }
  }
  all[key] = { ...all[key], ...setup, name: key, cwd: setup.cwd ?? all[key]?.cwd };
  await writeFile(tethersFile(), JSON.stringify(all, null, 2));
  return all[key];
}

export async function removeSetup(name) {
  const key = safeName(name);
  const all = await readSetups();
  if (!all[key]) return false;
  const room = all[key].room;
  delete all[key];
  await writeFile(tethersFile(), JSON.stringify(all, null, 2));
  if (room) {
    await removePin(room).catch(() => {});
  }
  try {
    await rm(envFileFor(key), { force: true });
  } catch {
    /* env file may not exist */
  }
  return true;
}

// --- device pins (TOFU) -----------------------------------------------------
// Map a tether's token (room) to the fingerprint of the phone we paired with.
// Kept separate from setups so it works for both foreground and daemon runs and
// survives the auto-daemon handoff (same token). A leaked token alone can't
// drive the agent once a device is pinned here.
const pinsFile = () => join(configDir(), 'pins.json');

async function readPins() {
  try {
    return JSON.parse(await readFile(pinsFile(), 'utf8'));
  } catch {
    return {};
  }
}
export async function getPin(token) {
  const all = await readPins();
  return all[token] || null;
}
export async function savePin(token, fingerprint) {
  await ensureDir();
  const all = await readPins();
  all[token] = fingerprint;
  await writeFile(pinsFile(), JSON.stringify(all, null, 2));
}
export async function removePin(token) {
  const all = await readPins();
  if (!all[token]) return;
  delete all[token];
  await writeFile(pinsFile(), JSON.stringify(all, null, 2));
}

/** Write the per-setup secret env file (0600). */
export async function writeEnvFile(name, env) {
  await ensureDir();
  const path = envFileFor(name);
  const body = Object.entries(env)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  await writeFile(path, body + '\n');
  if (process.platform !== 'win32') {
    try {
      await chmod(path, 0o600);
    } catch {
      /* best effort */
    }
  }
  return path;
}

export const hasEnvFile = (name) => existsSync(envFileFor(name));

// --- daemon single-instance lock --------------------------------------------
// One running daemon per tether, however it was launched (scheduled service or
// the transient background fallback). A PID file in the config dir is the lock;
// a stale file (dead PID) is ignored so a crash never wedges the tether.
const lockFile = (name) => join(configDir(), `${safeName(name)}.pid`);

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but not signalable == alive
  }
}

/** True if a live daemon already holds this tether's lock. */
export function daemonRunning(name) {
  try {
    return pidAlive(Number(readFileSync(lockFile(name), 'utf8').trim()));
  } catch {
    return false;
  }
}

/** Claim the lock for this process; false if another live daemon holds it. */
export function acquireDaemonLock(name) {
  if (daemonRunning(name)) return false;
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(lockFile(name), String(process.pid));
    return true;
  } catch {
    return true; // can't write a lock — proceed rather than block the tether
  }
}

/** Release the lock if we own it (safe to call from an exit handler). */
export function releaseDaemonLock(name) {
  try {
    if (Number(readFileSync(lockFile(name), 'utf8').trim()) === process.pid) {
      rmSync(lockFile(name), { force: true });
    }
  } catch {
    /* nothing to release */
  }
}

/** Migration: stop a still-running legacy per-tether daemon and clear its lock. */
export function stopLegacyDaemon(name) {
  try {
    const pid = Number(readFileSync(lockFile(name), 'utf8').trim());
    if (pidAlive(pid)) {
      try {
        process.kill(pid);
      } catch {
        /* already gone / not ours */
      }
    }
    rmSync(lockFile(name), { force: true });
  } catch {
    /* no legacy lock */
  }
}

// --- shared server: single-instance lock ------------------------------------
// Exactly one `bridle server` supervises all tethers. Its PID file is the lock;
// a stale file (dead PID) is ignored so a crash never wedges the whole system.
const serverLockFile = () => join(configDir(), 'server.pid');

export function serverRunning() {
  try {
    return pidAlive(Number(readFileSync(serverLockFile(), 'utf8').trim()));
  } catch {
    return false;
  }
}
export function acquireServerLock() {
  if (serverRunning()) return false;
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(serverLockFile(), String(process.pid));
    return true;
  } catch {
    return true;
  }
}
export function releaseServerLock() {
  try {
    if (Number(readFileSync(serverLockFile(), 'utf8').trim()) === process.pid) {
      rmSync(serverLockFile(), { force: true });
    }
  } catch {
    /* nothing to release */
  }
}

// --- live status (server -> CLI) --------------------------------------------
// The server writes a map of tether name -> { phase, guest, agentState, at }.
// The CLI reads it to show real state; entries older than STATUS_STALE_MS mean
// the server isn't updating that tether (treated as not live).
export const STATUS_STALE_MS = 15000;

export function writeStatus(map) {
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(statusFile(), JSON.stringify(map, null, 2));
  } catch {
    /* status is best-effort */
  }
}
export function readStatusSync() {
  try {
    return JSON.parse(readFileSync(statusFile(), 'utf8'));
  } catch {
    return {};
  }
}
