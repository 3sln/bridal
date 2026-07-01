// Renders an agent-supplied form. The (sanitized) HTML is mounted in a Shadow
// DOM so the agent's markup can't clash with the app, with a themed stylesheet
// injected so it still looks native. On submit we split text fields from file
// inputs and emit `submit-form` { id, values, files: [{field, file}] }; the
// tether uploads the files and returns text values. Emits `cancel-form` on
// backdrop/Cancel.
import { dd } from '../../runtime.js';
import { sanitizeFormHtml } from '../../lib/sanitizeForm.js';

const { alias, div } = dd;

// CSS variables inherit through the shadow boundary, so the app theme carries in.
const FORM_CSS = `
  :host { display: block; }
  .bf { display: flex; flex-direction: column; gap: 14px; color: var(--text); font: 15px/1.5 'Inter', system-ui, sans-serif; }
  .bf-title { margin: 0; font-size: 18px; font-weight: 700; }
  .bf-body { display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--muted); }
  label > input, label > textarea, label > select { margin-top: 2px; }
  input, textarea, select {
    width: 100%; padding: 11px 13px; border-radius: 12px; border: 1px solid var(--line);
    background: var(--bg-soft); color: var(--text); font: inherit; box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,92,255,.16); }
  textarea { min-height: 90px; resize: vertical; }
  input[type=checkbox], input[type=radio] { width: 20px; height: 20px; accent-color: var(--accent); vertical-align: middle; margin-right: 8px; }
  input[type=range] { accent-color: var(--accent); padding: 0; }
  input[type=color] { height: 40px; padding: 4px; }
  input[type=file] { padding: 10px; }
  fieldset { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  legend { padding: 0 6px; color: var(--muted); font-size: 13px; }
  .bf-row { display: flex; align-items: center; gap: 8px; }
  .bf-actions { display: flex; gap: 10px; margin-top: 4px; }
  .bf-actions button { flex: 1; appearance: none; padding: 13px; border-radius: 14px; font: 600 15px 'Inter', sans-serif; cursor: pointer; border: 1px solid var(--line); }
  .bf-cancel { background: transparent; color: var(--text); }
  .bf-submit { background: var(--grad, var(--accent)); color: #fff; border-color: transparent; }
  h1,h2,h3,h4 { margin: 0; } p { margin: 0; }
`;

function collect(formEl) {
  const values = {};
  const files = [];
  for (const el of formEl.elements) {
    if (!el.name || el.type === 'submit' || el.type === 'button') continue;
    if (el.type === 'file') {
      for (const f of el.files) files.push({ field: el.name, file: f });
    } else if (el.type === 'checkbox') {
      if (el.checked) values[el.name] = el.value && el.value !== 'on' ? el.value : true;
    } else if (el.type === 'radio') {
      if (el.checked) values[el.name] = el.value;
    } else {
      values[el.name] = el.value;
    }
  }
  return { values, files };
}

export default alias(function (state) {
  const self = this;
  const f = state.form;
  const fire = (type, detail) => self.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

  const mount = (host) => {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${FORM_CSS}</style><form class="bf">${
      f.title ? '<h3 class="bf-title"></h3>' : ''
    }<div class="bf-body"></div><div class="bf-actions"><button type="button" class="bf-cancel">Cancel</button><button type="submit" class="bf-submit"></button></div></form>`;
    if (f.title) root.querySelector('.bf-title').textContent = f.title;
    root.querySelector('.bf-body').innerHTML = sanitizeFormHtml(f.html);
    root.querySelector('.bf-submit').textContent = f.submit || 'Submit';
    const formEl = root.querySelector('form');
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const { values, files } = collect(formEl);
      fire('submit-form', { id: f.id, values, files });
    });
    root.querySelector('.bf-cancel').addEventListener('click', () => fire('cancel-form', { id: f.id }));
  };

  return div({ className: 'sheet-backdrop form-backdrop' },
    div({ className: 'sheet form-sheet' }).on({ $attach: mount }),
  ).on({
    click: (e) => { if (e.target.classList.contains('form-backdrop')) fire('cancel-form', { id: f.id }); },
  });
});
