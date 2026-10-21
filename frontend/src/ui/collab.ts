import { engine } from '../engine';
import type { Grid, Presence } from '../grid/grid';
import { colName, parseRef } from '../grid/a1';
import type { Menu } from './menu';

export interface Host {
  grid: Grid;
  menu: Menu;
  open(): { id: string; book: number; sheets: string[] } | null;
  status(text: string, error?: boolean): void;
  reload(): void;
}

interface Note { text: string; author: string; time: string }
interface Message { id: string; author: string; time: string; text: string }
interface Thread { id: string; sheet: number; row: number; col: number; status: string; assignee: string; messages: Message[] }
interface Snapshot { notes: Record<string, Note>; threads: Thread[]; people: string[]; protection?: { book: string[]; sheets: string[][] } }
interface Version { id: string; time: string; name: string; user: string; why: string; size: number }
interface Share { token: string; sheet: number; kind: string; url: string; embed: string }
interface Change { t: string; user: string; sheetName: string; ref: string; before: string; after: string }

const USER_KEY = 'formcel.user';
export const clientId = Math.random().toString(36).slice(2, 10);

export function userName(): string {
  try {
    return localStorage.getItem(USER_KEY) || 'Me';
  } catch {
    return 'Me';
  }
}

export function identityHeaders(): Record<string, string> {
  return { 'x-formcel-user': encodeURIComponent(userName()), 'x-formcel-client': clientId };
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { ...identityHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    const detail = await r.json().then((j: { detail?: string }) => j.detail).catch(() => undefined);
    throw new Error(detail ?? `The engine answered ${r.status}.`);
  }
  return (await r.json()) as T;
}

const ACTIONS: [string, string][] = [
  ['select_locked', 'Select locked cells'], ['select_unlocked', 'Select unlocked cells'], ['format_cells', 'Format cells'], ['format_columns', 'Format columns'],
  ['format_rows', 'Format rows'], ['insert_columns', 'Insert columns'], ['insert_rows', 'Insert rows'], ['insert_hyperlinks', 'Insert hyperlinks'],
  ['delete_columns', 'Delete columns'], ['delete_rows', 'Delete rows'], ['sort', 'Sort'], ['autofilter', 'Use AutoFilter'],
];

function unesc(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
}

function esc(s: string): string {
  return s.replace(/[\\\t\n\r]/g, (c) => (c === '\\' ? '\\\\' : c === '\t' ? '\\t' : c === '\n' ? '\\n' : '\\r'));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, cls = 'fc-btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

function when(t: string): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function colour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 42%)`;
}

interface Dialog {
  form: HTMLFormElement;
  hint: HTMLElement;
  q<T extends HTMLElement>(k: string): T;
  show(): void;
  close(): void;
}

function dialog(title: string, body: string, onClose: () => void): Dialog {
  const form = el('form', 'fc-fmt-custom fc-pw');
  form.hidden = true;
  form.setAttribute('role', 'dialog');
  form.innerHTML = `<span class="fc-fmt-title"></span>${body}<span class="fc-fmt-hint" aria-live="polite"></span><div class="fc-csv-actions"><button type="button" class="fc-btn" data-a="cancel">Cancel</button><button type="submit" class="fc-btn fc-btn-primary">OK</button></div>`;
  form.querySelector('.fc-fmt-title')!.textContent = title;
  document.getElementById('overlay-root')!.appendChild(form);
  const d: Dialog = {
    form,
    hint: form.querySelector<HTMLElement>('.fc-fmt-hint')!,
    q: <T extends HTMLElement>(k: string) => form.querySelector<T>(`[data-k="${k}"]`)!,
    show: () => {
      form.dataset.state = '';
      d.hint.textContent = '';
      form.hidden = false;
      form.querySelector<HTMLElement>('input:not([type=checkbox]),textarea')?.focus();
    },
    close: () => {
      form.hidden = true;
      onClose();
    },
  };
  form.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-a="cancel"]')) d.close();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') d.close();
  });
  return d;
}

export class Collab {
  private id = '';
  private book = -1;
  private sheets: string[] = [];
  private snap: Snapshot = { notes: {}, threads: [], people: [] };
  private source: EventSource | null = null;
  private others = new Map<string, { user: string; sheet: number; row: number; col: number }>();
  private activity: string[] = [];
  private seen = 0;
  private cursorTimer = 0;
  private maskSeq = 0;
  private readonly side = el('aside', 'fc-side');
  private readonly who = el('div', 'fc-side-who');
  private readonly panes = new Map<string, HTMLElement>();
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly threadList = el('div', 'fc-side-list');
  private readonly composer = el('textarea', 'fc-text');
  private readonly assign = el('input');
  private readonly mentionRow = el('div', 'fc-people');
  private readonly drafts = new Map<string, string>();
  private readonly changeList = el('table', 'fc-changes');
  private readonly changeScope = el('select', 'fc-fmt-input');
  private readonly versionList = el('div', 'fc-side-list');
  private readonly versionName = el('input', 'fc-fmt-input');
  private readonly preview = el('div', 'fc-preview');
  private readonly shareList = el('div', 'fc-side-list');
  private readonly activityList = el('div', 'fc-side-list');
  private readonly tip = el('div', 'fc-note-tip');
  private readonly banner = el('div', 'fc-final-banner');
  private readonly refusal = el('div', 'fc-refusal');
  private refusalTimer = 0;
  private noteDlg: Dialog | null = null;
  private sheetDlg: Dialog | null = null;
  private cellDlg: Dialog | null = null;
  private rangeDlg: Dialog | null = null;
  private passDlg: Dialog | null = null;
  private nameDlg: Dialog | null = null;
  private versionDlg: Dialog | null = null;
  private tab = 'comments';

  constructor(private readonly host: Host) {
    this.buildSide();
    this.tip.hidden = true;
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    const msg = el('span', '', 'This workbook is marked as final, so it is read-only.');
    const edit = button('Edit anyway');
    edit.addEventListener('click', () => void this.finalOff());
    this.banner.append(msg, edit);
    this.refusal.setAttribute('role', 'alert');
    const root = document.getElementById('overlay-root')!;
    root.append(this.side, this.tip, this.banner, this.refusal);
  }

  commands(cmd: (id: string, title: string, description: string, changes: boolean, run: () => void | Promise<void>, keys?: string) => void): void {
    cmd('review.note', 'Note', 'Add, edit or delete the note on the active cell. A red corner marks a cell with a note; point at it to read the note.', false, () => this.noteBox());
    cmd('review.comment', 'Comment', 'Start a comment thread on the active cell. Type @ and a name to mention a person and tick the box to assign the comment to them.', false, () => this.openTab('comments', true));
    cmd('review.panel', 'Comments panel', 'Open the side panel with comments, changes, version history, sharing and activity.', false, () => this.openTab(this.tab === 'share' ? 'comments' : this.tab));
    cmd('review.changes', 'Show changes', 'List who changed the active cell, the selection or the sheet, with the values before and after.', false, () => this.openTab('changes'));
    cmd('history.panel', 'Version history', 'List saved versions of this workbook, name one, preview it or restore it.', false, () => this.openTab('versions'));
    cmd('share.panel', 'Share, publish and embed', 'Make a read-only link to a sheet served by the FormCel engine on this computer, copy an embed snippet, or revoke a link.', false, () => this.openTab('share'));
    cmd('protect.menu', 'Protection', 'Protect the sheet or the workbook structure, lock or hide cells, protect ranges for named people, or mark the workbook as final.', false, () => this.protectMenu());
    cmd('protect.sheet', 'Protect sheet', 'Stop edits to locked cells on the sheet, with an optional password and a list of allowed actions.', false, () => this.sheetBox());
    cmd('protect.cells', 'Cell protection', 'Mark the selected cells locked or unlocked, and hide or show their formulas when the sheet is protected.', false, () => void this.cellBox());
    cmd('protect.ranges', 'Protected ranges', 'Name ranges that only listed people can edit.', false, () => void this.rangeBox());
    cmd('protect.book', 'Protect workbook structure', 'Stop sheets being added, deleted, renamed or moved, with an optional password.', false, () => void this.bookToggle());
    cmd('protect.final', 'Mark as final', 'Make the workbook read-only and show a banner, until someone chooses Edit anyway.', false, () => void this.finalToggle());
    cmd('review.user', 'Your name', 'Set the name FormCel uses for your notes, comments, edits and presence.', false, () => this.nameBox());
  }

  attach(id: string, book: number, sheets: string[], doc: Snapshot | undefined, protection: { book: string[]; sheets: string[][] } | undefined): void {
    this.detach();
    this.id = id;
    this.book = book;
    this.sheets = sheets;
    this.snap = { notes: doc?.notes ?? {}, threads: doc?.threads ?? [], people: [] };
    this.activity = [];
    this.seen = 0;
    void (async () => {
      const e = engine();
      await e.setUser(book, userName());
      await e.protLoad(book, -1, protection?.book ?? []);
      for (let i = 0; i < sheets.length; i++) await e.protLoad(book, i, protection?.sheets[i] ?? []);
      await this.refreshAll();
      this.connect();
      void this.reloadSnapshot(false);
    })();
  }

  detach(): void {
    this.source?.close();
    this.source = null;
    this.others.clear();
    this.id = '';
    this.side.dataset.open = 'false';
    this.banner.hidden = true;
    this.tip.hidden = true;
    this.host.grid.setOthers([]);
    this.host.grid.setMarks(new Map());
    this.host.grid.setMasked(new Set());
  }

  sheetChanged(): void {
    void this.refreshAll();
  }

  active(): void {
    if (!this.id) return;
    window.clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      const [row, col] = this.host.grid.activeCell();
      void call('POST', `/api/workbooks/${this.id}/presence`, { client: clientId, user: userName(), sheet: this.host.grid.sheetIndex, row, col }).catch(() => undefined);
    }, 150);
    if (this.tab === 'changes' && this.side.dataset.open === 'true' && this.changeScope.value === 'cell') void this.loadChanges();
  }

  refused(message: string): void {
    this.refusal.textContent = message;
    this.refusal.dataset.show = 'true';
    window.clearTimeout(this.refusalTimer);
    this.refusalTimer = window.setTimeout(() => (this.refusal.dataset.show = 'false'), 6000);
  }

  hover(row: number, col: number, x: number, y: number): void {
    const note = row >= 0 ? this.snap.notes[`${this.host.grid.sheetIndex}:${row}:${col}`] : undefined;
    if (!note) {
      if (!this.tip.hidden) this.tip.hidden = true;
      return;
    }
    this.tip.replaceChildren(document.createTextNode(note.text), Object.assign(el('small'), { textContent: note.author }));
    this.tip.style.left = `${Math.min(x + 14, innerWidth - 280)}px`;
    this.tip.style.top = `${Math.min(y + 14, innerHeight - 120)}px`;
    this.tip.hidden = false;
  }

  private connect(): void {
    const url = `/api/workbooks/${this.id}/events?client=${clientId}&user=${encodeURIComponent(userName())}`;
    const s = new EventSource(url);
    this.source = s;
    s.onmessage = (m) => void this.onEvent(JSON.parse(m.data as string) as Record<string, unknown>);
  }

  private async onEvent(ev: Record<string, unknown>): Promise<void> {
    const type = String(ev.type);
    if (type === 'hello') {
      for (const p of (ev.people as { client: string; user: string; sheet?: number; row?: number; col?: number }[]) ?? []) {
        if (p.client !== clientId && p.row !== undefined) this.others.set(p.client, { user: p.user, sheet: p.sheet ?? 0, row: p.row, col: p.col ?? 0 });
        else if (p.client !== clientId) this.others.set(p.client, { user: p.user, sheet: 0, row: -1, col: 0 });
      }
      this.showOthers();
    } else if (type === 'join') {
      this.others.set(String(ev.client), { user: String(ev.user), sheet: 0, row: -1, col: 0 });
      this.addActivity(`${String(ev.user) || 'Someone'} opened this workbook`);
      this.showOthers();
    } else if (type === 'leave') {
      const u = this.others.get(String(ev.client));
      this.others.delete(String(ev.client));
      if (u) this.addActivity(`${u.user || 'Someone'} closed this workbook`);
      this.showOthers();
    } else if (type === 'presence') {
      this.others.set(String(ev.client), { user: String(ev.user), sheet: Number(ev.sheet), row: Number(ev.row), col: Number(ev.col) });
      this.showOthers();
    } else if (type === 'edit') {
      const sheet = Number(ev.sheet);
      const cells = ev.cells as [number, number, string][];
      const changed = await engine().applyRemote(this.book, cells, sheet);
      this.host.grid.patch(changed);
      const [r, c] = cells[0] ?? [0, 0];
      this.addActivity(`${String(ev.user) || 'Someone'} edited ${this.sheets[sheet] ?? 'a sheet'}!${colName(c)}${r + 1}${cells.length > 1 ? ` and ${cells.length - 1} more cell${cells.length > 2 ? 's' : ''}` : ''}`);
    } else if (type === 'collab' || type === 'protection') {
      await this.reloadSnapshot(true);
      if (type === 'collab') this.addActivity('Notes or comments changed');
      else this.addActivity('Protection changed');
    } else if (type === 'shares') {
      void this.loadShares();
    } else if (type === 'reload') {
      this.host.reload();
    }
  }

  private async reloadSnapshot(withProtection: boolean): Promise<void> {
    if (!this.id) return;
    const s = await call<Snapshot>('GET', `/api/workbooks/${this.id}/collab`).catch(() => null);
    if (!s || !this.id) return;
    this.snap = s;
    if (withProtection && s.protection) {
      await engine().protLoad(this.book, -1, s.protection.book);
      for (let i = 0; i < this.sheets.length; i++) await engine().protLoad(this.book, i, s.protection.sheets[i] ?? []);
    }
    await this.refreshAll();
  }

  private addActivity(text: string): void {
    this.activity.unshift(`${new Date().toLocaleTimeString()}  ${text}`);
    this.activity.length = Math.min(this.activity.length, 100);
    if (!(this.side.dataset.open === 'true' && this.tab === 'activity')) this.seen++;
    this.paintActivity();
  }

  private showOthers(): void {
    const here: Presence[] = [];
    const names: string[] = [];
    for (const [id, o] of this.others) {
      names.push(o.user || 'Someone');
      if (o.row >= 0 && o.sheet === this.host.grid.sheetIndex) here.push({ row: o.row, col: o.col, color: colour(id), name: o.user || 'Someone' });
    }
    this.host.grid.setOthers(here);
    this.who.textContent = names.length ? `Also here: ${names.join(', ')}` : 'Only you have this workbook open.';
  }

  private async refreshAll(): Promise<void> {
    if (!this.id) return;
    const sheet = this.host.grid.sheetIndex;
    const marks = new Map<number, string>();
    for (const t of this.snap.threads) if (t.sheet === sheet && t.status !== 'resolved') marks.set(this.host.grid.keyOf(t.row, t.col), '#7c3aed');
    for (const k of Object.keys(this.snap.notes)) {
      const [s, r, c] = k.split(':').map(Number);
      if (s === sheet) marks.set(this.host.grid.keyOf(r, c), '#dc2626');
    }
    this.host.grid.setMarks(marks);
    const seq = ++this.maskSeq;
    const [sheetLines, bookLines] = await Promise.all([engine().protText(this.book, sheet), engine().protText(this.book, -1)]);
    if (seq !== this.maskSeq) return;
    const on = sheetLines.some((l) => l.startsWith('S\t1'));
    const masked = new Set<number>();
    if (on) {
      for (const l of sheetLines) {
        const f = l.split('\t');
        if (f[0] === 'C' && Number(f[3]) & 2) masked.add(this.host.grid.keyOf(Number(f[1]), Number(f[2])));
      }
    }
    this.host.grid.setMasked(masked);
    this.banner.hidden = !bookLines.some((l) => l.split('\t')[4] === '1');
    this.paintThreads();
    this.showOthers();
  }

  private openTab(name: string, focusComposer = false): void {
    this.tab = name;
    this.side.dataset.open = 'true';
    for (const [k, p] of this.panes) p.hidden = k !== name;
    for (const [k, t] of this.tabs) t.setAttribute('aria-selected', String(k === name));
    if (name === 'versions') void this.loadVersions();
    if (name === 'share') void this.loadShares();
    if (name === 'changes') void this.loadChanges();
    if (name === 'activity') {
      this.seen = 0;
      this.paintActivity();
    }
    if (focusComposer) this.composer.focus();
  }

  private buildSide(): void {
    this.side.dataset.open = 'false';
    this.side.setAttribute('aria-label', 'Review');
    const head = el('div', 'fc-side-tabs');
    head.setAttribute('role', 'tablist');
    const labels: [string, string][] = [['comments', 'Comments'], ['changes', 'Changes'], ['versions', 'Versions'], ['share', 'Share'], ['activity', 'Activity']];
    for (const [k, label] of labels) {
      const t = button(label, 'fc-side-tab');
      t.setAttribute('role', 'tab');
      t.addEventListener('click', () => this.openTab(k));
      this.tabs.set(k, t);
      head.appendChild(t);
    }
    const close = button('Close', 'fc-link fc-side-close');
    close.addEventListener('click', () => {
      this.side.dataset.open = 'false';
      this.host.grid.focus();
    });
    head.appendChild(close);
    this.side.append(head, this.who);

    const comments = el('div', 'fc-side-pane');
    this.composer.placeholder = 'Comment on the active cell. Type @ and a name to mention someone.';
    this.composer.setAttribute('aria-label', 'New comment');
    this.assign.type = 'checkbox';
    const assignLabel = el('label', 'fc-sort-check');
    assignLabel.append(this.assign, document.createTextNode(' Assign to the first person mentioned'));
    const post = button('Comment', 'fc-btn fc-btn-primary');
    post.addEventListener('click', () => void this.newThread());
    const compose = el('div', 'fc-card');
    compose.append(this.composer, this.mentionRow, assignLabel, post);
    comments.append(compose, this.threadList);
    this.panes.set('comments', comments);

    const changes = el('div', 'fc-side-pane');
    for (const [v, l] of [['cell', 'Active cell'], ['sel', 'Selection'], ['sheet', 'This sheet'], ['all', 'Whole workbook']]) this.changeScope.appendChild(Object.assign(el('option'), { value: v, textContent: l }));
    this.changeScope.addEventListener('change', () => void this.loadChanges());
    const refresh = button('Refresh');
    refresh.addEventListener('click', () => void this.loadChanges());
    const row = el('div', 'fc-row');
    row.append(this.changeScope, refresh);
    changes.append(row, this.changeList);
    this.panes.set('changes', changes);

    const versions = el('div', 'fc-side-pane');
    this.versionName.placeholder = 'Name this version (optional)';
    this.versionName.setAttribute('aria-label', 'Version name');
    const save = button('Save a version now', 'fc-btn fc-btn-primary');
    save.addEventListener('click', () => void this.saveVersion());
    const vnote = el('span', 'fc-muted', 'FormCel keeps a version when you save, at most one every five minutes, and whenever you choose Save a version. Restoring is itself a new version.');
    versions.append(this.versionName, save, vnote, this.versionList, this.preview);
    this.preview.hidden = true;
    this.panes.set('versions', versions);

    const share = el('div', 'fc-side-pane');
    const pub = button('Publish this sheet to the web');
    pub.addEventListener('click', () => void this.makeShare('publish'));
    const link = button('Share this sheet by link (read-only)');
    link.addEventListener('click', () => void this.makeShare('share'));
    const snote = el('span', 'fc-muted', 'Links open a read-only page served by the FormCel engine on this computer, so they work on this machine or on a network that can reach it. Revoke a link to stop it working.');
    share.append(pub, link, snote, this.shareList);
    this.panes.set('share', share);

    const act = el('div', 'fc-side-pane');
    act.append(el('span', 'fc-muted', 'Edits and changes made by other windows on this workbook.'), this.activityList);
    this.panes.set('activity', act);
    const wrap = el('div', 'fc-side-wrap');
    for (const p of this.panes.values()) {
      p.hidden = true;
      wrap.appendChild(p);
    }
    this.side.appendChild(wrap);
    this.panes.get('comments')!.hidden = false;
    this.tabs.get('comments')!.setAttribute('aria-selected', 'true');
    this.composer.addEventListener('input', () => this.paintMentions());
  }

  private paintMentions(): void {
    const names = this.snap.people.filter((p) => p && p !== userName());
    const sig = names.join('|');
    if (this.mentionRow.dataset.sig === sig) return;
    this.mentionRow.dataset.sig = sig;
    this.mentionRow.replaceChildren(
      ...names.map((n) => {
        const b = button(`@${n}`, 'fc-link');
        b.addEventListener('click', () => {
          this.composer.value = `${this.composer.value}${this.composer.value && !/\s$/.test(this.composer.value) ? ' ' : ''}@${n} `;
          this.composer.focus();
        });
        return b;
      }),
    );
  }

  private text(value: string): DocumentFragment {
    const f = document.createDocumentFragment();
    const names = [...new Set([...this.snap.people, userName()])].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length) {
      f.append(value);
      return f;
    }
    const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    let last = 0;
    for (const m of value.matchAll(re)) {
      f.append(value.slice(last, m.index));
      f.append(el('span', 'fc-chip', `@${m[1]}`));
      last = (m.index ?? 0) + m[0].length;
    }
    f.append(value.slice(last));
    return f;
  }

  private paintThreads(): void {
    this.paintMentions();
    const sheet = this.host.grid.sheetIndex;
    const mine = this.snap.threads.filter((t) => t.sheet === sheet).sort((a, b) => a.row - b.row || a.col - b.col);
    const cards = mine.map((t) => this.card(t));
    if (!cards.length) cards.push(el('span', 'fc-muted', 'No comments on this sheet yet. Select a cell and write one above.'));
    this.threadList.replaceChildren(...cards);
  }

  private card(t: Thread): HTMLElement {
    const c = el('div', 'fc-card');
    c.dataset.resolved = String(t.status === 'resolved');
    const head = el('div', 'fc-card-head');
    const go = button(`${colName(t.col)}${t.row + 1}`, 'fc-link');
    go.addEventListener('click', () => this.host.grid.goTo(`${colName(t.col)}${t.row + 1}`));
    head.append(go, el('span', '', t.status === 'resolved' ? 'Resolved' : 'Open'));
    if (t.assignee) head.append(el('span', 'fc-assigned', `Assigned to ${t.assignee}`));
    c.appendChild(head);
    for (const m of t.messages) {
      const d = el('div', 'fc-msg');
      const p = el('span');
      p.appendChild(this.text(m.text));
      d.append(Object.assign(el('strong'), { textContent: m.author || 'Someone' }), p, el('small', '', when(m.time)));
      c.appendChild(d);
    }
    const reply = el('textarea', 'fc-text');
    reply.placeholder = 'Reply';
    reply.value = this.drafts.get(t.id) ?? '';
    reply.addEventListener('input', () => this.drafts.set(t.id, reply.value));
    const row = el('div', 'fc-row');
    const send = button('Reply', 'fc-btn fc-btn-primary');
    send.addEventListener('click', () => void this.reply(t, reply.value));
    const resolve = button(t.status === 'resolved' ? 'Reopen' : 'Resolve');
    resolve.addEventListener('click', () => void this.patch(t, { status: t.status === 'resolved' ? 'open' : 'resolved' }));
    const who = el('select', 'fc-fmt-input');
    who.setAttribute('aria-label', 'Assign to');
    who.appendChild(Object.assign(el('option'), { value: '', textContent: 'Unassigned' }));
    for (const n of this.snap.people) who.appendChild(Object.assign(el('option'), { value: n, textContent: n }));
    who.value = t.assignee;
    who.addEventListener('change', () => void this.patch(t, { assignee: who.value }));
    const del = button('Delete', 'fc-link');
    del.addEventListener('click', () => void this.apply(call<Snapshot>('DELETE', `/api/workbooks/${this.id}/threads/${t.id}`)));
    row.append(send, resolve, who, del);
    c.append(reply, row);
    return c;
  }

  private async apply(p: Promise<Snapshot>): Promise<void> {
    try {
      const s = await p;
      this.snap = s;
      await this.refreshAll();
    } catch (err) {
      this.refused(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  private async newThread(): Promise<void> {
    const text = this.composer.value.trim();
    if (!text || !this.id) return;
    const [row, col] = this.host.grid.activeCell();
    await this.apply(call<Snapshot>('POST', `/api/workbooks/${this.id}/threads`, { sheet: this.host.grid.sheetIndex, row, col, text, assign: this.assign.checked }));
    this.composer.value = '';
    this.assign.checked = false;
  }

  private async reply(t: Thread, text: string): Promise<void> {
    if (!text.trim()) return;
    this.drafts.delete(t.id);
    await this.apply(call<Snapshot>('POST', `/api/workbooks/${this.id}/threads/${t.id}/replies`, { text: text.trim(), assign: false }));
  }

  private async patch(t: Thread, body: { status?: string; assignee?: string }): Promise<void> {
    await this.apply(call<Snapshot>('PATCH', `/api/workbooks/${this.id}/threads/${t.id}`, body));
  }

  async pasteNotes(src: { sheet: number; r0: number; c0: number; r1: number; c1: number }, dr: number, dc: number, transpose: boolean): Promise<number> {
    if (!this.id) return 0;
    const sheet = this.host.grid.sheetIndex;
    let n = 0;
    for (const [key, note] of Object.entries(this.snap.notes)) {
      const [s, r, c] = key.split(':').map(Number);
      if (s !== src.sheet || r < src.r0 || r > src.r1 || c < src.c0 || c > src.c1) continue;
      const row = transpose ? dr + (c - src.c0) : dr + (r - src.r0);
      const col = transpose ? dc + (r - src.r0) : dc + (c - src.c0);
      await this.apply(call<Snapshot>('PUT', `/api/workbooks/${this.id}/notes`, { sheet, row, col, text: note.text }));
      n++;
    }
    return n;
  }

  private noteBox(): void {
    if (!this.id) return;
    const d = (this.noteDlg ??= dialog('Note', '<label class="fc-fmt-label">Note<textarea class="fc-text" data-k="text" spellcheck="true"></textarea></label><button type="button" class="fc-btn" data-a="delete">Delete note</button>', () => this.host.grid.focus()));
    const [row, col] = this.host.grid.activeCell();
    const sheet = this.host.grid.sheetIndex;
    const key = `${sheet}:${row}:${col}`;
    d.form.querySelector('.fc-fmt-title')!.textContent = `Note on ${colName(col)}${row + 1}`;
    const text = d.q<HTMLTextAreaElement>('text');
    text.value = this.snap.notes[key]?.text ?? '';
    d.form.querySelector<HTMLElement>('[data-a="delete"]')!.hidden = !this.snap.notes[key];
    const send = async (value: string) => {
      await this.apply(call<Snapshot>('PUT', `/api/workbooks/${this.id}/notes`, { sheet, row, col, text: value }));
      d.close();
    };
    d.form.onsubmit = (e) => {
      e.preventDefault();
      void send(text.value);
    };
    d.form.querySelector<HTMLElement>('[data-a="delete"]')!.onclick = () => void send('');
    d.show();
  }

  private async pushProtection(sheet: number | null): Promise<void> {
    const lines = await engine().protText(this.book, sheet ?? -1);
    await call('PUT', `/api/workbooks/${this.id}/protection`, { sheet, lines });
    await this.refreshAll();
  }

  private async protectMenu(): Promise<void> {
    if (!this.id) return;
    const sheet = this.host.grid.sheetIndex;
    const [sl, bl] = await Promise.all([engine().protText(this.book, sheet), engine().protText(this.book, -1)]);
    const sheetOn = sl.some((l) => l.startsWith('S\t1'));
    const structure = bl.some((l) => l.split('\t')[1] === '1');
    const final = bl.some((l) => l.split('\t')[4] === '1');
    const b = document.querySelector<HTMLElement>('[data-cmd="protect.menu"]')!.getBoundingClientRect();
    this.host.menu.show(b.left, b.bottom + 4, [
      { label: sheetOn ? 'Unprotect sheet' : 'Protect sheet', run: () => this.sheetBox() },
      { label: 'Cell protection: locked and hidden', run: () => this.cellBox() },
      { label: 'Protected ranges for named people', run: () => this.rangeBox() },
      { sep: true },
      { label: structure ? 'Unprotect workbook structure' : 'Protect workbook structure', run: () => this.bookToggle() },
      { label: final ? 'Edit anyway (workbook is marked as final)' : 'Mark as final', run: () => this.finalToggle() },
      { sep: true },
      { label: `Your name: ${userName()}`, run: () => this.nameBox() },
    ], () => this.host.grid.focus());
  }

  private password(title: string, text: string): Promise<string | null> {
    const d = (this.passDlg ??= dialog(title, '<span class="fc-fmt-hint" data-k="text"></span><input class="fc-fmt-input" data-k="pw" type="password" autocomplete="off" aria-label="Password">', () => this.host.grid.focus()));
    d.form.querySelector('.fc-fmt-title')!.textContent = title;
    d.q('text').textContent = text;
    const input = d.q<HTMLInputElement>('pw');
    input.value = '';
    return new Promise((resolve) => {
      d.form.onsubmit = (e) => {
        e.preventDefault();
        d.form.hidden = true;
        resolve(input.value);
      };
      d.form.querySelector<HTMLElement>('[data-a="cancel"]')!.onclick = () => {
        d.form.hidden = true;
        resolve(null);
      };
      d.show();
    });
  }

  private async sheetBox(): Promise<void> {
    const sheet = this.host.grid.sheetIndex;
    const e = engine();
    const lines = await e.protText(this.book, sheet);
    const on = lines.some((l) => l.startsWith('S\t1'));
    if (on) {
      let pw = '';
      for (;;) {
        try {
          await e.protectSheet(this.book, sheet, false, pw, []);
          break;
        } catch (err) {
          const got = await this.password('Unprotect sheet', err instanceof Error && pw ? err.message : 'This sheet is protected with a password. Type it to unprotect the sheet.');
          if (got === null) return;
          pw = got;
        }
      }
      await this.pushProtection(sheet);
      this.host.status('Sheet unprotected');
      return;
    }
    const checks = ACTIONS.map(([k, l]) => `<label class="fc-sort-check"><input type="checkbox" data-k="a-${k}"> ${l}</label>`).join('');
    const d = (this.sheetDlg ??= dialog('Protect sheet', `<label class="fc-fmt-label">Password to unprotect (optional)<input class="fc-fmt-input" data-k="pw" type="password" autocomplete="off"></label><span class="fc-fmt-hint">Allow everyone to:</span><div class="fc-checks">${checks}</div>`, () => this.host.grid.focus()));
    for (const [k] of ACTIONS) d.q<HTMLInputElement>(`a-${k}`).checked = k.startsWith('select_');
    d.q<HTMLInputElement>('pw').value = '';
    d.form.onsubmit = (ev) => {
      ev.preventDefault();
      const allow = ACTIONS.filter(([k]) => d.q<HTMLInputElement>(`a-${k}`).checked).map(([k]) => k);
      void (async () => {
        try {
          await e.protectSheet(this.book, sheet, true, d.q<HTMLInputElement>('pw').value, allow);
          await this.pushProtection(sheet);
          d.close();
          this.host.status('Sheet protected');
        } catch (err) {
          d.form.dataset.state = 'error';
          d.hint.textContent = err instanceof Error ? err.message : 'Not protected.';
        }
      })();
    };
    d.show();
  }

  private async cellBox(): Promise<void> {
    const sheet = this.host.grid.sheetIndex;
    const s = this.host.grid.selection();
    const flags = await engine().cellFlags(this.book, sheet, s.r0, s.c0);
    const d = (this.cellDlg ??= dialog('Cell protection', '<label class="fc-sort-check"><input type="checkbox" data-k="locked"> Locked</label><label class="fc-sort-check"><input type="checkbox" data-k="hidden"> Hidden (hide the formula in the formula bar)</label><span class="fc-fmt-hint">Locking and hiding only take effect while the sheet is protected.</span>', () => this.host.grid.focus()));
    d.q<HTMLInputElement>('locked').checked = (flags & 1) === 0;
    d.q<HTMLInputElement>('hidden').checked = (flags & 2) !== 0;
    d.form.onsubmit = (ev) => {
      ev.preventDefault();
      void (async () => {
        try {
          await engine().setCellFlags(this.book, sheet, s.r0, s.c0, s.r1, s.c1, !d.q<HTMLInputElement>('locked').checked, d.q<HTMLInputElement>('hidden').checked);
          await this.pushProtection(sheet);
          d.close();
        } catch (err) {
          d.form.dataset.state = 'error';
          d.hint.textContent = err instanceof Error ? err.message : 'Not changed.';
        }
      })();
    };
    d.show();
  }

  private async rangeBox(): Promise<void> {
    const sheet = this.host.grid.sheetIndex;
    const lines = await engine().protText(this.book, sheet);
    const rows = lines.filter((l) => l.startsWith('R\t')).map((l) => {
      const f = l.split('\t');
      const [r0, c0, r1, c1] = f[2].split(',').map(Number);
      return `${unesc(f[1])} | ${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1} | ${unesc(f[3] ?? '').split(';').join(', ')}`;
    });
    const d = (this.rangeDlg ??= dialog('Protected ranges', '<span class="fc-fmt-hint">One range per line as: Name | A1:B5 | person, person. Only the listed people can edit the range; anyone else is refused.</span><textarea class="fc-text" data-k="text" spellcheck="false"></textarea>', () => this.host.grid.focus()));
    d.q<HTMLTextAreaElement>('text').value = rows.join('\n');
    d.form.onsubmit = (ev) => {
      ev.preventDefault();
      const out: string[] = [];
      for (const raw of d.q<HTMLTextAreaElement>('text').value.split('\n')) {
        if (!raw.trim()) continue;
        const [name, ref, people = ''] = raw.split('|').map((x) => x.trim());
        const r = parseRef((ref ?? '').replace(/\$/g, ''));
        if (!name || !r) {
          d.form.dataset.state = 'error';
          d.hint.textContent = `Could not read: ${raw}`;
          return;
        }
        out.push(`R\t${esc(name)}\t${r.r0},${r.c0},${r.r1},${r.c1}\t${esc(people.split(',').map((p) => p.trim()).filter(Boolean).join(';'))}`);
      }
      void (async () => {
        try {
          await engine().setEditRanges(this.book, sheet, out);
          await this.pushProtection(sheet);
          d.close();
        } catch (err) {
          d.form.dataset.state = 'error';
          d.hint.textContent = err instanceof Error ? err.message : 'Not saved.';
        }
      })();
    };
    d.show();
  }

  private async bookToggle(): Promise<void> {
    const e = engine();
    const lines = await e.protText(this.book, -1);
    const on = lines.some((l) => l.split('\t')[1] === '1');
    let pw = '';
    if (on) {
      for (;;) {
        try {
          await e.protectBook(this.book, false, pw);
          break;
        } catch (err) {
          const got = await this.password('Unprotect workbook structure', err instanceof Error && pw ? err.message : 'This workbook structure is protected with a password.');
          if (got === null) return;
          pw = got;
        }
      }
    } else {
      const got = await this.password('Protect workbook structure', 'Sheets cannot be added, deleted, renamed or moved. A password is optional; leave it empty for none.');
      if (got === null) return;
      await e.protectBook(this.book, true, got);
    }
    await this.pushProtection(null);
    this.host.status(on ? 'Workbook structure unprotected' : 'Workbook structure protected');
  }

  private async finalToggle(): Promise<void> {
    const lines = await engine().protText(this.book, -1);
    const final = lines.some((l) => l.split('\t')[4] === '1');
    await engine().markFinal(this.book, !final);
    await this.pushProtection(null);
    this.host.status(final ? 'Editing allowed' : 'Marked as final');
  }

  private async finalOff(): Promise<void> {
    await engine().markFinal(this.book, false);
    await this.pushProtection(null);
  }

  private nameBox(): void {
    const d = (this.nameDlg ??= dialog('Your name', '<label class="fc-fmt-label">Name shown on your notes, comments, edits and cursor<input class="fc-fmt-input" data-k="name" spellcheck="false" autocomplete="off"></label>', () => this.host.grid.focus()));
    d.q<HTMLInputElement>('name').value = userName();
    d.form.onsubmit = (ev) => {
      ev.preventDefault();
      const v = d.q<HTMLInputElement>('name').value.trim().slice(0, 60);
      if (!v) return;
      try {
        localStorage.setItem(USER_KEY, v);
      } catch {
        d.hint.textContent = 'This browser would not keep the name.';
      }
      if (this.id) {
        void engine().setUser(this.book, v);
        this.source?.close();
        this.connect();
      }
      d.close();
    };
    d.show();
  }

  private async loadChanges(): Promise<void> {
    if (!this.id) return;
    const g = this.host.grid;
    const sheet = g.sheetIndex;
    const scope = this.changeScope.value;
    const s = scope === 'cell' ? { r0: g.activeCell()[0], c0: g.activeCell()[1], r1: g.activeCell()[0], c1: g.activeCell()[1] } : g.selection();
    const q = scope === 'all' ? '' : scope === 'sheet' ? `?sheet=${sheet}` : `?sheet=${sheet}&r0=${s.r0}&c0=${s.c0}&r1=${s.r1}&c1=${s.c1}`;
    const r = await call<{ changes: Change[] }>('GET', `/api/workbooks/${this.id}/history${q}`).catch(() => ({ changes: [] as Change[] }));
    const rows = r.changes.map((c) => {
      const tr = el('tr');
      for (const v of [when(c.t), c.user || 'Unknown', `${c.sheetName}!${c.ref}`, `${c.before || '(empty)'} to ${c.after || '(empty)'}`]) tr.appendChild(el('td', '', v));
      return tr;
    });
    if (!rows.length) {
      const tr = el('tr');
      tr.appendChild(Object.assign(el('td', 'fc-muted', 'No recorded edits here yet.'), { colSpan: 4 }));
      rows.push(tr);
    }
    this.changeList.replaceChildren(...rows);
  }

  private async loadVersions(): Promise<void> {
    if (!this.id) return;
    const r = await call<{ versions: Version[] }>('GET', `/api/workbooks/${this.id}/versions`).catch(() => ({ versions: [] as Version[] }));
    const cards = r.versions.map((v) => {
      const c = el('div', 'fc-card');
      const head = el('div', 'fc-card-head');
      head.append(Object.assign(el('strong'), { textContent: v.name || when(v.time) }), el('span', 'fc-muted', v.name ? when(v.time) : ''));
      const sub = el('span', 'fc-muted', `${v.user ? `${v.user}, ` : ''}${v.why}, ${(v.size / 1024).toFixed(1)} KB`);
      const row = el('div', 'fc-row');
      const prev = button('Preview');
      prev.addEventListener('click', () => void this.previewVersion(v));
      const name = button('Name');
      name.addEventListener('click', () => void this.nameVersion(v));
      const restore = button('Restore');
      restore.addEventListener('click', () => void this.restoreVersion(v));
      row.append(prev, name, restore);
      c.append(head, sub, row);
      return c;
    });
    this.versionList.replaceChildren(...(cards.length ? cards : [el('span', 'fc-muted', 'No versions yet.')]));
  }

  private async saveVersion(): Promise<void> {
    await call('POST', `/api/workbooks/${this.id}/versions`, { name: this.versionName.value.trim() }).catch((e: unknown) => this.refused(e instanceof Error ? e.message : 'Not saved.'));
    this.versionName.value = '';
    await this.loadVersions();
  }

  private nameVersion(v: Version): void {
    const d = (this.versionDlg ??= dialog('Name this version', '<input class="fc-fmt-input" data-k="name" spellcheck="false" autocomplete="off" aria-label="Version name">', () => undefined));
    d.q<HTMLInputElement>('name').value = v.name;
    d.form.onsubmit = (ev) => {
      ev.preventDefault();
      void call('PATCH', `/api/workbooks/${this.id}/versions/${v.id}`, { name: d.q<HTMLInputElement>('name').value }).then(() => {
        d.close();
        return this.loadVersions();
      }, (err: unknown) => this.refused(err instanceof Error ? err.message : 'Not named.'));
    };
    d.show();
  }

  private async previewVersion(v: Version): Promise<void> {
    const r = await call<{ sheets: string[]; grid: string[][] }>('GET', `/api/workbooks/${this.id}/versions/${v.id}/preview?sheet=${this.host.grid.sheetIndex}`).catch(() => null);
    if (!r) return;
    const table = el('table');
    const last = r.grid.reduce((m, row, i) => (row.some(Boolean) ? i : m), 0);
    const width = r.grid.reduce((m, row) => Math.max(m, row.reduce((w, c, i) => (c ? i + 1 : w), 0)), 1);
    for (const row of r.grid.slice(0, last + 1)) {
      const tr = el('tr');
      for (const c of row.slice(0, width)) tr.appendChild(el('td', '', c));
      table.appendChild(tr);
    }
    this.preview.replaceChildren(Object.assign(el('strong'), { textContent: `Preview of ${v.name || when(v.time)} (${r.sheets[this.host.grid.sheetIndex] ?? ''}); formulas show as typed` }), table);
    this.preview.hidden = false;
  }

  private async restoreVersion(v: Version): Promise<void> {
    await call('POST', `/api/workbooks/${this.id}/versions/${v.id}/restore`).catch((e: unknown) => this.refused(e instanceof Error ? e.message : 'Not restored.'));
    this.host.reload();
  }

  private async loadShares(): Promise<void> {
    if (!this.id) return;
    const r = await call<{ shares: Share[] }>('GET', `/api/workbooks/${this.id}/shares`).catch(() => ({ shares: [] as Share[] }));
    const cards = r.shares.map((s) => {
      const c = el('div', 'fc-card');
      const head = el('div', 'fc-card-head');
      head.append(Object.assign(el('strong'), { textContent: s.kind === 'publish' ? 'Published' : 'Shared by link' }), el('span', 'fc-muted', this.sheets[s.sheet] ?? ''));
      const url = el('input', 'fc-fmt-input');
      url.readOnly = true;
      url.value = s.url;
      url.setAttribute('aria-label', 'Link');
      const row = el('div', 'fc-row');
      const copy = button('Copy link');
      copy.addEventListener('click', () => void this.copy(s.url));
      const embed = button('Copy embed code');
      embed.addEventListener('click', () => void this.copy(s.embed));
      const open = button('Open');
      open.addEventListener('click', () => window.open(s.url, '_blank', 'noopener'));
      const revoke = button('Revoke', 'fc-btn');
      revoke.addEventListener('click', () => void call('DELETE', `/api/workbooks/${this.id}/shares/${s.token}`).then(() => this.loadShares()));
      row.append(copy, embed, open, revoke);
      c.append(head, url, row);
      return c;
    });
    this.shareList.replaceChildren(...(cards.length ? cards : [el('span', 'fc-muted', 'Nothing is shared or published.')]));
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.host.status('Copied');
    } catch {
      this.host.status('Could not copy; select the link and copy it', true);
    }
  }

  private async makeShare(kind: string): Promise<void> {
    await call('POST', `/api/workbooks/${this.id}/shares`, { sheet: this.host.grid.sheetIndex, kind }).catch((e: unknown) => this.refused(e instanceof Error ? e.message : 'Not shared.'));
    await this.loadShares();
  }

  private paintActivity(): void {
    this.activityList.replaceChildren(...(this.activity.length ? this.activity.map((a) => el('div', 'fc-msg', a)) : [el('span', 'fc-muted', 'Nothing yet.')]));
    this.tabs.get('activity')!.textContent = this.seen ? `Activity (${this.seen})` : 'Activity';
  }
}
