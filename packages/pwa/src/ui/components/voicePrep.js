// Full-screen gate shown while the one-time offline speech model downloads,
// before hands-free voice starts. The shimmer bar always animates (so it never
// looks frozen even if the byte count pauses), with a steady monotonic percent
// underneath. Emits `cancel-voice-prep` to back out. Pure dodo.
import { dd } from '../../runtime.js';
import { icon } from '../icon.js';

const { alias, div, p, span, button } = dd;

export default alias(function (state) {
  const self = this;
  const cancel = () => self.dispatchEvent(new CustomEvent('cancel-voice-prep', { bubbles: true }));

  // Totals are usually unknown (HF serves files without Content-Length), so the
  // bar is indeterminate and we show the honest, monotonic downloaded size.
  const mb = state.sttBytes > 0 ? `${(state.sttBytes / 1048576).toFixed(1)} MB downloaded` : 'Starting…';

  return div({ className: 'voice-prep' },
    div({ className: 'vp-card' },
      div({ className: 'vp-orb' }, icon('graphic_eq')),
      p({ className: 'vp-title' }, 'Preparing voice'),
      p({ className: 'vp-sub' }, 'Downloading the on-device speech model. This happens once, then it works offline.'),
      div({ className: 'vp-track indeterminate' }, div({ className: 'vp-bar' })),
      span({ className: 'vp-pct' }, mb),
      button({ className: 'btn ghost vp-cancel' }, 'Cancel').on({ click: cancel }),
    ),
  );
});
