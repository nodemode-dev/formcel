import { actions, makeModal } from './modal';
import { DEFAULT_QAT, type Qat } from './qat';
import { el, escapeHtml } from './rb-dom';
import { rbIcon } from './rb-icons';
import type { RbCommands } from './rb-state';
import type { CustomTab, Ribbon, RibbonConfig } from './ribbon';

interface Pick { node: HTMLElement; current(): string | null; onAdd: ((id: string) => void) | null }

function askName(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const m = makeModal(title);
    const input = document.createElement('input');
    input.className = 'fc-fmt-input';
    input.value = initial;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Display name');
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      m.el.remove();
      resolve(v);
    };
    const ok = (): void => { const v = input.value.trim(); m.close(); finish(v || null); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    m.body.append(input, actions('OK', ok, () => { m.close(); finish(null); }));
    m.open(input);
    input.select();
  });
}

function commandPicker(commands: RbCommands, title: string): Pick {
  const node = el('<div class="rb-cz-col"><label class="rb-cz-cap"><span></span><input class="fc-fmt-input" type="search" spellcheck="false"></label><div class="rb-cz-list" role="group"></div></div>');
  (node.querySelector('.rb-cz-cap span') as HTMLElement).textContent = title;
  const input = node.querySelector('input') as HTMLInputElement;
  input.setAttribute('aria-label', 'Search commands');
  input.placeholder = 'Search commands';
  const list = node.querySelector('.rb-cz-list') as HTMLElement;
  const all = commands.ids().map((id) => ({ id, label: commands.label(id), icon: commands.icon(id) })).sort((a, b) => a.label.localeCompare(b.label));
  const pick: Pick = { node, current: () => list.querySelector<HTMLElement>('[aria-pressed="true"]')?.dataset.id ?? null, onAdd: null };
  const rows = all.map((c) => {
    const b = el<HTMLButtonElement>(`<button class="rb-cz-row" type="button" aria-pressed="false" data-id="${escapeHtml(c.id)}">${rbIcon(c.icon, 14)}<span></span></button>`);
    (b.lastElementChild as HTMLElement).textContent = c.label;
    b.addEventListener('click', () => { for (const r of rows) r.setAttribute('aria-pressed', String(r === b)); });
    b.addEventListener('dblclick', () => pick.onAdd?.(c.id));
    return b;
  });
  list.append(...rows);
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    rows.forEach((r, i) => { r.hidden = !!q && !all[i].label.toLowerCase().includes(q) && !all[i].id.includes(q); });
  });
  return pick;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const tool = (label: string, ic: string, run: () => void): HTMLButtonElement => {
  const b = el<HTMLButtonElement>(`<button class="fc-btn rb-cz-btn" type="button" aria-label="${label}" title="${label}">${rbIcon(ic, 14)}</button>`);
  b.addEventListener('click', run);
  return b;
};

const word = (label: string, run: () => void): HTMLButtonElement => {
  const b = el<HTMLButtonElement>('<button class="fc-btn rb-cz-btn rb-cz-word" type="button"></button>');
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
};

export function customizeQat(commands: RbCommands, qat: Qat): void {
  const dlg = makeModal('Customize Quick Access Toolbar', { wide: true });
  dlg.el.classList.add('rb-cz');
  let items = [...qat.items];
  let sel: string | null = null;
  let below = qat.below;
  const left = commandPicker(commands, 'Choose commands');
  const right = el('<div class="rb-cz-col"><div class="rb-cz-cap"><span>Quick Access Toolbar</span></div><div class="rb-cz-list" role="group" aria-label="Quick Access Toolbar commands"></div></div>');
  const list = right.querySelector('.rb-cz-list') as HTMLElement;
  const mid = el('<div class="rb-cz-mid"></div>');
  const render = (): void => {
    list.textContent = '';
    for (const id of items) {
      const b = el<HTMLButtonElement>(`<button class="rb-cz-row" type="button" aria-pressed="${id === sel}" data-id="${escapeHtml(id)}">${rbIcon(commands.icon(id), 14)}<span></span></button>`);
      (b.lastElementChild as HTMLElement).textContent = commands.label(id);
      b.addEventListener('click', () => { sel = id; render(); });
      list.appendChild(b);
    }
  };
  const add = (id: string): void => { if (!items.includes(id)) { items = [...items, id]; sel = id; render(); } };
  left.onAdd = add;
  const move = (d: number): void => {
    if (!sel) return;
    const i = items.indexOf(sel), j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
    render();
    list.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  };
  mid.append(
    tool('Add command', 'chevronRight', () => { const id = left.current(); if (id) add(id); }),
    tool('Remove command', 'chevronLeft', () => { if (sel) { items = items.filter((x) => x !== sel); sel = null; render(); } }),
    tool('Move up', 'chevronUp', () => move(-1)),
    tool('Move down', 'chevronDown', () => move(1)),
  );
  const wrap = el('<div class="rb-cz-grid"></div>');
  wrap.append(left.node, mid, right);
  const place = el('<label class="rb-cz-check"><input type="checkbox" class="rb-cz-box"> Show Quick Access Toolbar below the ribbon</label>');
  const box = place.querySelector('input') as HTMLInputElement;
  box.checked = below;
  box.addEventListener('change', () => { below = box.checked; });
  dlg.body.append(wrap, place);
  const reset = word('Reset', () => { items = [...DEFAULT_QAT]; sel = null; below = false; box.checked = false; render(); });
  dlg.body.append(actions('OK', () => { qat.set(items); qat.setBelow(below); dlg.close(); }, () => dlg.close(), [reset]));
  render();
  dlg.open(left.node.querySelector('input'));
  const mo = new MutationObserver(() => { if (dlg.el.hidden) { dlg.el.remove(); mo.disconnect(); } });
  mo.observe(dlg.el, { attributes: true, attributeFilter: ['hidden'] });
}

type Sel = { kind: 'tab' | 'group' | 'cmd'; tab: string; group?: string; cmd?: string } | null;

export function customizeRibbon(commands: RbCommands, ribbon: Ribbon): void {
  const dlg = makeModal('Customize the Ribbon', { wide: true });
  dlg.el.classList.add('rb-cz');
  const cfg: RibbonConfig = clone(ribbon.config);
  const builtin = ribbon.catalog().filter((t) => !t.custom);
  let sel: Sel = null;
  const left = commandPicker(commands, 'Choose commands');
  const right = el('<div class="rb-cz-col"><div class="rb-cz-cap"><span>Customize the ribbon</span></div><div class="rb-cz-list" role="group" aria-label="Ribbon tabs and groups"></div></div>');
  const list = right.querySelector('.rb-cz-list') as HTMLElement;
  const mid = el('<div class="rb-cz-mid"></div>');
  const same = (a: Sel, b: Sel): boolean => !!a && !!b && a.kind === b.kind && a.tab === b.tab && a.group === b.group && a.cmd === b.cmd;
  const customTab = (id: string): CustomTab | undefined => cfg.custom.find((t) => t.id === id);
  const row = (level: number, label: string, s: NonNullable<Sel>, hideKey?: { list: 'hiddenTabs' | 'hiddenGroups'; key: string }): HTMLElement => {
    const r = el(`<div class="rb-cz-item" style="--lvl:${level}"></div>`);
    if (hideKey) {
      const b = el<HTMLInputElement>('<input class="rb-cz-box" type="checkbox">');
      b.checked = !cfg[hideKey.list].includes(hideKey.key);
      b.setAttribute('aria-label', `Show ${label}`);
      b.addEventListener('change', () => { cfg[hideKey.list] = b.checked ? cfg[hideKey.list].filter((k) => k !== hideKey.key) : [...cfg[hideKey.list], hideKey.key]; });
      r.appendChild(b);
    }
    const b = el<HTMLButtonElement>(`<button class="rb-cz-row" type="button" aria-pressed="${same(sel, s)}"><span></span></button>`);
    (b.querySelector('span') as HTMLElement).textContent = label;
    b.addEventListener('click', () => { sel = s; render(); });
    r.appendChild(b);
    return r;
  };
  const render = (): void => {
    list.textContent = '';
    for (const t of builtin.filter((x) => !x.ctx)) {
      list.appendChild(row(0, t.label, { kind: 'tab', tab: t.id }, { list: 'hiddenTabs', key: t.id }));
      for (const g of t.groups) list.appendChild(row(1, g.label, { kind: 'group', tab: t.id, group: g.id }, { list: 'hiddenGroups', key: g.key }));
    }
    for (const c of cfg.custom) {
      list.appendChild(row(0, `${c.label} (Custom)`, { kind: 'tab', tab: c.id }, { list: 'hiddenTabs', key: c.id }));
      for (const g of c.groups) {
        list.appendChild(row(1, `${g.label} (Custom)`, { kind: 'group', tab: c.id, group: g.id }, { list: 'hiddenGroups', key: `${c.id}.${g.id}` }));
        for (const id of g.cmds) list.appendChild(row(2, commands.label(id), { kind: 'cmd', tab: c.id, group: g.id, cmd: id }));
      }
    }
    for (const t of builtin.filter((x) => x.ctx)) {
      list.appendChild(row(0, `${t.label} (Contextual)`, { kind: 'tab', tab: t.id }, { list: 'hiddenTabs', key: t.id }));
      for (const g of t.groups) list.appendChild(row(1, g.label, { kind: 'group', tab: t.id, group: g.id }, { list: 'hiddenGroups', key: g.key }));
    }
  };
  const targetGroup = (): { tab: CustomTab; group: CustomTab['groups'][number] } | null => {
    if (!sel) return null;
    const tab = customTab(sel.tab);
    if (!tab) return null;
    const group = sel.group ? tab.groups.find((g) => g.id === sel?.group) : tab.groups[0];
    return group ? { tab, group } : null;
  };
  const uid = (p: string): string => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  const addCmd = (id: string): void => {
    const t = targetGroup();
    if (!t || t.group.cmds.includes(id)) return;
    t.group.cmds.push(id);
    sel = { kind: 'cmd', tab: t.tab.id, group: t.group.id, cmd: id };
    render();
  };
  left.onAdd = addCmd;
  const siblings = (): unknown[] | null => {
    if (!sel) return null;
    if (sel.kind === 'tab') return customTab(sel.tab) ? cfg.custom : null;
    const tab = customTab(sel.tab);
    if (!tab) return null;
    if (sel.kind === 'group') return tab.groups;
    return tab.groups.find((g) => g.id === sel?.group)?.cmds ?? null;
  };
  const current = (): unknown => {
    if (!sel) return null;
    if (sel.kind === 'tab') return customTab(sel.tab);
    const tab = customTab(sel.tab);
    if (sel.kind === 'group') return tab?.groups.find((g) => g.id === sel?.group);
    return sel.cmd;
  };
  const move = (d: number): void => {
    const arr = siblings();
    const cur = current();
    if (!arr || cur === null || cur === undefined) return;
    const i = arr.indexOf(cur), j = i + d;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    render();
  };
  mid.append(
    word('Add', () => { const id = left.current(); if (id) addCmd(id); }),
    word('Remove', () => {
      if (!sel || !customTab(sel.tab)) return;
      const arr = siblings();
      const cur = current();
      if (!arr || cur === null || cur === undefined) return;
      arr.splice(arr.indexOf(cur), 1);
      sel = null;
      render();
    }),
    word('Up', () => move(-1)),
    word('Down', () => move(1)),
  );
  const tools = el('<div class="rb-cz-tools"></div>');
  tools.append(
    word('New Tab', () => { const t: CustomTab = { id: uid('ct'), label: 'New Tab', groups: [{ id: uid('cg'), label: 'New Group', cmds: [] }] }; cfg.custom.push(t); sel = { kind: 'tab', tab: t.id }; render(); }),
    word('New Group', () => { const t = sel ? customTab(sel.tab) : undefined; if (!t) return; const g = { id: uid('cg'), label: 'New Group', cmds: [] }; t.groups.push(g); sel = { kind: 'group', tab: t.id, group: g.id }; render(); }),
    word('Rename', () => {
      const cur = current() as { label?: string } | string | null | undefined;
      if (!cur || typeof cur === 'string' || cur.label === undefined) return;
      void askName('Rename', cur.label).then((name) => { if (name) { cur.label = name; render(); } });
    }),
  );
  right.appendChild(tools);
  const wrap = el('<div class="rb-cz-grid"></div>');
  wrap.append(left.node, mid, right);
  dlg.body.append(wrap, el('<p class="rb-cz-note">Untick a tab or group to hide it. New tabs and groups can hold any command.</p>'));
  const reset = word('Reset', () => { cfg.hiddenTabs = []; cfg.hiddenGroups = []; cfg.custom = []; sel = null; render(); });
  dlg.body.append(actions('OK', () => { ribbon.applyConfig(cfg); dlg.close(); }, () => dlg.close(), [reset]));
  render();
  dlg.open(left.node.querySelector('input'));
  const mo = new MutationObserver(() => { if (dlg.el.hidden) { dlg.el.remove(); mo.disconnect(); } });
  mo.observe(dlg.el, { attributes: true, attributeFilter: ['hidden'] });
}
