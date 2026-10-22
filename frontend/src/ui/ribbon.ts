import { el, escapeHtml, setClass, setDisabled, setHidden, setStyleVar, setTitle } from './rb-dom';
import { rbIcon } from './rb-icons';
import { RbMenus, type MenuSrc, type MItem } from './rb-menu';
import { rbState, type RbCommands } from './rb-state';
import type { TipHost } from './key-tips';
import type { Qat } from './qat';

export const RIBBON_KEY = 'formcel.ribbon';

export interface Item {
  k: 'cmd' | 'act' | 'split' | 'menu' | 'slot';
  id: string;
  label?: string;
  icon?: string;
  text?: boolean;
  swatch?: boolean;
  menu?: MenuSrc;
  cmdId?: string;
  run?: (anchor: HTMLElement) => void;
  title?: string;
  keep?: boolean;
}
export interface Rows { rows: Item[][] }
export type Unit = Item | Rows;
export interface GroupDef { id: string; label: string; units: Unit[]; icon?: string; rank?: number }
export interface TabDef { id: string; label: string; groups: GroupDef[]; ctx?: boolean; custom?: boolean }
export interface CustomGroup { id: string; label: string; cmds: string[] }
export interface CustomTab { id: string; label: string; groups: CustomGroup[] }
export interface RibbonConfig { hiddenTabs: string[]; hiddenGroups: string[]; custom: CustomTab[] }
export interface RibbonOpts {
  tabs: TabDef[];
  simple: Item[];
  slots: Record<string, () => HTMLElement>;
  after: () => void;
  fileMenu: () => MItem[];
  openBackstage: () => boolean;
  customize: (what: 'ribbon' | 'qat') => void;
  say: (text: string) => void;
}

interface Step { lv: number; gal: number }
interface Meas { rev: number; steps: Step[]; w: number[] }
interface Saved extends Partial<RibbonConfig> { collapsed?: boolean; simplified?: boolean; compact?: boolean; tab?: string }

const readJson = <T,>(key: string): Partial<T> => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as Partial<T>) : {}; } catch { return {}; }
};

export class Ribbon {
  readonly root: HTMLElement;
  readonly simpleBar: HTMLElement;
  readonly menus: RbMenus;
  collapsed = false;
  simplified = false;
  compact = false;
  tab = 'home';
  config: RibbonConfig = { hiddenTabs: [], hiddenGroups: [], custom: [] };
  private float = false;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly list: HTMLElement;
  private readonly tabBtns = new Map<string, HTMLButtonElement>();
  private readonly panels = new Map<string, HTMLElement>();
  private readonly defs = new Map<string, TabDef>();
  private readonly ctxShown = new Set<string>();
  private readonly rover = new Map<HTMLElement, HTMLElement>();
  private readonly items = new WeakMap<HTMLElement, Item>();
  private readonly closedAt = new Map<string, number>();
  private readonly collapseBtn: HTMLButtonElement;
  private readonly compactBtn: HTMLButtonElement;
  private readonly fileBtn: HTMLButtonElement;
  private mark = '';
  private readonly gpop: HTMLElement;
  private popGroup: HTMLElement | null = null;
  private readonly meas = new WeakMap<HTMLElement, Meas>();
  private rev = 0;
  private fitKey = '';
  private fitRaf = 0;
  private look = '';

  constructor(host: HTMLElement, private readonly commands: RbCommands, readonly qat: Qat, private readonly opts: RibbonOpts, menus: RbMenus) {
    this.menus = menus;
    const s = readJson<Saved>(RIBBON_KEY);
    this.collapsed = !!s.collapsed;
    this.simplified = !!s.simplified;
    this.compact = !!s.compact;
    if (typeof s.tab === 'string') this.tab = s.tab;
    this.config = { hiddenTabs: Array.isArray(s.hiddenTabs) ? s.hiddenTabs : [], hiddenGroups: Array.isArray(s.hiddenGroups) ? s.hiddenGroups : [], custom: Array.isArray(s.custom) ? s.custom : [] };
    this.root = el(`<div class="rb">
<div class="rb-tabs"><button class="rb-file" type="button" aria-haspopup="menu" aria-expanded="false">File</button><div class="rb-tablist" role="tablist" aria-label="Ribbon tabs"></div><div class="rb-tools"><button class="rb-tool" type="button" data-tool="compact" aria-pressed="false" aria-label="Icons-only ribbon" title="Icons-only ribbon">${rbIcon('iconRail', 14)}</button><button class="rb-tool" type="button" data-tool="collapse" aria-expanded="true" aria-label="Collapse the ribbon (Ctrl+F1)" title="Collapse the ribbon (Ctrl+F1)">${rbIcon('chevronUp', 14)}</button></div></div>
<div class="rb-body"></div>
</div>`);
    this.tabsEl = this.root.querySelector('.rb-tabs') as HTMLElement;
    this.list = this.root.querySelector('.rb-tablist') as HTMLElement;
    this.body = this.root.querySelector('.rb-body') as HTMLElement;
    this.fileBtn = this.root.querySelector('.rb-file') as HTMLButtonElement;
    this.collapseBtn = this.root.querySelector('[data-tool="collapse"]') as HTMLButtonElement;
    this.compactBtn = this.root.querySelector('[data-tool="compact"]') as HTMLButtonElement;
    this.gpop = el('<div class="rb-gpop" role="toolbar" hidden></div>');
    this.root.appendChild(this.gpop);
    this.simpleBar = el('<div class="rb-simple" role="toolbar" aria-label="Simplified ribbon" hidden></div>');
    for (const it of opts.simple) { const n = this.item(it, false); if (n) this.simpleBar.appendChild(n); }
    for (const n of Array.from(this.simpleBar.querySelectorAll<HTMLElement>('button, input'))) n.setAttribute('tabindex', '0');
    this.tabsEl.insertBefore(qat.node, this.list);
    host.append(this.root, this.simpleBar);
    rbState.root = host;
    for (const t of opts.tabs) this.buildTab(t);
    this.buildCustom();
    this.wire();
    qat.onContext = (id, x, y) => this.contextMenu(id, x, y);
    qat.onMore = (a) => this.qatMenu(a);
    this.applyVisibility();
    if (!this.defs.has(this.tab) || this.tabHidden(this.tab)) this.tab = 'home';
    this.showTab(this.tab);
    this.applyMode();
    this.watchLayout();
    rbState.on(() => this.sync());
  }

  private watchLayout(): void {
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.fit()).observe(this.body);
    const bump = (): void => { this.rev++; this.queueFit(); };
    document.fonts?.addEventListener?.('loadingdone', bump);
    this.look = this.lookKey();
    const watch = (): void => { const k = this.lookKey(); if (k !== this.look) { this.look = k; bump(); } };
    new MutationObserver(watch).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    new MutationObserver(watch).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private lookKey(): string {
    const cs = getComputedStyle(document.body);
    return `${document.body.className}|${document.documentElement.className}|${cs.fontFamily}|${cs.fontSize}`;
  }

  private watchSlot(n: HTMLElement): void {
    const bump = (): void => { this.rev++; this.queueFit(); };
    new MutationObserver(bump).observe(n, { childList: true, subtree: true });
    new MutationObserver(bump).observe(n, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }

  private wire(): void {
    const click = (e: MouseEvent): void => this.onClick(e);
    this.root.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('.rb-btn, .rb-tool, .rb-file')) e.preventDefault(); });
    this.simpleBar.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('.rb-btn')) e.preventDefault(); });
    this.root.addEventListener('click', click);
    this.simpleBar.addEventListener('click', click);
    this.root.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.rb-tab')) this.setCollapsed(!this.collapsed); });
    this.root.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('input')) return;
      e.preventDefault();
      const b = (e.target as HTMLElement).closest<HTMLElement>('.rb-btn[data-cmd]');
      this.contextMenu(b?.dataset.cmd ?? null, e.clientX, e.clientY);
    });
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      const panel = t.closest<HTMLElement>('.rb-panel');
      if (panel && (t instanceof HTMLButtonElement || t instanceof HTMLInputElement)) this.setRove(panel, t);
    });
    this.root.addEventListener('wheel', (e) => {
      const sc = (e.target as HTMLElement).closest<HTMLElement>('.rb-body');
      if (sc && Math.abs(e.deltaY) > Math.abs(e.deltaX)) sc.scrollLeft += e.deltaY;
    }, { passive: true });
    const keepOpen = '.rb-menu, .rb-pop, .rb-scrim';
    document.addEventListener('pointerdown', (e) => { const t = e.target as HTMLElement; if (this.popGroup && !this.gpop.contains(t) && !t.closest?.(`.rb-gbtn, ${keepOpen}`)) this.closePop(false); }, true);
    this.root.addEventListener('focusout', (e) => { const to = e.relatedTarget as HTMLElement | null; if (this.popGroup && to && !this.gpop.contains(to) && !to.closest(`.rb-gbtn, ${keepOpen}`)) this.closePop(false); });
    document.addEventListener('pointerdown', (e) => { if (this.float && !this.root.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(keepOpen)) this.setFloat(false); }, true);
  }

  private buildTab(def: TabDef): void {
    this.defs.set(def.id, def);
    const tab = el<HTMLButtonElement>(`<button class="rb-tab${def.ctx ? ' is-ctx' : ''}" type="button" role="tab" id="rbt-${def.id}" aria-controls="rbp-${def.id}" aria-selected="false" tabindex="-1" data-tab="${def.id}"></button>`);
    tab.textContent = def.label;
    const panel = el(`<div class="rb-panel" role="tabpanel" id="rbp-${def.id}" aria-labelledby="rbt-${def.id}" data-tab="${def.id}" hidden></div>`);
    if (def.custom) { tab.dataset.custom = '1'; panel.dataset.custom = '1'; }
    for (const g of def.groups) {
      const node = this.buildGroup(def, g);
      if (node) panel.appendChild(node);
    }
    for (const n of Array.from(panel.querySelectorAll<HTMLElement>('button, input'))) n.setAttribute('tabindex', '-1');
    this.tabBtns.set(def.id, tab);
    this.panels.set(def.id, panel);
    this.list.appendChild(tab);
    this.body.appendChild(panel);
  }

  private buildGroup(tab: TabDef, g: GroupDef): HTMLElement | null {
    const label = escapeHtml(g.label);
    const node = el(`<div class="rb-group" role="toolbar" aria-label="${label}" data-g="${tab.id}.${g.id}"><button class="rb-btn rb-gbtn is-large" type="button" data-group="1" aria-haspopup="true" aria-expanded="false" aria-label="${label}" title="${label}"><span class="rb-ic">${rbIcon(g.icon ?? this.groupIcon(g), 28)}</span><span class="rb-lbl"><span>${label}</span>${rbIcon('chevronDown', 10)}</span></button><div class="rb-gbody"></div><div class="rb-glabel" aria-hidden="true">${label}</div></div>`);
    if (g.rank) node.dataset.rank = String(g.rank);
    const body = node.querySelector('.rb-gbody') as HTMLElement;
    for (const u of g.units) {
      if ('rows' in u) {
        const col = el(`<div class="rb-stack" style="--n:${u.rows.length}"></div>`);
        for (const r of u.rows) {
          const row = el('<div class="rb-row"></div>');
          for (const it of r) { const n = this.item(it, false); if (n) row.appendChild(n); }
          if (row.childElementCount) col.appendChild(row);
        }
        if (col.childElementCount) body.appendChild(col);
      } else {
        const n = this.item(u, true);
        if (n) body.appendChild(n);
      }
    }
    if (body.querySelector(':scope > .is-large')) node.dataset.big = '1';
    if (body.querySelector('.rb-gal')) node.dataset.gal = '1';
    return body.childElementCount ? node : null;
  }

  private groupIcon(g: GroupDef): string {
    for (const u of g.units) {
      for (const it of 'rows' in u ? u.rows.flat() : [u]) {
        if (it.k === 'slot') continue;
        if (it.icon) return it.icon;
        return this.commands.icon(it.id);
      }
    }
    return 'dots';
  }

  private item(it: Item, large: boolean): HTMLElement | null {
    if (it.k === 'slot') {
      const make = this.opts.slots[it.id];
      const n = make ? make() : null;
      if (n) {
        this.watchSlot(n);
        if (large && n.classList.contains('rb-gal')) n.classList.add('is-large');
      }
      return n;
    }
    const cmd = it.k === 'cmd' || it.k === 'split';
    const label = it.label ?? (cmd ? this.commands.label(it.id) : it.id);
    const ic = it.icon ?? (cmd ? this.commands.icon(it.id) : 'dots');
    const size = large ? 28 : 16;
    const title = escapeHtml(it.title ?? label);
    const base = `${it.swatch ? ' rb-color' : ''}${it.text ? ' has-text' : ''}`;
    const attrs = cmd ? `data-cmd="${it.id}" data-label="${escapeHtml(it.title ?? label)}"` : it.k === 'act' ? `data-act="${escapeHtml(it.id)}"` : `data-menu="${escapeHtml(it.id)}" aria-haspopup="menu" aria-expanded="false"${it.cmdId ? ` data-cmd="${it.cmdId}" data-label="${escapeHtml(it.title ?? label)}"` : ''}`;
    const keep = it.keep ? ' data-keep="1"' : '';
    const lblHtml = (drop: boolean): string => `<span class="rb-lbl"><span>${escapeHtml(label)}</span>${drop ? rbIcon('chevronDown', 10) : ''}</span>`;
    if (it.k === 'split') {
      const wrap = el(`<div class="rb-split ${large ? 'is-large' : 'is-small'}"></div>`);
      const main = el<HTMLButtonElement>(`<button class="rb-btn rb-main ${large ? 'is-large' : 'is-small'}${base}" type="button" ${attrs}${keep} title="${title}" aria-label="${escapeHtml(label)}"><span class="rb-ic">${rbIcon(ic, size)}</span>${large ? '' : it.text ? `<span class="rb-t">${escapeHtml(label)}</span>` : ''}</button>`);
      const drop = el<HTMLButtonElement>(`<button class="rb-btn rb-drop ${large ? 'is-large' : 'is-small'}" type="button" data-menu="${escapeHtml(it.id)}" aria-haspopup="menu" aria-expanded="false" title="${title} options" aria-label="${escapeHtml(label)} options"${keep}>${large ? `<span class="rb-lbl"><span>${escapeHtml(label)}</span>${rbIcon('chevronDown', 10)}</span>` : rbIcon('chevronDown', 10)}</button>`);
      this.items.set(main, it);
      this.items.set(drop, it);
      wrap.append(main, drop);
      return wrap;
    }
    const drop = it.k === 'menu';
    const cls = `rb-btn ${large ? 'is-large' : 'is-small'}${base}`;
    const b = large
      ? el<HTMLButtonElement>(`<button class="${cls}" type="button" ${attrs}${keep} title="${title}" aria-label="${escapeHtml(label)}"><span class="rb-ic">${rbIcon(ic, size)}</span>${lblHtml(drop)}</button>`)
      : el<HTMLButtonElement>(`<button class="${cls}" type="button" ${attrs}${keep} title="${title}" aria-label="${escapeHtml(label)}">${rbIcon(ic, size)}${it.text ? `<span class="rb-t">${escapeHtml(label)}</span>` : ''}${drop && it.text ? rbIcon('chevronDown', 10) : ''}</button>`);
    this.items.set(b, it);
    return b;
  }

  private buildCustom(): void {
    for (const n of Array.from(this.root.querySelectorAll('[data-custom]'))) n.remove();
    for (const [id, d] of Array.from(this.defs)) if (d.custom) { this.defs.delete(id); this.tabBtns.delete(id); this.panels.delete(id); }
    const firstCtx = this.list.querySelector('.is-ctx');
    for (const c of this.config.custom) {
      const def: TabDef = { id: c.id, label: c.label, custom: true, groups: c.groups.map((g) => ({ id: g.id, label: g.label, units: g.cmds.map((id): Item => ({ k: 'cmd', id, icon: this.commands.icon(id), label: this.commands.label(id) })) })) };
      this.buildTab(def);
      const btn = this.tabBtns.get(c.id) as HTMLButtonElement;
      if (firstCtx) this.list.insertBefore(btn, firstCtx);
    }
  }

  private runItem(b: HTMLElement, it: Item): void {
    if (it.run) it.run(b);
    else if (it.k === 'cmd' || it.k === 'split') this.commands.run(it.id, b);
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLButtonElement>('.rb-tab');
    if (tab) {
      const id = tab.dataset.tab as string;
      if (this.collapsed) { this.setFloat(this.float && this.tab === id ? false : true); this.select(id); } else this.select(id);
      return;
    }
    if (t.closest('.rb-file')) { this.openFile(); return; }
    const tool = t.closest<HTMLElement>('.rb-tool');
    if (tool) { if (tool.dataset.tool === 'collapse') this.setCollapsed(!this.collapsed); else this.setCompact(!this.compact); return; }
    const b = t.closest<HTMLButtonElement>('.rb-btn');
    if (!b || b.disabled) return;
    if (b.dataset.group) { this.openPop(b.closest('.rb-group') as HTMLElement); return; }
    rbState.anchor = b;
    const it = this.items.get(b);
    if (!it) return;
    if (b.dataset.menu) { this.openMenu(b, it); return; }
    this.runItem(b, it);
    if (this.popGroup && this.gpop.contains(b) && it.k !== 'menu') this.closePop(false);
    if (this.float) this.setFloat(false);
    this.opts.after();
  }

  private openMenu(b: HTMLButtonElement, it: Item): void {
    const key = b.dataset.menu as string;
    if (this.menus.isOpen && this.menus.anchorNode === b) { this.menus.close(false); return; }
    if (performance.now() - (this.closedAt.get(key) ?? 0) < 250) return;
    b.setAttribute('aria-expanded', 'true');
    void this.menus.open(it.menu ?? [], b, () => { this.closedAt.set(key, performance.now()); b.setAttribute('aria-expanded', 'false'); });
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && this.popGroup) { e.preventDefault(); e.stopPropagation(); this.closePop(true); return; }
    if (t.closest('.rb-tablist')) this.tabKey(e);
    else if (t.closest('.rb-gpop')) this.popKey(e);
    else if (t.closest('.rb-panel')) this.panelKey(e);
    if (e.key === 'Escape' && this.float) { this.setFloat(false); this.tabBtns.get(this.tab)?.focus(); }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !(t instanceof HTMLInputElement)) e.stopPropagation();
  }

  private visibleTabs(): string[] {
    return Array.from(this.list.children).filter((n) => !(n as HTMLElement).hidden).map((n) => (n as HTMLElement).dataset.tab as string);
  }

  private tabKey(e: KeyboardEvent): void {
    const ids = this.visibleTabs();
    const at = ids.indexOf((e.target as HTMLElement).dataset.tab as string);
    if (at < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (at + ids.length - 1) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.collapsed && !this.float) this.setFloat(true);
      this.select(ids[at]);
      this.focusPanel();
      return;
    } else return;
    e.preventDefault();
    this.select(ids[next]);
    this.tabBtns.get(ids[next])?.focus();
  }

  private panelKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    const panel = t.closest('.rb-panel') as HTMLElement;
    if (e.key === 'ArrowDown' && t.dataset.group) { e.preventDefault(); this.openPop(t.closest('.rb-group') as HTMLElement); return; }
    if (e.key === 'ArrowUp' && !(t instanceof HTMLInputElement)) { e.preventDefault(); this.tabBtns.get(this.tab)?.focus(); return; }
    if (!(t instanceof HTMLButtonElement) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const all = this.controls(panel);
    const at = all.indexOf(t);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length;
    all[next].focus();
  }

  private controls(panel: HTMLElement): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')).filter((n) => !n.closest('[hidden]') && (panel === this.gpop ? !n.dataset.group : n.dataset.group ? n.closest('.rb-group')?.getAttribute('data-lv') === '3' : !n.closest('.rb-group[data-lv="3"]')));
  }

  private popKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || t instanceof HTMLInputElement || (vertical && t.closest('.rb-combo'))) return;
    const all = this.controls(this.gpop);
    const at = all.indexOf(t);
    if (at < 0) return;
    e.preventDefault();
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (fwd ? 1 : all.length - 1)) % all.length].focus();
  }

  private openPop(g: HTMLElement): void {
    if (this.popGroup === g) { this.closePop(true); return; }
    this.closePop(false);
    const gbtn = g.querySelector('.rb-gbtn') as HTMLElement;
    const body = g.querySelector('.rb-gbody') as HTMLElement;
    this.popGroup = g;
    this.gpop.setAttribute('aria-label', g.getAttribute('aria-label') ?? '');
    this.gpop.appendChild(body);
    gbtn.setAttribute('aria-expanded', 'true');
    setHidden(this.gpop, false);
    this.placePop();
    this.sync();
    this.controls(this.gpop)[0]?.focus();
  }

  private placePop(): void {
    const g = this.popGroup;
    if (!g) return;
    const r = g.getBoundingClientRect();
    const w = this.gpop.offsetWidth;
    this.gpop.style.left = `${Math.round(Math.max(4, Math.min(r.left, window.innerWidth - w - 4)))}px`;
    this.gpop.style.top = `${Math.round(r.bottom)}px`;
  }

  private closePop(focusBtn: boolean): void {
    const g = this.popGroup;
    if (!g) return;
    const body = this.gpop.firstElementChild as HTMLElement | null;
    const had = this.gpop.contains(document.activeElement);
    if (body) g.insertBefore(body, g.querySelector('.rb-glabel'));
    this.popGroup = null;
    setHidden(this.gpop, true);
    const gbtn = g.querySelector<HTMLElement>('.rb-gbtn');
    gbtn?.setAttribute('aria-expanded', 'false');
    if ((focusBtn || had) && gbtn && g.dataset.lv === '3') gbtn.focus();
  }

  private setRove(panel: HTMLElement, t: HTMLElement): void {
    const prev = this.rover.get(panel);
    if (prev === t) return;
    prev?.setAttribute('tabindex', '-1');
    t.setAttribute('tabindex', '0');
    this.rover.set(panel, t);
  }

  private ensureRove(panel: HTMLElement): void {
    const cur = this.rover.get(panel);
    if (cur && !(cur as HTMLButtonElement).disabled && !cur.closest('[hidden]')) return;
    const first = this.controls(panel)[0];
    if (first) this.setRove(panel, first);
  }

  focusPanel(): void {
    const panel = this.panels.get(this.tab);
    if (!panel) return;
    this.ensureRove(panel);
    (this.rover.get(panel) ?? this.controls(panel)[0])?.focus();
  }

  tipHost(): TipHost {
    return {
      ready: () => !this.simplified && !this.root.hidden && this.root.isConnected && this.root.getClientRects().length > 0,
      file: () => this.fileBtn,
      qat: () => Array.from(this.qat.node.querySelectorAll<HTMLElement>('button[data-cmd]:not(:disabled)')).filter((n) => !n.closest('[hidden]')),
      tabs: () => this.visibleTabs().map((id) => ({ id, node: this.tabBtns.get(id) as HTMLElement })),
      open: (id) => { if (this.collapsed) this.setFloat(true); this.select(id); },
      controls: () => { const p = this.popGroup ? this.gpop : this.panels.get(this.tab); return p && !this.body.hidden ? this.controls(p) : []; },
      close: () => { this.closePop(false); if (this.float) this.setFloat(false); },
    };
  }

  openFile(): void {
    if (this.opts.openBackstage()) return;
    const m = this.menus;
    if (m.isOpen && m.anchorNode === this.fileBtn) { m.close(false); return; }
    if (performance.now() - (this.closedAt.get('file') ?? 0) < 250) return;
    this.fileBtn.setAttribute('aria-expanded', 'true');
    void m.open(() => this.opts.fileMenu(), this.fileBtn, () => { this.closedAt.set('file', performance.now()); this.fileBtn.setAttribute('aria-expanded', 'false'); });
  }

  private contextMenu(id: string | null, x: number, y: number): void {
    const rows: MItem[] = [];
    if (id) {
      const on = this.qat.has(id);
      rows.push({ label: on ? 'Remove from Quick Access Toolbar' : 'Add to Quick Access Toolbar', run: () => this.qat.toggle(id) }, { sep: true });
    }
    rows.push(
      { label: 'Customize Quick Access Toolbar...', run: () => this.opts.customize('qat') },
      { label: this.qat.below ? 'Show Quick Access Toolbar Above the Ribbon' : 'Show Quick Access Toolbar Below the Ribbon', run: () => this.qat.setBelow(!this.qat.below) },
      { sep: true },
      { label: 'Customize the Ribbon...', run: () => this.opts.customize('ribbon') },
      { label: this.collapsed ? 'Expand the Ribbon' : 'Collapse the Ribbon', run: () => this.setCollapsed(!this.collapsed) },
      { label: 'Icons-Only Ribbon', checked: this.compact, run: () => this.setCompact(!this.compact) },
      { label: 'Simplified Ribbon', checked: this.simplified, run: () => this.setSimplified(!this.simplified) },
    );
    const at = document.createElement('span');
    at.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0`;
    document.body.appendChild(at);
    void this.menus.open(rows, at, () => at.remove());
  }

  private qatMenu(anchor: HTMLElement): void {
    if (this.menus.isOpen && this.menus.anchorNode === anchor) { this.menus.close(false); return; }
    const common = ['edit.undo', 'edit.redo', 'file.new', 'file.download', 'edit.find', 'data.sort-asc', 'data.filter', 'format.painter', 'review.spelling', 'insert.chart'];
    const rows: MItem[] = common.filter((id) => this.commands.has(id)).map((id) => ({ label: this.commands.label(id), checked: this.qat.has(id), run: () => this.qat.toggle(id) }));
    rows.push(
      { sep: true },
      { label: 'More Commands...', run: () => this.opts.customize('qat') },
      { label: this.qat.below ? 'Show Below the Ribbon' : 'Show Below the Ribbon', checked: this.qat.below, run: () => this.qat.setBelow(!this.qat.below) },
      { label: this.collapsed ? 'Expand the Ribbon' : 'Collapse the Ribbon', run: () => this.setCollapsed(!this.collapsed) },
    );
    void this.menus.open(rows, anchor);
  }

  private tabHidden(id: string): boolean {
    const d = this.defs.get(id);
    return !d || this.config.hiddenTabs.includes(id) || (!!d.ctx && !this.ctxShown.has(id));
  }

  private applyVisibility(): void {
    for (const [id, btn] of this.tabBtns) setHidden(btn, this.tabHidden(id));
    for (const panel of this.panels.values()) {
      for (const g of Array.from(panel.querySelectorAll<HTMLElement>('.rb-group'))) setHidden(g, this.config.hiddenGroups.includes(g.dataset.g as string));
    }
    const key = Array.from(this.tabBtns).map(([id, b]) => (b.hidden ? '' : id)).join('|');
    if (key !== this.mark) { this.mark = key; this.rev++; if (this.tabBtns.get(this.tab)?.hidden) this.select('home'); }
  }

  setContext(ids: string[], labels: Record<string, string> = {}): void {
    let changed = false;
    for (const [id, d] of this.defs) {
      if (!d.ctx) continue;
      const on = ids.includes(id);
      if (this.ctxShown.has(id) !== on) { changed = true; if (on) this.ctxShown.add(id); else this.ctxShown.delete(id); }
      const btn = this.tabBtns.get(id);
      const want = labels[id];
      if (btn && want && btn.textContent !== want) btn.textContent = want;
    }
    if (changed) this.applyVisibility();
  }

  contextShown(): string[] {
    return Array.from(this.ctxShown);
  }

  select(id: string): void {
    if (!this.defs.has(id) || this.tabBtns.get(id)?.hidden) return;
    this.showTab(id);
    this.persist();
    this.sync();
  }

  private showTab(id: string): void {
    if (this.tab !== id) this.closePop(false);
    this.tab = id;
    for (const [tid, btn] of this.tabBtns) {
      const on = tid === id;
      if ((btn.getAttribute('aria-selected') === 'true') !== on) btn.setAttribute('aria-selected', String(on));
      const want = on ? '0' : '-1';
      if (btn.getAttribute('tabindex') !== want) btn.setAttribute('tabindex', want);
      setClass(btn, 'is-on', on);
      setHidden(this.panels.get(tid) as HTMLElement, !on);
    }
    this.fit();
  }

  setCollapsed(on: boolean): void {
    this.collapsed = on;
    if (!on) this.float = false;
    this.applyMode();
    this.persist();
    this.sync();
  }

  private setFloat(on: boolean): void {
    if (this.float === on) return;
    this.float = on;
    this.applyMode();
    this.sync();
  }

  setCompact(on: boolean): void {
    if (this.compact === on) return;
    this.compact = on;
    this.rev++;
    this.applyMode();
    this.persist();
    this.sync();
    this.opts.after();
  }

  setSimplified(on: boolean, remember = true): void {
    this.simplified = on;
    this.applyMode();
    if (remember) this.persist();
    this.opts.after();
  }

  private applyMode(): void {
    setClass(this.root, 'is-collapsed', this.collapsed);
    setClass(this.root, 'is-float', this.collapsed && this.float);
    setClass(this.root, 'is-compact', this.compact);
    setHidden(this.root, this.simplified);
    setHidden(this.simpleBar, !this.simplified);
    this.compactBtn.setAttribute('aria-pressed', String(this.compact));
    this.collapseBtn.setAttribute('aria-expanded', String(!this.collapsed));
    const lbl = this.collapsed ? 'Expand the ribbon (Ctrl+F1)' : 'Collapse the ribbon (Ctrl+F1)';
    if (this.collapseBtn.title !== lbl) { this.collapseBtn.title = lbl; this.collapseBtn.setAttribute('aria-label', lbl); }
    setHidden(this.body, this.collapsed && !this.float);
    if (this.simplified || this.body.hidden) this.closePop(false);
    this.fit();
    const v = this.simplified ? 'var(--rb-simple-h)' : this.collapsed ? 'var(--rb-tabs-h)' : this.compact ? 'calc(var(--rb-tabs-h) + var(--rb-rail-h))' : 'calc(var(--rb-tabs-h) + var(--rb-body-h))';
    setStyleVar(document.documentElement, '--rb-h', v);
  }

  syncMode(): void { this.applyMode(); }

  sync(): void {
    this.qat.sync();
    const live: HTMLButtonElement[] = [];
    if (this.simplified) live.push(...Array.from(this.simpleBar.querySelectorAll<HTMLButtonElement>('button[data-cmd]')));
    else {
      const panel = this.panels.get(this.tab);
      if (!panel || panel.hidden || this.body.hidden) return;
      live.push(...Array.from(panel.querySelectorAll<HTMLButtonElement>('button[data-cmd]')));
      if (this.popGroup) live.push(...Array.from(this.gpop.querySelectorAll<HTMLButtonElement>('button[data-cmd]')));
    }
    for (const b of live) {
      const id = b.dataset.cmd as string;
      setDisabled(b, !this.commands.enabled(id));
      const on = this.commands.checked(id);
      setClass(b, 'is-on', on);
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      const sw = rbState.swatch.get(id);
      if (sw !== undefined && b.style.getPropertyValue('--swatch') !== sw) b.style.setProperty('--swatch', sw);
      const keys = this.commands.keys(id);
      const base = b.dataset.label ?? '';
      setTitle(b, keys ? `${base} (${keys})` : base);
    }
    const panel = this.panels.get(this.tab);
    if (panel && !this.simplified) this.ensureRove(panel);
  }

  private queueFit(): void {
    if (this.fitRaf) return;
    this.fitRaf = requestAnimationFrame(() => { this.fitRaf = 0; this.fit(); });
  }

  private fit(): void {
    if (this.simplified || this.root.hidden || this.body.hidden) return;
    const panel = this.panels.get(this.tab);
    const cw = this.body.clientWidth;
    if (!panel || panel.hidden || cw <= 0) return;
    const cs = getComputedStyle(panel);
    const avail = cw - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
    const groups = Array.from(panel.children).filter((n): n is HTMLElement => n.classList.contains('rb-group') && !(n as HTMLElement).hidden);
    const key = `${this.tab}|${this.rev}|${this.compact ? 'c' : 'f'}|${Math.round(avail)}|${groups.map((g) => g.dataset.g).join(',')}`;
    if (!groups.length || key === this.fitKey) return;
    setStyleVar(panel, '--rb-gap', '');
    setStyleVar(panel, '--rb-pad', '');
    this.measure(groups);
    const ms = groups.map((g) => this.meas.get(g) as Meas);
    const pick = ms.map(() => 0);
    let total = ms.reduce((s, m) => s + m.w[0], 0);
    if (total > avail) {
      const order = groups.map((_, i) => i).sort((a, b) => Number(groups[b].dataset.rank ?? 0) - Number(groups[a].dataset.rank ?? 0) || b - a);
      const tier = (s: Step): number => s.lv * 4 + (s.gal ? 5 - s.gal : 0);
      const tiers = [...new Set(ms.flatMap((m) => m.steps.map(tier)))].sort((a, b) => a - b);
      done: for (const t of tiers) {
        for (const i of order) {
          let to = pick[i];
          while (to + 1 < ms[i].steps.length && tier(ms[i].steps[to + 1]) <= t) to++;
          if (to === pick[i]) continue;
          total += ms[i].w[to] - ms[i].w[pick[i]];
          pick[i] = to;
          if (total <= avail) break done;
        }
      }
      const back = [...order].reverse();
      for (;;) {
        let best = -1;
        for (const i of back) {
          if (pick[i] === 0 || total + ms[i].w[pick[i] - 1] - ms[i].w[pick[i]] > avail) continue;
          if (best < 0 || tier(ms[i].steps[pick[i]]) > tier(ms[best].steps[pick[best]])) best = i;
        }
        if (best < 0) break;
        total += ms[best].w[pick[best] - 1] - ms[best].w[pick[best]];
        pick[best]--;
      }
    }
    const ae = document.activeElement as HTMLElement | null;
    groups.forEach((g, i) => this.setStep(g, ms[i].steps[pick[i]]));
    if (!this.compact) this.spread(panel, groups, avail);
    if (this.popGroup && this.popGroup.dataset.lv !== '3') this.closePop(false);
    else if (this.popGroup) this.placePop();
    const lost = ae?.closest?.('.rb-group[data-lv="3"]');
    if (lost && ae?.closest('.rb-gbody')) lost.querySelector<HTMLElement>('.rb-gbtn')?.focus();
    this.fitKey = key;
  }

  private spread(panel: HTMLElement, groups: HTMLElement[], avail: number): void {
    const width = (): number => groups.reduce((s, g) => s + g.getBoundingClientRect().width, 0);
    const base = width();
    if (avail - base < 2) return;
    setStyleVar(panel, '--rb-gap', '1px');
    const slope = width() - base;
    const gap = slope > 0 ? Math.min(4, Math.floor(((avail - base) / 2 / slope) * 2) / 2) : 0;
    setStyleVar(panel, '--rb-gap', gap ? `${gap}px` : '');
    const pad = Math.min(24, Math.floor(((avail - width()) / (groups.length * 2)) * 2) / 2);
    setStyleVar(panel, '--rb-pad', pad > 0 ? `${pad}px` : '');
  }

  private candidates(g: HTMLElement): Step[] {
    const gal = g.dataset.gal ? 2 : 0;
    if (this.compact) return gal ? [{ lv: 3, gal: 0 }] : [{ lv: 2, gal: 0 }, { lv: 3, gal: 0 }];
    const out: Step[] = [{ lv: 0, gal: 0 }];
    if (gal) out.push({ lv: 0, gal: 4 }, { lv: 0, gal: 3 }, { lv: 0, gal: 2 });
    out.push({ lv: 1, gal }, { lv: 2, gal }, { lv: 3, gal: 0 });
    return out;
  }

  private setStep(g: HTMLElement, s: Step): void {
    const lv = String(s.lv);
    if (g.dataset.lv !== lv) g.dataset.lv = lv;
    setStyleVar(g, '--gal-n', s.gal ? String(s.gal) : '');
  }

  private measure(groups: HTMLElement[]): void {
    const todo = groups.filter((g) => this.meas.get(g)?.rev !== this.rev);
    if (!todo.length) return;
    this.closePop(false);
    const cand = todo.map((g) => this.candidates(g));
    const w = todo.map(() => [] as number[]);
    const most = Math.max(...cand.map((c) => c.length));
    for (let k = 0; k < most; k++) {
      todo.forEach((g, i) => { if (k < cand[i].length) this.setStep(g, cand[i][k]); });
      todo.forEach((g, i) => { if (k < cand[i].length) w[i][k] = g.getBoundingClientRect().width; });
    }
    todo.forEach((g, i) => {
      const steps: Step[] = [];
      const ws: number[] = [];
      cand[i].forEach((s, k) => { if (!ws.length || w[i][k] < ws[ws.length - 1] - 0.5) { steps.push(s); ws.push(w[i][k]); } });
      this.meas.set(g, { rev: this.rev, steps, w: ws });
    });
  }

  catalog(): Array<{ id: string; label: string; ctx: boolean; custom: boolean; groups: Array<{ id: string; label: string; key: string }> }> {
    return Array.from(this.defs.values()).map((d) => ({ id: d.id, label: d.label, ctx: !!d.ctx, custom: !!d.custom, groups: d.groups.map((g) => ({ id: g.id, label: g.label, key: `${d.id}.${g.id}` })) }));
  }

  applyConfig(cfg: RibbonConfig): void {
    this.config = cfg;
    this.closePop(false);
    this.rev++;
    this.buildCustom();
    this.mark = '';
    this.applyVisibility();
    if (this.tabBtns.get(this.tab)?.hidden || !this.defs.has(this.tab)) this.showTab('home');
    this.fit();
    this.persist();
    this.sync();
  }

  persist(): void {
    try { localStorage.setItem(RIBBON_KEY, JSON.stringify({ collapsed: this.collapsed, simplified: this.simplified, compact: this.compact, tab: this.tab, ...this.config } satisfies Saved)); } catch { return; }
  }
}
