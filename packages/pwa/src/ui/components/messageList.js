// Conversation transcript. Renders text plus assets the agent pushed via MCP
// (audio / image / file / markdown). Keyed list; auto-scrolls to newest.
import { dd } from '../../runtime.js';

const { alias, ul, li, span, div, a, img, h } = dd;

export default alias((messages) =>
  ul({ className: 'messages' }, messages.map(renderMessage)).on({ $attach: scrollToEnd, $update: scrollToEnd }),
);

function renderMessage(m) {
  return li({ className: `msg ${m.role} ${m.kind || ''} ${m.queued ? 'queued' : ''}`.trim() },
    m.kind === 'command' && span({ className: 'tag' }, 'cmd'),
    m.queued && span({ className: 'tag queued-tag' }, 'queued'),
    body(m),
  ).key(m.id);
}

function body(m) {
  switch (m.kind) {
    case 'audio':
      return div({ className: 'bubble asset' },
        h('audio', { className: 'audio', src: m.url, controls: true, autoplay: !!m.autoplay, playsinline: true }),
        m.content && span({ className: 'caption' }, m.content),
      );
    case 'image':
      return a({ className: 'bubble asset', href: m.url, target: '_blank' },
        img({ className: 'image', src: m.url, alt: m.content || m.name || 'image' }),
        m.content && span({ className: 'caption' }, m.content),
      );
    case 'file':
      return a({ className: 'bubble file', href: m.url, download: m.name || 'file' },
        span({ className: 'file-icon' }, '📎'),
        span({ className: 'file-name' }, m.name || m.content || 'download'),
      );
    case 'markdown':
      return div({ className: 'bubble md' },
        m.title && span({ className: 'md-title' }, m.title),
        span({ className: 'md-body' }, m.content),
      );
    default:
      return span({ className: 'bubble' }, m.content);
  }
}

function scrollToEnd(el) {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}
