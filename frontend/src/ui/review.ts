import { button, call, colour, el, when } from './collab';

export interface Notice { id: string; from: string; kind: string; text: string; sheet: number; row: number; col: number; thread: string; time: string; read: boolean }
export interface Watch { id: string; sheet: number; r0: number; c0: number; r1: number; c1: number }
export interface ChatLine { id: string; user: string; time: string; text: string }
export interface Chip { id: string; kind: string; label: string; value: string }
interface Lan { on: boolean; port: number; base: string; addresses: string[]; error: string }
interface Link {
  token: string; sheet: number; kind: string; perm: string; scope: string; format: string; live: boolean; expires: string; url: string; embed: string; reach: string; republished?: string;
}
interface Activity {
  links: { token: string; kind: string; perm: string; sheet: number; created: string; revoked: boolean; views: number; visitors: number; last: string }[];
  recent: { t: string; token: string; user: string; ip: string; what: string }[];
  daily: { day: string; views: number }[];
  online: { client: string; user: string }[];
}

export interface PaneHost {
  id(): string;
  sheets(): string[];
  sheet(): number;
  selection(): { r0: number; c0: number; r1: number; c1: number };
  goTo(a1: string): void;
  status(text: string, error?: boolean): void;
  refused(text: string): void;
  colName(c: number): string;
}

function keyed(box: HTMLElement, items: [string, HTMLElement][], empty: HTMLElement): void {
  const want = new Map(items);
  for (const child of [...box.children] as HTMLElement[]) {
    const k = child.dataset.key;
    if (child !== empty && (!k || !want.has(k))) child.remove();
  }
  let prev: Element | null = null;
  for (const [k, node] of items) {
    node.dataset.key = k;
    const here = box.querySelector(`:scope > [data-key="${CSS.escape(k)}"]`);
    if (here && here !== node) here.replaceWith(node);
    if (!node.parentElement) box.insertBefore(node, prev ? prev.nextSibling : box.firstChild);
    prev = node;
  }
  empty.hidden = items.length > 0;
  if (!empty.parentElement) box.appendChild(empty);
}

export class PeoplePane {
  readonly root = el('div', 'fc-side-pane');
  private readonly list = el('div', 'fc-side-list');
  private readonly none = el('span', 'fc-muted', 'Only you have this workbook open.');
  private readonly log = el('div', 'fc-side-list');
  private readonly quiet = el('span', 'fc-muted', 'No messages yet. Everyone who has this workbook open, here or by a link that allows comments, sees what you write.');
  private readonly input = el('textarea', 'fc-text');
  private readonly seen = new Set<string>();
  private readonly nodes = new Map<string, HTMLElement>();

  constructor(private readonly host: PaneHost) {
    this.input.placeholder = 'Message everyone in this workbook';
    this.input.setAttribute('aria-label', 'Chat message');
    this.input.rows = 2;
    const send = button('Send', 'fc-btn fc-btn-primary');
    send.addEventListener('click', () => void this.send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.log.setAttribute('aria-live', 'polite');
    this.root.append(el('strong', '', 'Here now'), this.list, el('strong', '', 'Chat'), this.log, this.input, send);
    this.list.appendChild(this.none);
    this.log.appendChild(this.quiet);
  }

  people(people: { id: string; user: string; where: string }[]): void {
    const items: [string, HTMLElement][] = people.map((p) => {
      const old = this.nodes.get(`p:${p.id}`);
      const row = old ?? el('div', 'fc-row');
      if (!old) {
        const dot = el('span', 'fc-dot');
        dot.style.background = colour(p.id);
        row.append(dot, el('span'), el('small', 'fc-muted'));
        this.nodes.set(`p:${p.id}`, row);
      }
      const [, name, where] = Array.from(row.children) as HTMLElement[];
      if (name.textContent !== (p.user || 'Someone')) name.textContent = p.user || 'Someone';
      if (where.textContent !== p.where) where.textContent = p.where;
      return [p.id, row];
    });
    keyed(this.list, items, this.none);
  }

  lines(msgs: ChatLine[]): void {
    for (const m of msgs) this.add(m);
  }

  add(m: ChatLine): void {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const d = el('div', 'fc-msg');
    d.append(Object.assign(el('strong'), { textContent: m.user }), el('span', '', m.text), el('small', '', when(m.time)));
    this.quiet.hidden = true;
    this.log.insertBefore(d, this.quiet);
    d.scrollIntoView({ block: 'nearest' });
  }

  reset(): void {
    this.seen.clear();
    this.nodes.clear();
    for (const c of [...this.log.children]) if (c !== this.quiet) c.remove();
    this.quiet.hidden = false;
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || !this.host.id()) return;
    this.input.value = '';
    try {
      this.add(await call<ChatLine>('POST', `/api/workbooks/${this.host.id()}/chat`, { text }));
    } catch (err) {
      this.input.value = text;
      this.host.refused(err instanceof Error ? err.message : 'The message did not send.');
    }
  }
}

export class NoticesPane {
  readonly root = el('div', 'fc-side-pane');
  private readonly list = el('div', 'fc-side-list');
  private readonly none = el('span', 'fc-muted', 'Nothing for you yet. You are told here when someone mentions you, assigns you a comment, replies to you, or changes a range you watch.');
  private readonly watches = el('div', 'fc-side-list');
  private readonly noWatch = el('span', 'fc-muted', 'You are not watching any range.');
  private readonly nodes = new Map<string, HTMLElement>();
  private items: Notice[] = [];

  constructor(private readonly host: PaneHost, private readonly changed: () => void, private readonly reload: () => void) {
    const mark = button('Mark all as read');
    mark.addEventListener('click', () => void this.read([]));
    const watch = button('Tell me when the selection changes');
    watch.addEventListener('click', () => void this.watch());
    this.root.append(mark, this.list, el('strong', '', 'Ranges you watch'), watch, this.watches);
    this.list.appendChild(this.none);
    this.watches.appendChild(this.noWatch);
  }

  unread(): number {
    return this.items.filter((n) => !n.read).length;
  }

  show(items: Notice[], watches: Watch[]): void {
    this.items = items;
    const rows: [string, HTMLElement][] = [...items].reverse().map((n) => {
      const node = this.nodes.get(n.id) ?? this.card(n);
      node.dataset.read = String(n.read);
      return [n.id, node];
    });
    keyed(this.list, rows, this.none);
    const sheets = this.host.sheets();
    const w: [string, HTMLElement][] = watches.map((x) => {
      const row = el('div', 'fc-row');
      const label = `${sheets[x.sheet] ?? 'Sheet'}!${this.host.colName(x.c0)}${x.r0 + 1}:${this.host.colName(x.c1)}${x.r1 + 1}`;
      const del = button('Stop', 'fc-link');
      del.addEventListener('click', () => void call('DELETE', `/api/workbooks/${this.host.id()}/watch/${x.id}`).then(() => this.reload()));
      row.append(el('span', '', label), del);
      return [x.id, row];
    });
    keyed(this.watches, w, this.noWatch);
    this.changed();
  }

  private card(n: Notice): HTMLElement {
    const c = el('div', 'fc-card');
    const head = el('div', 'fc-card-head');
    const label = { mention: 'mentioned you', assign: 'assigned a comment to you', reply: 'replied', watch: 'changed a range you watch' }[n.kind] ?? n.kind;
    head.append(Object.assign(el('strong'), { textContent: n.from || 'Someone' }), el('span', '', label));
    if (n.row >= 0) {
      const go = button(`${this.host.colName(n.col)}${n.row + 1}`, 'fc-link');
      go.addEventListener('click', () => {
        this.host.goTo(`${this.host.colName(n.col)}${n.row + 1}`);
        void this.read([n.id]);
      });
      head.appendChild(go);
    }
    c.append(head, el('span', '', n.text), el('small', 'fc-muted', when(n.time)));
    this.nodes.set(n.id, c);
    return c;
  }

  private async read(ids: string[]): Promise<void> {
    await call('POST', `/api/workbooks/${this.host.id()}/notifications/read`, { ids }).catch(() => undefined);
    for (const n of this.items) if (!ids.length || ids.includes(n.id)) n.read = true;
    for (const [id, node] of this.nodes) if (!ids.length || ids.includes(id)) node.dataset.read = 'true';
    this.changed();
  }

  private async watch(): Promise<void> {
    const s = this.host.selection();
    try {
      await call('POST', `/api/workbooks/${this.host.id()}/watch`, { sheet: this.host.sheet(), r0: s.r0, c0: s.c0, r1: s.r1, c1: s.c1 });
      this.reload();
      this.host.status('You will be told when that range changes');
    } catch (err) {
      this.host.refused(err instanceof Error ? err.message : 'Not watching.');
    }
  }
}

export class SharePane {
  readonly root = el('div', 'fc-side-pane');
  private readonly lanLine = el('span', 'fc-muted');
  private readonly lanBtn = button('Turn on sharing on this network');
  private readonly kind = el('select', 'fc-fmt-input');
  private readonly perm = el('select', 'fc-fmt-input');
  private readonly scope = el('select', 'fc-fmt-input');
  private readonly format = el('select', 'fc-fmt-input');
  private readonly expiry = el('select', 'fc-fmt-input');
  private readonly live = el('input');
  private readonly list = el('div', 'fc-side-list');
  private readonly empty = el('span', 'fc-muted', 'Nothing is shared or published.');
  private readonly dash = el('div', 'fc-side-list');
  private readonly nodes = new Map<string, HTMLElement>();
  private lan: Lan = { on: false, port: 0, base: '', addresses: [], error: '' };

  constructor(private readonly host: PaneHost) {
    const opt = (s: HTMLSelectElement, items: [string, string][]) => items.forEach(([v, l]) => s.appendChild(Object.assign(el('option'), { value: v, textContent: l })));
    opt(this.kind, [['share', 'Share by link'], ['publish', 'Publish to the web']]);
    opt(this.perm, [['view', 'Anyone with the link can view'], ['comment', 'Anyone with the link can comment'], ['edit', 'Anyone with the link can edit']]);
    opt(this.scope, [['sheet', 'This sheet only'], ['book', 'Entire workbook']]);
    opt(this.format, [['html', 'As a web page'], ['csv', 'As CSV (one sheet)']]);
    opt(this.expiry, [['', 'Link does not expire'], ['1', 'Expires in 1 day'], ['7', 'Expires in 7 days'], ['30', 'Expires in 30 days']]);
    for (const [s, label] of [[this.kind, 'Kind of link'], [this.perm, 'Permission'], [this.scope, 'What to include'], [this.format, 'Format'], [this.expiry, 'Expiry']] as [HTMLSelectElement, string][]) s.setAttribute('aria-label', label);
    this.live.type = 'checkbox';
    this.live.checked = true;
    const liveLabel = el('label', 'fc-sort-check');
    liveLabel.append(this.live, document.createTextNode(' Update automatically when the workbook changes'));
    const make = button('Create link', 'fc-btn fc-btn-primary');
    make.addEventListener('click', () => void this.make());
    this.kind.addEventListener('change', () => this.fit());
    this.lanBtn.addEventListener('click', () => void this.toggleLan());
    const note = el('span', 'fc-muted', 'Sharing is off until you turn it on. While on, FormCel listens on your local network for these links only, each protected by its own secret address. Anyone on the network who has a link can use it, so share links only with people you trust, and revoke a link to stop it. Links use plain http, so keep them off untrusted networks.');
    const form = el('div', 'fc-card');
    form.append(this.kind, this.perm, this.scope, this.format, this.expiry, liveLabel, make);
    const lan = el('div', 'fc-card');
    lan.append(this.lanLine, this.lanBtn, note);
    this.list.appendChild(this.empty);
    this.root.append(lan, form, this.list, el('strong', '', 'Who viewed these links'), this.dash);
    this.fit();
  }

  private fit(): void {
    const publish = this.kind.value === 'publish';
    this.perm.hidden = publish;
    this.format.hidden = !publish;
  }

  async load(): Promise<void> {
    if (!this.host.id()) return;
    const r = await call<{ shares: Link[]; lan: Lan }>('GET', `/api/workbooks/${this.host.id()}/shares`).catch(() => null);
    if (!r) return;
    this.lan = r.lan;
    this.paintLan();
    const items: [string, HTMLElement][] = r.shares.map((s) => [s.token, this.card(s)]);
    keyed(this.list, items, this.empty);
    await this.activity();
  }

  private paintLan(): void {
    const l = this.lan;
    const text = l.on
      ? `Sharing is on. Links open at ${l.base}${l.addresses.length > 1 ? ` (this computer also answers at ${l.addresses.slice(1).map((a) => `http://${a}:${l.port}`).join(', ')})` : ''}.`
      : 'Sharing is off. Links open only on this computer.';
    if (this.lanLine.textContent !== text) this.lanLine.textContent = l.error ? `${text} ${l.error}` : text;
    const label = l.on ? 'Turn off sharing on this network' : 'Turn on sharing on this network';
    if (this.lanBtn.textContent !== label) this.lanBtn.textContent = label;
  }

  private async toggleLan(): Promise<void> {
    try {
      this.lan = await call<Lan>('PUT', '/api/lan', { on: !this.lan.on });
      this.paintLan();
      await this.load();
    } catch (err) {
      this.host.refused(err instanceof Error ? err.message : 'Sharing did not change.');
    }
  }

  private async make(): Promise<void> {
    const publish = this.kind.value === 'publish';
    try {
      await call('POST', `/api/workbooks/${this.host.id()}/shares`, {
        sheet: this.host.sheet(), kind: this.kind.value, perm: publish ? 'view' : this.perm.value, scope: this.scope.value, format: publish ? this.format.value : 'html',
        live: publish ? this.live.checked : true, days: this.expiry.value ? Number(this.expiry.value) : null,
      });
      await this.load();
    } catch (err) {
      this.host.refused(err instanceof Error ? err.message : 'Not shared.');
    }
  }

  private card(s: Link): HTMLElement {
    const c = this.nodes.get(s.token) ?? el('div', 'fc-card');
    this.nodes.set(s.token, c);
    const sheets = this.host.sheets();
    const sig = JSON.stringify(s) + sheets.join('|');
    if (c.dataset.sig === sig) return c;
    c.dataset.sig = sig;
    c.replaceChildren();
    const head = el('div', 'fc-card-head');
    const title = s.kind === 'publish' ? `Published${s.format === 'csv' ? ' as CSV' : ''}` : `Shared: ${{ view: 'view', comment: 'comment', edit: 'edit' }[s.perm] ?? s.perm}`;
    head.append(Object.assign(el('strong'), { textContent: title }), el('span', 'fc-muted', s.scope === 'book' ? 'Entire workbook' : sheets[s.sheet] ?? ''));
    const url = el('input', 'fc-fmt-input');
    url.readOnly = true;
    url.value = s.url;
    url.setAttribute('aria-label', 'Link');
    const reach = el('small', 'fc-muted', s.reach === 'lan' ? 'Reachable on your network' : 'Reachable on this computer only');
    const row = el('div', 'fc-row');
    const copy = button('Copy link');
    copy.addEventListener('click', () => void this.copy(s.url));
    const open = button('Open');
    open.addEventListener('click', () => window.open(s.url, '_blank', 'noopener'));
    const revoke = button('Revoke');
    revoke.addEventListener('click', () => void call('DELETE', `/api/workbooks/${this.host.id()}/shares/${s.token}`).then(() => this.load()));
    row.append(copy, open);
    if (s.kind === 'share') {
      const p = el('select', 'fc-fmt-input');
      for (const [v, l] of [['view', 'View'], ['comment', 'Comment'], ['edit', 'Edit']]) p.appendChild(Object.assign(el('option'), { value: v, textContent: l }));
      p.value = s.perm;
      p.setAttribute('aria-label', 'Permission');
      p.addEventListener('change', () => void call('PATCH', `/api/workbooks/${this.host.id()}/shares/${s.token}`, { perm: p.value }).then(() => this.load()));
      row.appendChild(p);
    } else {
      const auto = el('label', 'fc-sort-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s.live;
      box.addEventListener('change', () => void call('PATCH', `/api/workbooks/${this.host.id()}/shares/${s.token}`, { live: box.checked }).then(() => this.load()));
      auto.append(box, document.createTextNode(' Republish automatically'));
      row.appendChild(auto);
      if (!s.live) {
        const again = button('Republish now');
        again.addEventListener('click', () => void call('POST', `/api/workbooks/${this.host.id()}/shares/${s.token}/republish`).then(() => this.load()));
        row.appendChild(again);
      }
    }
    row.appendChild(revoke);
    c.append(head, url, reach, row);
    if (s.expires) c.appendChild(el('small', 'fc-muted', `Expires ${when(s.expires)}`));
    if (s.kind === 'publish' && !s.live) c.appendChild(el('small', 'fc-muted', `Shows the workbook as of ${when(s.republished ?? '') || 'when it was published'}`));
    if (s.kind === 'publish' || s.perm === 'view') c.appendChild(this.embedBox(s));
    return c;
  }

  private embedBox(s: Link): HTMLElement {
    const d = el('details');
    d.appendChild(el('summary', '', 'Embed in a web page'));
    const grid = el('input');
    grid.type = 'checkbox';
    grid.checked = true;
    const heads = el('input');
    heads.type = 'checkbox';
    heads.checked = true;
    const range = el('input', 'fc-fmt-input');
    range.placeholder = 'Range, for example A1:D20 (optional)';
    range.setAttribute('aria-label', 'Range to embed');
    const sheet = el('select', 'fc-fmt-input');
    sheet.setAttribute('aria-label', 'Sheet to embed');
    this.host.sheets().forEach((n, i) => sheet.appendChild(Object.assign(el('option'), { value: String(i), textContent: n })));
    sheet.value = String(s.sheet);
    sheet.hidden = s.scope !== 'book';
    const w = Object.assign(el('input', 'fc-fmt-input'), { type: 'number', value: '640' });
    const h = Object.assign(el('input', 'fc-fmt-input'), { type: 'number', value: '400' });
    w.setAttribute('aria-label', 'Width in pixels');
    h.setAttribute('aria-label', 'Height in pixels');
    const out = el('textarea', 'fc-text');
    out.readOnly = true;
    out.setAttribute('aria-label', 'Embed code');
    const refresh = () => {
      const q = new URLSearchParams({ embed: '1' });
      if (!grid.checked) q.set('gridlines', '0');
      if (!heads.checked) q.set('headers', '0');
      if (range.value.trim()) q.set('range', range.value.trim());
      if (s.scope === 'book') q.set('sheet', sheet.value);
      const width = Math.max(100, Number(w.value) || 640);
      const height = Math.max(60, Number(h.value) || 400);
      out.value = `<iframe src="${s.url}?${q.toString()}" width="${width}" height="${height}" style="border:1px solid #ccc" loading="lazy"></iframe>`;
    };
    for (const n of [grid, heads, range, sheet, w, h]) n.addEventListener('input', refresh);
    const l1 = el('label', 'fc-sort-check');
    l1.append(grid, document.createTextNode(' Show gridlines'));
    const l2 = el('label', 'fc-sort-check');
    l2.append(heads, document.createTextNode(' Show row and column headers'));
    const copy = button('Copy embed code');
    copy.addEventListener('click', () => void this.copy(out.value));
    const size = el('div', 'fc-row');
    size.append(w, h);
    d.append(range, sheet, l1, l2, size, out, copy);
    refresh();
    return d;
  }

  async activity(): Promise<void> {
    if (!this.host.id()) return;
    const a = await call<Activity>('GET', `/api/workbooks/${this.host.id()}/activity`).catch(() => null);
    if (!a) return;
    const kids: HTMLElement[] = [];
    const now = el('div', 'fc-msg');
    now.append(Object.assign(el('strong'), { textContent: 'Open now' }), el('span', '', a.online.length ? a.online.map((p) => p.user || 'Someone').join(', ') : 'Nobody else.'));
    kids.push(now);
    const peak = Math.max(1, ...a.daily.map((d) => d.views));
    if (a.daily.length) {
      const bars = el('div', 'fc-bars');
      for (const d of a.daily) {
        const bar = el('span', 'fc-bar');
        bar.style.setProperty('--h', `${Math.max(6, Math.round((d.views / peak) * 100))}%`);
        bar.title = `${d.day}: ${d.views} view${d.views === 1 ? '' : 's'}`;
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', bar.title);
        bars.appendChild(bar);
      }
      kids.push(bars, el('small', 'fc-muted', 'Views per day over the last two weeks'));
    }
    for (const l of a.links.filter((x) => !x.revoked)) {
      const row = el('div', 'fc-msg');
      const name = `${l.kind === 'publish' ? 'Published' : `Shared (${l.perm})`}, ${this.host.sheets()[l.sheet] ?? ''}`;
      row.append(Object.assign(el('strong'), { textContent: name }), el('span', '', `${l.views} view${l.views === 1 ? '' : 's'} by ${l.visitors} visitor${l.visitors === 1 ? '' : 's'}${l.last ? `, last ${when(l.last)}` : ''}`));
      kids.push(row);
    }
    if (a.recent.length) {
      kids.push(el('strong', '', 'Recent visits'));
      for (const r of a.recent.slice(0, 15)) kids.push(el('small', 'fc-muted', `${when(r.t)}  ${r.user || r.ip || 'Unknown'}  ${r.what}`));
    }
    this.dash.replaceChildren(...kids);
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.host.status('Copied');
    } catch {
      this.host.status('Could not copy; select the text and copy it', true);
    }
  }
}
