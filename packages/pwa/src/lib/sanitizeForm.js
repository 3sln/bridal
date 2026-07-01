// Sanitize agent-supplied form HTML before it's rendered on the phone, using
// DOMPurify (battle-tested; handles mutation-XSS and the long tail a hand-rolled
// allowlist would miss). We keep the allowlist scoped to form controls + basic
// layout so the agent can build surveys/inputs but nothing can run script or
// phone home.
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'form', 'fieldset', 'legend', 'label', 'input', 'textarea', 'select', 'option', 'optgroup', 'button', 'datalist', 'output',
  'div', 'section', 'p', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'small', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
];

const ALLOWED_ATTR = [
  'name', 'type', 'value', 'placeholder', 'checked', 'selected', 'disabled', 'readonly', 'required',
  'min', 'max', 'step', 'minlength', 'maxlength', 'pattern', 'multiple', 'accept', 'rows', 'cols', 'size',
  'for', 'id', 'label', 'list', 'inputmode', 'autocomplete', 'title', 'colspan', 'rowspan', 'class', 'style',
];

/** Return a sanitized HTML string safe to inject into the form's shadow root. */
export function sanitizeFormHtml(html) {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['action', 'formaction'], // we own submission; never navigate
    ADD_ATTR: [], // no exceptions
  });
}
