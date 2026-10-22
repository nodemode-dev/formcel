import { commandInfo, hasCommand, listCommands, registerCommand, runCommand } from './commands';
import { KeyTips } from './key-tips';
import { Qat } from './qat';
import { RbMenus, type MenuHost, type MItem } from './rb-menu';
import { hasIcon } from './rb-icons';
import { rbState, type RbCommands } from './rb-state';
import { Ribbon, type Item, type Rows, type TabDef } from './ribbon';
import { customizeQat, customizeRibbon } from './ribbon-customize';
import { RibbonHost, type HostHooks } from './ribbon-host';
import { ribbonTabs, simpleItems } from './ribbon-tabs';
import { installResponsive } from './responsive';
import type { Grid } from '../grid/grid';

export interface RibbonMount {
  ribbon: Ribbon;
  qat: Qat;
  host: RibbonHost;
  commands: RbCommands;
  refresh(): void;
  context(): void;
}

export interface MountDeps extends Omit<HostHooks, 'run'> {
  after(): void;
}

const comboKeys = (keys: string): string => keys.replace(/Mod/g, 'Ctrl').replace(/\+\+/g, '+Plus');

const FALLBACK_ICON: [string, string][] = [
  ['file.download', 'download'], ['file.', 'sheet'], ['data.', 'dataTools'], ['format.', 'formatCells'], ['review.', 'comment'], ['protect.', 'lock'], ['page.', 'page'], ['view.', 'zoom100'], ['rows.', 'rowInsert'],
  ['cols.', 'colInsert'], ['names.', 'names'], ['audit.', 'tracePrec'], ['calc.', 'calcOpts'], ['errors.', 'errCheck'], ['insert.', 'shapes'], ['pivot', 'pivot'], ['edit.', 'clipboard'], ['sheet.', 'sheet'],
  ['automate.', 'script'], ['vba.', 'vba'], ['ribbon.', 'customize'], ['qat.', 'qat'], ['a11y.', 'access'], ['table.', 'table'], ['formula.', 'insertFn'], ['nav.', 'goto'], ['chart.', 'chart'],
];

export function mountRibbon(root: HTMLElement, grid: Grid, deps: MountDeps): RibbonMount {
  const icons = new Map<string, string>();
  const labels = new Map<string, string>();
  const note = (it: Item): void => {
    const id = it.k === 'menu' ? it.cmdId : it.k === 'cmd' || it.k === 'split' ? it.id : undefined;
    if (!id || !it.icon) return;
    if (!icons.has(id)) icons.set(id, it.icon);
    if (it.label && !labels.has(id)) labels.set(id, it.label);
  };
  const walk = (tabs: TabDef[], simple: Item[]): void => {
    for (const t of tabs) for (const g of t.groups) for (const u of g.units) for (const it of 'rows' in u ? (u as Rows).rows.flat() : [u]) note(it);
    for (const it of simple) note(it);
  };

  const commands: RbCommands = {
    has: (id) => hasCommand(id),
    label: (id) => labels.get(id) ?? commandInfo(id)?.title ?? id,
    keys: (id) => comboKeys(commandInfo(id)?.keys ?? ''),
    enabled: (id) => !rbState.disabled.has(id),
    checked: (id) => rbState.pressed.has(id),
    run: (id, anchor) => {
      rbState.anchor = anchor ?? rbState.anchor;
      if (!hasCommand(id)) {
        deps.say(`${labels.get(id) ?? id} is not available in this build.`);
        return;
      }
      void runCommand(id).then(() => deps.after());
    },
    ids: () => listCommands().map((c) => c.id),
    icon: (id) => {
      const known = icons.get(id);
      if (known && hasIcon(known)) return known;
      return FALLBACK_ICON.find(([p]) => id.startsWith(p))?.[1] ?? 'dots';
    },
  };

  const host = new RibbonHost(grid, { ...deps, run: (id, anchor) => commands.run(id, anchor) });
  const menuHost: MenuHost = {
    run: (id, anchor) => commands.run(id, anchor),
    label: (id) => commands.label(id),
    keys: (id) => commands.keys(id),
    icon: (id) => commands.icon(id),
    has: (id) => hasCommand(id),
  };
  const menus = new RbMenus(menuHost);
  const tabs = ribbonTabs(host);
  const simple = simpleItems(host);
  walk(tabs, simple);

  const fileMenu = (): MItem[] => {
    const dl: MItem[] = ['xlsx', 'xlsm', 'xlsx-password', 'pdf', 'pdf-all', 'ods', 'csv', 'tsv', 'html', 'html-all'].map((k) => ({ label: commandInfo(`file.download-${k}`)?.title ?? k, cmd: `file.download-${k}`, icon: 'download' }));
    const keep = (id: string, label: string, icon: string): MItem[] => (hasCommand(id) ? [{ label, cmd: id, icon }] : []);
    return [
      ...keep('file.new', 'New', 'sheet'),
      ...keep('file.home', 'Home', 'home'),
      { label: 'Save a Copy', icon: 'download', sub: dl },
      ...keep('file.save-template', 'Save as Template', 'template'),
      ...keep('file.properties', 'Info and Properties', 'dots'),
      ...keep('page.setup', 'Page Setup', 'page'),
      { sep: true },
      ...keep('app.settings', 'Options', 'customize'),
      { label: 'Customize the Ribbon...', icon: 'customize', run: () => customizeRibbon(commands, ribbon) },
    ];
  };

  const qat = new Qat(commands);
  const hostEl = document.createElement('div');
  hostEl.className = 'rb-host';
  root.appendChild(hostEl);
  const below = document.createElement('div');
  below.className = 'rb-qat-below';
  below.hidden = true;
  root.appendChild(below);

  const slots: Record<string, () => HTMLElement> = {
    font: () => {
      return host.combo('font');
    },
    size: () => {
      const n = host.combo('size');
      n.querySelector('.rb-combo-btn')?.addEventListener('click', () => { rbState.anchor = n; void menus.open(() => host.sizeMenu(), n); });
      return n;
    },
    numfmt: () => {
      const n = host.numberBox();
      n.querySelector('button')?.addEventListener('click', () => {
        if (menus.isOpen && menus.anchorNode === n) { menus.close(false); return; }
        rbState.anchor = n;
        void menus.open(() => host.numberMenu(), n);
      });
      return n;
    },
  };

  const ribbon: Ribbon = new Ribbon(hostEl, commands, qat, {
    tabs,
    simple,
    slots,
    after: () => deps.after(),
    fileMenu,
    openBackstage: () => {
      if (!hasCommand('file.backstage')) return false;
      void runCommand('file.backstage');
      return true;
    },
    customize: (what) => (what === 'ribbon' ? customizeRibbon(commands, ribbon) : customizeQat(commands, qat)),
    say: deps.say,
  }, menus);

  rbState.root = hostEl;
  qat.render();
  const place = (belowOn: boolean): void => {
    const list = ribbon.root.querySelector('.rb-tablist') as HTMLElement;
    if (belowOn) below.appendChild(qat.node);
    else list.parentElement?.insertBefore(qat.node, list);
    below.hidden = !belowOn;
    document.documentElement.style.setProperty('--rb-qat-h', belowOn ? 'var(--rb-qat-row)' : '0px');
    root.classList.toggle('has-qat-below', belowOn);
  };
  qat.onPlace = place;
  if (qat.below) place(true);

  registerCommand({ id: 'ribbon.customize', title: 'Customize the Ribbon', description: 'Show and hide tabs and groups, make your own tabs and groups with any command, and reset the ribbon.', changes: false, run: () => customizeRibbon(commands, ribbon) });
  registerCommand({ id: 'qat.customize', title: 'Customize Quick Access Toolbar', description: 'Choose which commands the Quick Access Toolbar holds, put them in order, and place it above or below the ribbon.', changes: false, run: () => customizeQat(commands, qat) });
  registerCommand({ id: 'ribbon.collapse', title: 'Collapse or expand the ribbon', description: 'Show only the tab names, or the whole ribbon again.', changes: false, keys: 'Ctrl+F1', run: () => ribbon.setCollapsed(!ribbon.collapsed) });
  registerCommand({ id: 'ribbon.simplified', title: 'Simplified ribbon', description: 'Swap the ribbon for one row of the commands used most.', changes: false, run: () => ribbon.setSimplified(!ribbon.simplified) });
  registerCommand({ id: 'ribbon.compact', title: 'Icons-only ribbon', description: 'Show every group as small icons without labels.', changes: false, run: () => ribbon.setCompact(!ribbon.compact) });

  const tips = new KeyTips(ribbon.tipHost(), () => !!document.querySelector('.fc-sheet:not([hidden])'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1' && e.ctrlKey && !e.altKey && !e.shiftKey && document.querySelector('.fc-sheet:not([hidden])')) {
      e.preventDefault();
      ribbon.setCollapsed(!ribbon.collapsed);
    }
  });
  void tips;
  installResponsive(root, ribbon);

  let queued = 0;
  const context = (): void => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      const c = host.context();
      ribbon.setContext(c.ids, c.labels);
    });
  };
  document.addEventListener('pointerup', () => window.setTimeout(context, 0), true);
  document.addEventListener('keyup', context, true);

  const refresh = (): void => {
    host.refreshState();
    context();
  };
  rbState.changed();
  return { ribbon, qat, host, commands, refresh, context };
}
