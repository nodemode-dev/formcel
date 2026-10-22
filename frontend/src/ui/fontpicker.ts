import '../styles/fontpicker.css';
import { ensureFont, fontGroups, isBundled, loadSystemFonts, noteRecentFont } from '../grid/fonts';

export interface FontPickerOpts {
  anchor: HTMLElement;
  current: string;
  theme: () => { heading: string; body: string };
  used: () => string[];
  defaultLabel?: string;
  filterInput?: HTMLInputElement;
  onPick: (name: string) => void;
  onClose?: () => void;
}

export interface FontPickerHandle {
  filter(q: string): void;
  pickActive(): boolean;
  close(): void;
}

let active: { handle: FontPickerHandle; panel: HTMLElement } | null = null;

export function attachFontInput(input: HTMLInputElement, defaultLabel: string, ctx: { theme: () => { heading: string; body: string }; used: () => string[] }): void {
  let handle: FontPickerHandle | null = null;
  const show = (): void => {
    if (handle) return;
    handle = openFontPicker({
      anchor: input,
      current: input.value,
      theme: ctx.theme,
      used: ctx.used,
      defaultLabel,
      filterInput: input,
      onPick: (v) => { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })); },
      onClose: () => { handle = null; },
    });
  };
  input.addEventListener('focus', show);
  input.addEventListener('click', show);
  input.addEventListener('input', () => { show(); handle?.filter(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && handle) {
      e.preventDefault();
      e.stopPropagation();
      if (!handle.pickActive()) handle.close();
    }
  });
}

export interface FontField {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: string): void;
  disable?(off: boolean): void;
}

export function fontField(label: string, defaultLabel: string, onChange: (v: string) => void, ctx: { theme: () => { heading: string; body: string }; used: () => string[] }): FontField {
  const root = mk('label', 'fc-field');
  root.appendChild(mk('span', '', label));
  const input = mk('input', 'fc-input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = defaultLabel;
  root.appendChild(input);
  let value = '';
  let handle: FontPickerHandle | null = null;
  const show = (): void => {
    if (active?.panel && handle) return;
    handle = openFontPicker({
      anchor: input,
      current: value,
      theme: ctx.theme,
      used: ctx.used,
      defaultLabel,
      filterInput: input,
      onPick: (v) => { value = v; input.value = v; onChange(v); },
      onClose: () => { handle = null; },
    });
  };
  input.addEventListener('focus', show);
  input.addEventListener('click', show);
  input.addEventListener('input', () => { show(); handle?.filter(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (handle?.pickActive()) return;
      handle?.close();
      value = input.value.trim();
      onChange(value);
    }
  });
  input.addEventListener('blur', () => window.setTimeout(() => { if (!handle) input.value = value; }, 0));
  return {
    el: root,
    input,
    set(v) {
      value = v;
      if (document.activeElement !== input && input.value !== v) input.value = v;
    },
    disable(off) {
      input.disabled = off;
    },
  };
}

export function closeFontPicker(): void {
  active?.handle.close();
}

export function fontPickerOpen(): boolean {
  return active !== null;
}

interface Row {
  btn: HTMLButtonElement;
  name: string;
  value: string;
  group: HTMLElement;
  seen: boolean;
}

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function openFontPicker(o: FontPickerOpts): FontPickerHandle {
  closeFontPicker();
  const panel = mk('div', 'fp-panel');
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Fonts');
  let own: HTMLInputElement | null = null;
  if (!o.filterInput) {
    own = mk('input', 'fp-search');
    own.type = 'text';
    own.placeholder = 'Search fonts';
    own.spellcheck = false;
    own.autocomplete = 'off';
    own.setAttribute('aria-label', 'Search fonts');
    panel.appendChild(own);
  }
  const scroll = mk('div', 'fp-scroll');
  panel.appendChild(scroll);
  const empty = mk('div', 'fp-empty', 'No match. Press Enter to use the typed name.');
  empty.hidden = true;
  const rows: Row[] = [];
  const heads: { head: HTMLElement; box: HTMLElement }[] = [];
  let activeRow = -1;
  let closed = false;
  let sysFilled = false;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const r = rows.find((x) => x.btn === e.target);
      if (!r || r.seen) continue;
      r.seen = true;
      io.unobserve(r.btn);
      const label = r.btn.firstElementChild as HTMLElement;
      const face = r.name;
      label.style.fontFamily = `"${face}", var(--font-ui)`;
      if (isBundled(face)) void ensureFont(face);
    }
  }, { root: scroll, rootMargin: '120px' });

  const addRow = (box: HTMLElement, group: HTMLElement, label: string, value: string, face: string, opts: { note?: string; italic?: boolean } = {}): void => {
    const btn = mk('button', 'fp-row');
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    const t = mk('span', 'fp-name', label);
    if (opts.italic) t.classList.add('is-missing');
    btn.appendChild(t);
    if (opts.note) btn.appendChild(mk('span', 'fp-note', opts.note));
    if (value === o.current || (!o.current && value === '')) btn.classList.add('is-current');
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => pick(value, face));
    box.appendChild(btn);
    const row: Row = { btn, name: face, value, group, seen: false };
    rows.push(row);
    if (face) io.observe(btn);
  };

  const section = (title: string, note?: string): HTMLElement => {
    const group = mk('div', 'fp-group');
    const head = mk('div', 'fp-head', title);
    group.appendChild(head);
    if (note) group.appendChild(mk('div', 'fp-hint', note));
    scroll.appendChild(group);
    heads.push({ head, box: group });
    return group;
  };

  const build = (system: string[]): void => {
    const g = fontGroups(o.theme(), o.used());
    if (system.length) g.system = system;
    sysFilled = g.system.length > 0;
    if (o.defaultLabel) {
      const top = section('Default');
      addRow(top, top, o.defaultLabel, '', '');
    }
    const th = section('Theme Fonts');
    addRow(th, th, `${g.theme[0].name} (Headings)`, '+heading', g.theme[0].name);
    addRow(th, th, `${g.theme[1].name} (Body)`, '+body', g.theme[1].name);
    if (g.recent.length) {
      const rc = section('Recently Used');
      for (const f of g.recent) addRow(rc, rc, f, f, f);
    }
    if (g.workbook.length) {
      const wb = section('In this workbook', 'Used by cells but not installed on this computer; the name is kept in the file.');
      for (const f of g.workbook) addRow(wb, wb, f, f, f, { italic: true, note: 'not installed' });
    }
    const bd = section('Bundled');
    for (const f of g.bundled) addRow(bd, bd, f, f, f);
    const sy = section('This computer');
    if (g.system.length) for (const f of g.system) addRow(sy, sy, f, f, f);
    else sy.appendChild(mk('div', 'fp-hint', 'Looking for installed fonts...'));
    scroll.appendChild(empty);
  };

  const visible = (): Row[] => rows.filter((r) => !r.btn.hidden);

  const setActive = (i: number): void => {
    const vis = visible();
    if (activeRow >= 0 && rows[activeRow]) rows[activeRow].btn.classList.remove('is-active');
    if (!vis.length) { activeRow = -1; return; }
    const r = vis[Math.max(0, Math.min(vis.length - 1, i))];
    activeRow = rows.indexOf(r);
    r.btn.classList.add('is-active');
    r.btn.scrollIntoView({ block: 'nearest' });
  };

  let lastQuery = '';
  const filter = (q: string): void => {
    lastQuery = q;
    const k = q.trim().toLowerCase();
    let any = false;
    for (const r of rows) {
      const show = !k || r.value === '' && !k || r.btn.textContent!.toLowerCase().includes(k);
      if (r.btn.hidden !== !show) r.btn.hidden = !show;
      if (show) any = true;
    }
    for (const h of heads) {
      const some = Array.from(h.box.querySelectorAll<HTMLElement>('.fp-row')).some((b) => !b.hidden);
      const hide = !some && !!k;
      if (h.box.hidden !== hide) h.box.hidden = hide;
    }
    if (empty.hidden !== any) empty.hidden = any;
    if (activeRow >= 0 && rows[activeRow]) rows[activeRow].btn.classList.remove('is-active');
    activeRow = -1;
    if (k && any) setActive(0);
  };

  const pick = (value: string, face: string): void => {
    if (value && !value.startsWith('+')) noteRecentFont(face || value);
    close();
    o.onPick(value);
  };

  const pickActive = (): boolean => {
    if (activeRow < 0 || !rows[activeRow] || rows[activeRow].btn.hidden) return false;
    const r = rows[activeRow];
    pick(r.value, r.name);
    return true;
  };

  const place = (): void => {
    const r = o.anchor.getBoundingClientRect();
    const w = Math.max(260, Math.round(r.width));
    panel.style.width = `${w}px`;
    panel.style.left = `${Math.round(Math.max(4, Math.min(r.left, window.innerWidth - w - 4)))}px`;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const h = Math.min(420, Math.max(160, below >= 240 || below >= above ? below : above));
    panel.style.maxHeight = `${h}px`;
    if (below >= 240 || below >= above) { panel.style.top = `${Math.round(r.bottom + 1)}px`; panel.style.bottom = ''; }
    else { panel.style.top = ''; panel.style.bottom = `${Math.round(window.innerHeight - r.top + 1)}px`; }
  };

  const onDown = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (panel.contains(t) || o.anchor.contains(t)) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); o.anchor.querySelector('input')?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const vis = visible();
      const at = activeRow >= 0 ? vis.indexOf(rows[activeRow]) : -1;
      setActive(e.key === 'ArrowDown' ? at + 1 : at < 0 ? vis.length - 1 : at - 1);
    } else if (e.key === 'Enter' && own && pickActive()) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    io.disconnect();
    panel.remove();
    if (active?.panel === panel) active = null;
    o.onClose?.();
  }

  const handle: FontPickerHandle = { filter, pickActive, close };
  build([]);
  place();
  (document.getElementById('overlay-root') ?? document.body).appendChild(panel);
  active = { handle, panel };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  own?.addEventListener('input', () => filter(own!.value));
  if (own) own.focus({ preventScroll: true });
  const cur = rows.find((r) => r.btn.classList.contains('is-current') && r.name);
  if (cur) scroll.scrollTop = Math.max(0, cur.btn.offsetTop - 80);

  void loadSystemFonts().then((names) => {
    if (closed || sysFilled) return;
    const sy = heads[heads.length - 1];
    const stub = sy.box.querySelector('.fp-hint');
    if (!names.length) { if (stub) stub.textContent = 'No installed fonts could be listed here.'; return; }
    stub?.remove();
    for (const f of names) addRow(sy.box, sy.box, f, f, f);
    if (lastQuery) filter(lastQuery);
  });

  return handle;
}
