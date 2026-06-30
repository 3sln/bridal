// Connection status header. The tether chip opens the switcher. Pure dodo.
import { dd } from '../../runtime.js';

const { alias, div, span } = dd;

const LABELS = {
  'no-tether': 'no tether — scan a QR',
  connecting: 'connecting…',
  waiting: 'waiting for desktop…',
  negotiating: 'linking…',
  tethered: 'tethered',
  reconnecting: 'reconnecting…',
  error: 'error',
};

export default alias(function (state) {
  const self = this;
  const openTethers = () => self.dispatchEvent(new CustomEvent('open-tethers', { bubbles: true }));

  return div({ className: 'status' },
    span({ className: `dot ${state.connection}` }),
    span({ className: 'status-label' }, LABELS[state.connection] || state.connection),
    state.tetherLabel && span({ className: 'agent tether-chip' }, state.tetherLabel).on({ click: openTethers }),
    state.currentSession && span({ className: 'session', title: state.currentSession.id || '' }, state.currentSession.title || ''),
    state.room && span({ className: 'room' }, `#${state.room}`),
  );
});
