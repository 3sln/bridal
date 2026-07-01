// Run a session to completion. In foreground (`pair`) mode, the first successful
// tether triggers a hand-off: we free the signaling room, install a background
// service, and exit — the daemon then owns the room and the phone reconnects to
// it automatically. In daemon mode we just run until signalled.

import { SessionQuery, PHASE } from './bl/session.js';
import { InstallSetupAction } from './bl/setups.js';
import { startBackgroundDaemon } from './service.js';

export function runSession(engine, config, { ui } = {}) {
  return new Promise((resolve) => {
    let firstTether = true;
    let lastPhase = null;

    if (ui) {
      engine.feed.addEventListener('agent-output', (e) => ui.agentOutput(e.detail));
      engine.feed.addEventListener('guest-input', (e) => ui.guestInput(e.detail));
      engine.feed.addEventListener('mcp-up', (e) => ui.note(`agent front-end tools (MCP) at ${e.detail.url}`));
    }

    const handle = engine.query(new SessionQuery());
    const sub = handle.subscribe(async (state) => {
      if (ui && state.phase !== lastPhase) {
        lastPhase = state.phase;
        ui.phase(state);
      }
      if (ui && state.error) ui.error(state.error);

      if (state.phase === PHASE.TETHERED && firstTether) {
        firstTether = false;
        if (config.autoDaemon && !config.daemonMode) {
          const ok = await daemonizeHandoff(engine, config, sub, ui);
          if (ok) {
            resolve({ reason: 'daemonized' });
          } else {
            // The service couldn't be registered (and elevation was declined or
            // blocked). Don't hold the terminal open per tether — start ONE
            // detached background daemon for this tether instead, then exit. It's
            // transient (won't survive logout/reboot) but keeps the phone tethered.
            sub.unsubscribe();
            const { already } = await startBackgroundDaemon(config.name).catch(() => ({ already: false, failed: true }));
            resolve({ reason: 'fallback-daemon', already });
          }
        }
      }
    });

    const stop = () => {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
      resolve({ reason: 'signal' });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

// Returns true only if the background service was actually installed. On success
// we stop watching and let the caller hand off + exit; the daemon it started
// briefly collides with us for the host slot (freed when this process disposes)
// and retries onto it — see the 4001 handling in signaling-client.js.
async function daemonizeHandoff(engine, config, sub, ui) {
  ui?.note('first tether confirmed — installing background service…');
  const feed = engine.dispatch(
    new InstallSetupAction({
      name: config.name,
      room: config.room,
      agent: { id: config.agent.id, command: config.agent.command },
      cwd: config.agent.cwd,
      backendUrl: config.backendUrl,
    }),
  );

  const ok = await new Promise((res) => {
    feed.addEventListener('installed', (e) => ui?.installed(e.detail));
    feed.addEventListener('complete', () => res(true));
    // Failure is expected on locked-down machines; the caller reports it and
    // falls back to a background server, so keep this quiet.
    feed.addEventListener('error', () => res(false));
  });
  if (ok) {
    sub.unsubscribe();
  }
  return ok;
}
