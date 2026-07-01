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

test('a bare agent name still works and is not treated as a tether name', () => {
  const parsed = parseArgs(['codex']);
  expect(parsed.sub).toBe('pair');
  expect(parsed.tetherName).toBeNull();
  expect(parsed.agentName).toBe('codex');
});

test('default session is a fresh conversation; --resume opts in', () => {
  expect(loadConfig(parseArgs([]), {}).session.fresh).toBe(true);
  expect(loadConfig(parseArgs(['--resume']), {}).session.fresh).toBe(false);
  expect(loadConfig(parseArgs(['--resume']), {}).session.attachLatest).toBe(true);
});

test('a fresh token is high-entropy (not the legacy 6-char code)', () => {
  expect(loadConfig(parseArgs([]), {}).room.length).toBeGreaterThanOrEqual(20);
});
