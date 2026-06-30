import { test, expect } from 'bun:test';
import { McpServer } from '../src/mcp.js';

function fakeController() {
  const calls = [];
  return {
    calls,
    notify: (t, l) => { calls.push(['notify', t, l]); return 'shown'; },
    speak: () => 'spoken',
    sendAsset: async () => 'sent file (10 bytes)',
    showMarkdown: () => 'rendered',
    setStatus: () => 'ok',
    ask: async () => 'yes',
  };
}

test('MCP server: initialize, tools/list, tools/call', async () => {
  const c = fakeController();
  const s = new McpServer({ controller: c, port: 0 });
  s.start();
  const rpc = (body) =>
    fetch(s.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  expect(init.result.serverInfo.name).toBe('bridle');
  expect(init.result.capabilities.tools).toBeDefined();

  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  expect(names).toContain('play_audio');
  expect(names).toContain('show_image');
  expect(names).toContain('ask');

  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'notify', arguments: { text: 'hi', level: 'warn' } } });
  expect(call.result.content[0].text).toBe('shown');
  expect(c.calls[0]).toEqual(['notify', 'hi', 'warn']);

  s.stop();
});

test('MCP server: notifications get no response, unknown method errors', async () => {
  const s = new McpServer({ controller: fakeController(), port: 0 });
  s.start();
  const notif = await fetch(s.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  expect(notif.status).toBe(202);

  const bad = await fetch(s.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'nope' }),
  }).then((r) => r.json());
  expect(bad.error.code).toBe(-32601);

  s.stop();
});
