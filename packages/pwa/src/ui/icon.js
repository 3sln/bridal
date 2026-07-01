// Material Symbols glyph. The icon font is loaded in index.html; the ligature
// name (e.g. 'mic', 'send') renders as the glyph, or as plain text if the font
// hasn't loaded (offline first paint) — which still reads sensibly.
import { dd } from '../runtime.js';

const { span } = dd;

export const icon = (name, className = '') =>
  span({ className: `msym ${className}`.trim(), 'aria-hidden': 'true' }, name);
