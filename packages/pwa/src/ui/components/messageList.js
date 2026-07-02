// Conversation transcript. Renders text plus assets the agent pushed via MCP
// (audio / image / file / markdown). Keyed list; auto-scrolls to newest.
import { dd } from '../../runtime.js';
import { icon } from '../icon.js';

const { alias, ul, li, span, div, a, img, h } = dd;

// Delivery states shown on the user's own messages so nothing looks sent when it
// isn't: pending (on the way / held), sent (on the wire), read (agent picked up).
const DELIVERY = {
  pending: { glyph: 'schedule', label: 'Pending — not delivered yet' },
  sent: { glyph: 'check', label: 'Sent to your desktop' },
  read: { glyph: 'done_all', label: 'The agent has this' },
};

export default alias((messages) =>
  ul({ className: 'messages' }, messages.map(renderMessage)).on({ $attach: scrollToEnd, $update: scrollToEnd }),
);

function renderMessage(m) {
  return li({ className: `msg ${m.role} ${m.kind || ''} ${m.queued ? 'queued' : ''}`.trim() },
    m.kind === 'command' && span({ className: 'tag' }, 'cmd'),
    m.queued && span({ className: 'tag queued-tag' }, 'queued'),
    body(m),
    deliveryMark(m),
  ).key(m.id);
}

function deliveryMark(m) {
  if (m.role !== 'user' || !m.delivery || m.kind === 'command' || m.kind === 'answer') return null;
  const d = DELIVERY[m.delivery];
  return d ? span({ className: `delivery ${m.delivery}`, title: d.label, 'aria-label': d.label }, icon(d.glyph)) : null;
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
