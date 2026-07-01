import { test, expect } from 'bun:test';
import { parseArgs, loadConfig } from '../src/config.js';

test('`tether <name> <agent>` names the tether and selects the agent', () => {
  const parsed = parseArgs(['tether', 'My Project', 'codex']);
  expect(parsed.sub).toBe('tether');
  expect(parsed.tetherName).toBe('My Project');
  expect(parsed.agentName).toBe('codex');

  const cfg = loadConfig(parsed, {});
  expect(cfg.name).toBe('My Project');
  expect(cfg.agent.id).toBe('codex');
});

test('`tether <name>` defaults the agent to claude', () => {
  const cfg = loadConfig(parseArgs(['tether', 'work']), {});
  expect(cfg.name).toBe('work');
  expect(cfg.agent.id).toBe('claude');
});

test('bare / unknown → dashboard; explicit help → help', () => {
  expect(parseArgs([]).sub).toBe('default'); // bare `bridle` → tethers + help
  expect(parseArgs(['codex']).sub).toBe('default'); // unknown → dashboard
  expect(parseArgs(['help']).sub).toBe('help');
  expect(parseArgs(['--help']).sub).toBe('help');
  expect(parseArgs(['-h']).sub).toBe('help');
});

test('`tether <name> -- <cmd...>` tethers an arbitrary CLI', () => {
  const cfg = loadConfig(parseArgs(['tether', 'proj', '--', 'my-cli', '--flag']), {});
  expect(cfg.name).toBe('proj');
  expect(cfg.agent.mode).toBe('pipe');
  expect(cfg.agent.command).toEqual(['my-cli', '--flag']);
});

test('default session is a fresh conversation; --resume opts in', () => {
  expect(loadConfig(parseArgs([]), {}).session.fresh).toBe(true);
  expect(loadConfig(parseArgs(['--resume']), {}).session.fresh).toBe(false);
  expect(loadConfig(parseArgs(['--resume']), {}).session.attachLatest).toBe(true);
});

test('a fresh token is high-entropy (not the legacy 6-char code)', () => {
  expect(loadConfig(parseArgs([]), {}).room.length).toBeGreaterThanOrEqual(20);
});
