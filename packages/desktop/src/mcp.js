// Minimal MCP server (Streamable HTTP) that bridle runs in-process and the agent
// connects to. It exposes a suite of tools for driving the phone front-end —
// pushing audio/images/files and asking the user things — backed by the live
// FrontendController. Because it shares the process with the WebRTC peer, a tool
// call reaches the phone directly, no IPC.
//
// We hand-roll the JSON-RPC subset MCP needs (initialize, tools/list,
// tools/call, ping) and answer with application/json — no SSE required for
// request/response tools. Bound to 127.0.0.1 only.

const PROTOCOL_VERSION = '2025-06-18';

export class McpServer {
  constructor({ controller, port = 0 } = {}) {
    this.controller = controller;
    this.port = port;
    this.sessionId = crypto.randomUUID();
    this.server = null;
    this.tools = buildTools(controller);
  }

  get url() {
    return this.server ? `http://127.0.0.1:${this.server.port}/mcp` : null;
  }

  start() {
    this.server = Bun.serve({
      port: this.port,
      hostname: '127.0.0.1',
      fetch: (req) => this.#fetch(req),
    });
    return this.url;
  }

  stop() {
    this.server?.stop(true);
    this.server = null;
  }

  async #fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/mcp') return new Response('not found', { status: 404 });
    if (req.method === 'GET') return new Response(null, { status: 405 }); // no server-initiated SSE
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

    let msg;
    try {
      msg = await req.json();
    } catch {
      return this.#json(rpcError(null, -32700, 'parse error'));
    }
    // Batches: handle each, drop notification (undefined) results.
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => this.#handle(m)))).filter((r) => r !== undefined);
      return out.length ? this.#json(out) : new Response(null, { status: 202 });
    }
    const res = await this.#handle(msg);
    return res === undefined ? new Response(null, { status: 202 }) : this.#json(res);
  }

  #json(body) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': this.sessionId },
    });
  }

  async #handle(msg) {
    const { id, method, params } = msg || {};
    // Notifications have no id and expect no response.
    if (id === undefined || id === null) return undefined;

    switch (method) {
      case 'initialize':
        return rpcOk(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'bridle', version: '0.0.1' },
          instructions:
            'Tools to drive the connected phone: notify, speak, play_audio, show_image, ' +
            'show_file, show_markdown, set_status, ask. Use them to surface results the user ' +
            'is better off hearing or seeing than having read aloud.',
        });
      case 'ping':
        return rpcOk(id, {});
      case 'tools/list':
        return rpcOk(id, { tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call':
        return this.#callTool(id, params);
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  }

  async #callTool(id, params) {
    const tool = this.tools.find((t) => t.name === params?.name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const text = await tool.handler(params.arguments || {});
      return rpcOk(id, { content: [{ type: 'text', text: String(text ?? 'ok') }] });
    } catch (err) {
      return rpcOk(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
    }
  }
}

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const str = (desc) => ({ type: 'string', description: desc });

function buildTools(c) {
  return [
    {
      name: 'notify',
      description: 'Show a short notification toast on the phone.',
      inputSchema: { type: 'object', properties: { text: str('message'), level: { type: 'string', enum: ['info', 'warn', 'error'] } }, required: ['text'] },
      handler: (a) => c.notify(a.text, a.level || 'info'),
    },
    {
      name: 'speak',
      description: "Say something out loud via the phone's text-to-speech.",
      inputSchema: { type: 'object', properties: { text: str('what to say') }, required: ['text'] },
      handler: (a) => c.speak(a.text),
    },
    {
      name: 'play_audio',
      description: 'Send an audio file (local path or URL) to the phone and play it.',
      inputSchema: {
        type: 'object',
        properties: { path: str('local file path'), url: str('http(s) url'), autoplay: { type: 'boolean' }, caption: str('caption') },
      },
      handler: (a) => c.sendAsset('audio', { path: a.path, url: a.url, meta: { autoplay: a.autoplay !== false, caption: a.caption } }),
    },
    {
      name: 'show_image',
      description: 'Send an image (local path or URL) to display on the phone.',
      inputSchema: { type: 'object', properties: { path: str('local file path'), url: str('http(s) url'), caption: str('caption') } },
      handler: (a) => c.sendAsset('image', { path: a.path, url: a.url, meta: { caption: a.caption } }),
    },
    {
      name: 'show_file',
      description: 'Send any file to the phone (offered for download/preview).',
      inputSchema: { type: 'object', properties: { path: str('local file path'), url: str('http(s) url'), name: str('display name') } },
      handler: (a) => c.sendAsset('file', { path: a.path, url: a.url, name: a.name }),
    },
    {
      name: 'show_markdown',
      description: 'Render a markdown card on the phone (good for lists, links, tables).',
      inputSchema: { type: 'object', properties: { markdown: str('markdown body'), title: str('optional title') }, required: ['markdown'] },
      handler: (a) => c.showMarkdown(a.markdown, a.title),
    },
    {
      name: 'set_status',
      description: 'Set a transient status line on the phone (e.g. progress).',
      inputSchema: { type: 'object', properties: { text: str('status text') }, required: ['text'] },
      handler: (a) => c.setStatus(a.text),
    },
    {
      name: 'ask',
      description: 'Ask the user a question on the phone and wait for their spoken or tapped answer.',
      inputSchema: {
        type: 'object',
        properties: { question: str('the question'), choices: { type: 'array', items: { type: 'string' }, description: 'optional choices' } },
        required: ['question'],
      },
      handler: (a) => c.ask(a.question, a.choices),
    },
  ];
}
