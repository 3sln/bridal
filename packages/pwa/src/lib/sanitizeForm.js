// Sanitize agent-supplied form HTML before it's rendered on the phone. The agent
// is the user's own (trusted-ish), but we still refuse anything that could run
// script or phone home: no <script>/<style>/<iframe>, no on* handlers, no
// javascript: URLs, and no external resource loads (src/href to the network).
// Allowlist of tags + attributes; everything else is dropped. Parsing is done
// with the browser's own DOMParser (inert — it doesn't execute anything).

const ALLOWED_TAGS = new Set([
  'form', 'fieldset', 'legend', 'label', 'input', 'textarea', 'select', 'option', 'optgroup', 'button', 'datalist',
  'div', 'section', 'p', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'small', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
]);

// Attributes safe to keep. `style` is allowed for layout but scrubbed of url()/expression.
const ALLOWED_ATTRS = new Set([
  'name', 'type', 'value', 'placeholder', 'checked', 'selected', 'disabled', 'readonly', 'required',
  'min', 'max', 'step', 'minlength', 'maxlength', 'pattern', 'multiple', 'accept', 'rows', 'cols', 'size',
  'for', 'id', 'label', 'list', 'inputmode', 'autocomplete', 'title', 'colspan', 'rowspan', 'class', 'style',
]);

// input types we allow (drop image/button-with-formaction style vectors are handled by attr scrub anyway).
const ALLOWED_INPUT_TYPES = new Set([
  'text', 'textarea', 'email', 'url', 'tel', 'number', 'password', 'search',
  'checkbox', 'radio', 'range', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'file', 'hidden', 'submit',
]);

function scrubStyle(v) {
  return /url\s*\(|expression\s*\(|@import|javascript:/i.test(v) ? '' : v;
}

function clean(node, doc) {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType === 3) continue; // text — safe
    if (child.nodeType !== 1) {
      child.remove(); // comments, etc.
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      const drop =
        !ALLOWED_ATTRS.has(name) ||
        name.startsWith('on') ||
        (name === 'type' && tag === 'input' && !ALLOWED_INPUT_TYPES.has(val.toLowerCase())) ||
        (/^(href|src|action|formaction|xlink:href)$/.test(name) && /^\s*(javascript|data|vbscript):/i.test(val));
      if (drop) {
        child.removeAttribute(attr.name);
      } else if (name === 'style') {
        const s = scrubStyle(val);
        if (s) child.setAttribute('style', s);
        else child.removeAttribute('style');
      }
    }
    clean(child, doc);
  }
}

/** Return a sanitized HTML string safe to inject into the form's shadow root. */
export function sanitizeFormHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}
