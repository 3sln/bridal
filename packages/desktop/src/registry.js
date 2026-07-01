// Persistent registry of "setups" — named, daemonized tethers. Each setup
// remembers its room code and agent command so the phone can reconnect anytime
// and the service can run it headless on boot.
//
// Stored as JSON under the OS config dir. Secrets (the OpenAI key) go in a
// sibling per-setup env file with tight permissions, never in the JSON.

import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function configDir() {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'bridle');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'bridle');
}

const setupsFile = () => join(configDir(), 'setups.json');
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
    const raw = await readFile(setupsFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
  await writeFile(setupsFile(), JSON.stringify(all, null, 2));
  return all[key];
}

export async function removeSetup(name) {
  const key = safeName(name);
  const all = await readSetups();
  if (!all[key]) return false;
  const room = all[key].room;
  delete all[key];
  await writeFile(setupsFile(), JSON.stringify(all, null, 2));
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
