#!/usr/bin/env bun
// Bridle desktop CLI dispatcher. Subcommands:
//   tether <name> [agent] | daemonize [name] | list | remove <name>
//   daemon --setup <name> (internal) | help
//
// Compile to a single binary with:  bun build src/index.js --compile --outfile bridle

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Engine, Provider } from '@3sln/ngin';
import { parseArgs, loadConfig, configFromSetup } from './config.js';
import {
  AgentProvider,
  SignalingProvider,
  PeerProvider,
  RegistryProvider,
  ServiceProvider,
  FrontendProvider,
} from './providers.js';
import { SetupsQuery, RemoveSetupAction } from './bl/setups.js';
import { getSetup, envFileFor, acquireDaemonLock, releaseDaemonLock } from './registry.js';
import { installService } from './service.js';
import { runSession } from './run.js';
import { terminalQR, openWebviewQR } from './qr.js';
import { ui } from './ui.js';

const parsed = parseArgs();

function buildEngine(config) {
  return new Engine({
    providers: {
      config: Provider.fromSingleton(config),
      agent: AgentProvider,
      signaling: SignalingProvider,
      peer: PeerProvider,
      registry: RegistryProvider,
      service: ServiceProvider,
      frontend: FrontendProvider,
    },
  });
}

switch (parsed.sub) {
  case 'list':
    await cmdList();
    break;
  case 'remove':
  case 'rm':
    await cmdRemove(parsed.positional[0]);
    break;
  case 'tether':
    await cmdPair();
    break;
  case 'daemonize':
    await cmdDaemonize(parsed.tetherName);
    break;
  case 'daemon':
    await cmdDaemon(parsed.get('--setup'));
    break;
  case 'help':
    ui.help();
    break;
  default:
    await cmdDefault();
    break;
}

// --- pair: foreground run, QR, auto-daemonize on first tether ---------------
async function cmdPair() {
  const config = loadConfig(parsed);
  if (!config.agent) {
    ui.needAgent(parsed.tetherName);
    process.exit(1);
  }
  const { modeName, modes } = config.agent;
  if (modeName && !modes?.[modeName]) {
    fail(`unknown mode "${modeName}" for ${config.agent.id}. available: ${Object.keys(modes || {}).join(', ') || '(none)'}`);
  }
  const engine = buildEngine(config);
  await ui.banner(config, terminalQR);
  if (config.webview) {
    openWebviewQR(config.pwaUrl).then((ok) => !ok && ui.note('(webview unavailable — using terminal QR)'));
  }
  const { reason, already } = await runSession(engine, config, { ui });
  if (reason === 'daemonized') ui.handedOff();
  else if (reason === 'fallback-daemon') ui.fallbackDaemon(already, config.name);
  await engine.dispose();
  process.exit(0);
}

// --- daemonize: register the persistent service for an existing tether -------
// Meant to be run from a console opened as administrator (where a locked-down
// machine will let the task be registered). Falls back to a clear message when
// it isn't elevated.
async function cmdDaemonize(name) {
  name = name || basename(process.cwd());
  const setup = await getSetup(name);
  if (!setup) {
    fail(`no tether named "${name}". create one first:  bridle tether ${name} <agent>`);
  }
  try {
    const svc = await installService(setup.name);
    ui.installed({ setup, service: svc });
    ui.note('daemonized — this tether will keep running across logins.');
  } catch (err) {
    fail(`couldn't register the background service: ${err.message}\n  open PowerShell as administrator, then run:  bridle daemonize ${name}`);
  }
  await new Promise((r) => setTimeout(r, 200));
  process.exit(0);
}

// --- daemon: headless run for the service -----------------------------------
async function cmdDaemon(name) {
  if (!name) fail('daemon mode requires --setup <name>');
  const setup = await getSetup(name);
  if (!setup) fail(`no such setup: ${name}`);
  // One daemon per tether — whether launched by the service or the fallback.
  if (!acquireDaemonLock(setup.name)) {
    ui.note(`a bridle daemon for "${setup.name}" is already running — exiting.`);
    process.exit(0);
  }
  const release = () => releaseDaemonLock(setup.name);
  process.on('exit', release);
  await loadEnvFile(envFileFor(setup.name));
  const config = configFromSetup(setup);
  const engine = buildEngine(config);
  ui.note(`bridle daemon for "${setup.name}" — room ${setup.room}, agent ${setup.agent?.id || (setup.agent?.command || []).join(' ')}`);
  await runSession(engine, config, { ui: ui.quiet });
  await engine.dispose();
  release();
  process.exit(0);
}

// --- list -------------------------------------------------------------------
async function renderTethers() {
  const engine = buildEngine(loadConfig(parsed));
  const handle = engine.query(new SetupsQuery());
  await new Promise((resolve) => {
    const sub = handle.subscribe((list) => {
      ui.setups(list);
      sub.unsubscribe();
      resolve();
    });
  });
  await engine.dispose();
}

async function cmdList() {
  await renderTethers();
  process.exit(0);
}

// --- default: bare `bridle` — the dashboard (tethers + help) ----------------
async function cmdDefault() {
  await renderTethers();
  ui.help();
  process.exit(0);
}

// --- remove -----------------------------------------------------------------
async function cmdRemove(name) {
  if (!name) fail('usage: bridle remove <name>');
  const engine = buildEngine(loadConfig(parsed));
  const feed = engine.dispatch(new RemoveSetupAction(name));
  await new Promise((resolve, reject) => {
    feed.addEventListener('removed', (e) => ui.removed(e.detail));
    feed.addEventListener('complete', resolve);
    feed.addEventListener('error', (e) => reject(e.error));
  }).catch((err) => fail(err.message));
  await engine.dispose();
  process.exit(0);
}

async function loadEnvFile(path) {
  try {
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch {
    /* no env file — rely on ambient env */
  }
}

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}
