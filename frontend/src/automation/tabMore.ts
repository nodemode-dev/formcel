import { api, el, esc, setText } from './dom';
import type { FnMeta } from './customMeta';
import { uid, type Env } from './model';
import { installable, installed, promptInstall } from '../pwa';

interface Ext {
  id: string;
  name: string;
  version: string;
  description: string;
  functions: (FnMeta & { script?: string })[];
  scripts: { file: string; name: string; code: string; custom: boolean; button?: string }[];
}

interface Registry {
  url: string;
  key: string;
  require_signature: boolean;
  fingerprint: string;
}

interface Catalog {
  registry: { url: string; name: string };
  categories: string[];
  items: { id: string; name: string; version: string; description: string; author: string; category: string; signed: boolean; status: string; installedVersion: string | null; folder: string | null }[];
}

export class MoreTab {
  private market: Catalog['items'] = [];
  readonly root = el('div', 'fc-auto-pane');
  private readonly ext: HTMLElement;
  private readonly btns: HTMLElement;
  private readonly apiMsg: HTMLElement;
  private readonly apiState: HTMLElement;
  private exts: Ext[] = [];
  private pyOn = false;

  constructor(private readonly env: Env, private readonly onScripts: () => void) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">Buttons on this sheet</h3>
      <div class="fc-auto-list" data-l="btns"></div>
      <h3 class="fc-auto-h">Extensions</h3>
      <p class="fc-auto-hint">Browse a registry: an address that serves a JSON index of packages, each with a download address and a SHA-256 hash (and optionally an Ed25519 signature). Every download is checked against its hash before it is installed; pin the publisher's key to require a valid signature as well.</p>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="regurl" placeholder="Registry address, such as https://example.org/formcel/index.json" spellcheck="false" aria-label="Registry address"><button type="button" class="fc-btn" data-a="regsave">Save registry</button></div>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="regkey" placeholder="Pinned publisher key (base64, optional)" spellcheck="false" aria-label="Pinned publisher key"><label class="fc-auto-small"><input type="checkbox" data-f="regreq"> Require signatures</label></div>
      <p class="fc-auto-hint fc-reg-msg" aria-live="polite"></p>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" type="search" data-f="mq" placeholder="Search extensions" aria-label="Search extensions"><select class="fc-auto-input" data-f="mcat" aria-label="Category"><option value="">All categories</option></select><button type="button" class="fc-btn" data-a="mbrowse">Browse</button><button type="button" class="fc-btn" data-a="mupall" disabled>Update all</button></div>
      <div class="fc-auto-list fc-market" data-l="market"></div>
      <h3 class="fc-auto-h">Installed</h3>
      <p class="fc-auto-hint">A package is a folder or a .zip with a manifest.json (name, version, description, scripts: [{file, name, custom, button}]) at its top. Installed packages live in the Extensions folder of FormCel's data folder; Add to workbook copies their scripts in.</p>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" data-f="extpath" placeholder="Folder or .zip path on this computer" spellcheck="false"><button type="button" class="fc-btn" data-a="extpath">Install</button></div>
      <div class="fc-auto-row"><input class="fc-auto-input fc-grow" type="file" accept=".zip,application/zip" data-f="extzip" aria-label="Choose a package zip"></div>
      <p class="fc-auto-hint fc-ext-msg" aria-live="polite"></p>
      <div class="fc-auto-list" data-l="ext"></div>
      <h3 class="fc-auto-h">Python cells</h3>
      <p class="fc-auto-hint fc-py-state"></p>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="pytoggle"></button></div>
      <h3 class="fc-auto-h">Runtimes</h3>
      <p class="fc-auto-hint fc-rt-state"></p>
      <h3 class="fc-auto-h">Install as an app</h3>
      <p class="fc-auto-hint fc-pwa-state"></p>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="pwa" disabled>Install FormCel</button></div>
      <h3 class="fc-auto-h">REST API</h3>
      <p class="fc-auto-hint fc-api-state"></p>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="gen">Create token</button><button type="button" class="fc-btn" data-a="off">Remove token</button><a class="fc-btn" href="/api/docs" target="_blank" rel="noopener">OpenAPI page</a></div>
      <p class="fc-auto-hint fc-api-msg" aria-live="polite"></p>
      <h3 class="fc-auto-h">Limits</h3>
      <p class="fc-auto-hint">VBA macros are kept in .xlsm files and never run. Scripts and macros run in the window; only custom functions (when a JavaScript runtime is installed), =PY cells, =IMPORTRANGE and scheduled queries run in the engine process while the window is closed.</p>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.ext = q('[data-l="ext"]');
    this.btns = q('[data-l="btns"]');
    this.apiMsg = q('.fc-api-msg');
    this.apiState = q('.fc-api-state');
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'gen') void this.token(true);
      else if (a === 'off') void this.token(false);
      else if (a === 'install') this.install(b.dataset.id ?? '');
      else if (a === 'extpath') void this.installPath();
      else if (a === 'extdel') void this.removeExt(b.dataset.id ?? '');
      else if (a === 'regsave') void this.saveRegistry();
      else if (a === 'mbrowse') void this.browse();
      else if (a === 'mget') void this.marketInstall(b.dataset.id ?? '');
      else if (a === 'mupall') void this.updateAll();
      else if (a === 'pytoggle') void this.togglePython();
      else if (a === 'pwa') void promptInstall().then(() => this.paintPwa());
      else if (a === 'delbtn') {
        this.env.auto.buttons = this.env.auto.buttons.filter((x) => x.id !== b.dataset.id);
        this.env.changed();
        this.paintButtons();
        document.dispatchEvent(new CustomEvent('fc-buttons'));
      }
    });
    this.root.addEventListener('change', (e) => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.f === 'extzip') {
        void this.installZip(s as unknown as HTMLInputElement);
        return;
      }
      const btn = this.env.auto.buttons.find((x) => x.id === s.dataset.id);
      if (btn && s.dataset.f === 'script') {
        btn.script = s.value;
        this.env.changed();
      }
    });
    this.root.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      const btn = this.env.auto.buttons.find((x) => x.id === i.dataset.id);
      if (btn && i.dataset.f === 'label') {
        btn.label = i.value;
        this.env.changed();
        document.dispatchEvent(new CustomEvent('fc-buttons'));
      }
    });
  }

  async load(): Promise<void> {
    this.paintButtons();
    try {
      this.exts = await api<Ext[]>('GET', '/api/extensions');
    } catch {
      this.exts = [];
    }
    this.ext.innerHTML = this.exts.length
      ? this.exts.map((x) => `<div class="fc-auto-item"><span class="fc-grow">${esc(x.name)} ${esc(x.version)}<small>${esc(x.description)} (${x.scripts.length} script${x.scripts.length === 1 ? '' : 's'})</small></span><button type="button" class="fc-btn" data-a="install" data-id="${esc(x.id)}">Add to workbook</button><button type="button" class="fc-btn fc-btn-danger" data-a="extdel" data-id="${esc(x.id)}">Remove</button></div>`).join('')
      : '<p class="fc-auto-hint">No extensions installed.</p>';
    void this.paintRuntime();
    this.paintPwa();
    void this.loadRegistry();
    try {
      const s = await api<{ enabled: boolean }>('GET', '/api/settings/api');
      this.apiState.innerHTML = `Read and write cells over HTTP at <code>/api/v1/workbooks/{id}/sheets/{sheet}/values?range=A1:C5</code> (GET, PUT and DELETE), plus create, rename and delete for workbooks and sheets, formulas (<code>/formulas</code>), number formats and styles (<code>/formats</code>), names, tables, charts, pivots, conditional formats, validations, filters and sheet copy and order. Every endpoint is listed on the OpenAPI page. ${s.enabled ? 'A token is required: send <code>Authorization: Bearer TOKEN</code>.' : 'No token is set, so calls from this computer are open.'} This workbook's id is <code>${esc(this.env.id())}</code>.`;
    } catch {
      setText(this.apiState, 'The engine process could not be reached.');
    }
  }

  paintButtons(): void {
    const scripts = this.env.auto.scripts;
    const list = this.env.auto.buttons;
    this.btns.innerHTML = list.length
      ? list.map((b) => `<div class="fc-auto-item"><input class="fc-auto-input fc-grow" data-f="label" data-id="${b.id}" value="${esc(b.label)}" aria-label="Button label"><select class="fc-auto-input" data-f="script" data-id="${b.id}" aria-label="Script">${scripts.map((s) => `<option value="${s.id}" ${s.id === b.script ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button type="button" class="fc-btn fc-btn-danger" data-a="delbtn" data-id="${b.id}">Remove</button></div>`).join('')
      : '<p class="fc-auto-hint">No buttons. Open a script and choose Add button.</p>';
  }

  private async paintRuntime(): Promise<void> {
    const py = this.root.querySelector<HTMLElement>('.fc-py-state')!;
    const rt = this.root.querySelector<HTMLElement>('.fc-rt-state')!;
    const btn = this.root.querySelector<HTMLButtonElement>('[data-a="pytoggle"]')!;
    try {
      const r = await api<{ ocr: { available: boolean; engine: string }; javascript: { available: boolean; runtime: string }; python: { enabled: boolean; version: string; modules: string[]; pandas: boolean; network: string; limits: string }; databases: Record<string, boolean> }>('GET', '/api/runtime');
      this.pyOn = r.python.enabled;
      setText(py, `=PY("code", range1, range2) runs Python ${r.python.version} in the engine process, in a separate process (${r.python.limits}; ${r.python.network}). Modules: ${r.python.modules.join(', ')}. Inside the code xl("A1:C10", headers=True) reads a range or table as a DataFrame, arg1, arg2 hold ranges passed in the formula, the last expression or a variable named result is the answer, and DataFrames, lists and dicts spill into cells with their headers. Cells run by sheet, row, then column. Use Ctrl+Alt+Shift+P to edit a cell as Python. It is restricted, not a security boundary: turn it on only for workbooks you trust. State: ${r.python.enabled ? 'on' : 'off'}.`);
      setText(btn, r.python.enabled ? 'Turn Python cells off' : 'Turn Python cells on');
      setText(rt, `Text recognition: ${r.ocr.available ? r.ocr.engine : 'not installed'}. JavaScript for custom functions in the engine process: ${r.javascript.available ? r.javascript.runtime : 'not installed (they compute in the window only)'}. Databases: SQLite ${r.databases.sqlite ? 'ready' : 'missing'}, PostgreSQL ${r.databases.postgres ? 'ready' : 'driver missing'}, MySQL ${r.databases.mysql ? 'ready' : 'driver missing'}.`);
    } catch {
      setText(rt, 'The engine process could not be reached.');
    }
  }

  private async togglePython(): Promise<void> {
    await api('PUT', '/api/settings/python', { enabled: !this.pyOn });
    await this.paintRuntime();
    await this.env.calls.drain(true, true);
  }

  private paintPwa(): void {
    const t = this.root.querySelector<HTMLElement>('.fc-pwa-state')!;
    const b = this.root.querySelector<HTMLButtonElement>('[data-a="pwa"]')!;
    const done = installed();
    b.disabled = done || !installable();
    setText(t, done ? 'FormCel is running as an installed app.' : installable() ? 'Install FormCel to open it in its own window from your Start menu, Dock, Home Screen or app drawer. The app shell is cached, but it still needs the FormCel engine process running on this computer or a server you host; workbooks are not stored in the browser.' : 'Your browser offers install from its menu: Chrome and Edge on Windows, macOS and Android (Install app), Safari on macOS (File, Add to Dock) and iOS (Share, Add to Home Screen). This is a web app install, not a native build; native desktop installers come from the src-tauri shell.');
  }

  private regMsg(text: string): void {
    setText(this.root.querySelector('.fc-reg-msg')!, text);
  }

  private async loadRegistry(): Promise<void> {
    try {
      const r = await api<Registry>('GET', '/api/settings/registry');
      this.root.querySelector<HTMLInputElement>('[data-f="regurl"]')!.value = r.url;
      this.root.querySelector<HTMLInputElement>('[data-f="regkey"]')!.value = r.key;
      this.root.querySelector<HTMLInputElement>('[data-f="regreq"]')!.checked = r.require_signature;
      this.regMsg(r.url ? `Registry set${r.key ? `; publisher key ${r.fingerprint} is pinned` : '; no publisher key is pinned, so packages are checked by hash only'}.` : 'No registry is set.');
    } catch {
      this.regMsg('The engine process could not be reached.');
    }
  }

  private async saveRegistry(): Promise<void> {
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    try {
      await api('PUT', '/api/settings/registry', { url: q<HTMLInputElement>('[data-f="regurl"]').value.trim(), key: q<HTMLInputElement>('[data-f="regkey"]').value.trim(), require_signature: q<HTMLInputElement>('[data-f="regreq"]').checked });
      await this.loadRegistry();
      await this.browse();
    } catch (err) {
      this.regMsg(err instanceof Error ? err.message : String(err));
    }
  }

  private async browse(): Promise<void> {
    const q = (this.root.querySelector<HTMLInputElement>('[data-f="mq"]')!.value || '').trim();
    const catSel = this.root.querySelector<HTMLSelectElement>('[data-f="mcat"]')!;
    const list = this.root.querySelector<HTMLElement>('[data-l="market"]')!;
    const upall = this.root.querySelector<HTMLButtonElement>('[data-a="mupall"]')!;
    try {
      const r = await api<Catalog>('GET', `/api/extensions/catalog?q=${encodeURIComponent(q)}&category=${encodeURIComponent(catSel.value)}`);
      const keep = catSel.value;
      catSel.innerHTML = `<option value="">All categories</option>${r.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
      catSel.value = r.categories.includes(keep) ? keep : '';
      this.market = r.items;
      upall.disabled = !r.items.some((i) => i.status === 'update');
      list.innerHTML = r.items.length
        ? r.items
            .map((i) => {
              const act = i.status === 'update' ? `<button type="button" class="fc-btn fc-btn-primary" data-a="mget" data-id="${esc(i.id)}">Update to ${esc(i.version)}</button>` : i.status === 'installed' ? '<span class="fc-chip">Installed</span>' : `<button type="button" class="fc-btn" data-a="mget" data-id="${esc(i.id)}">Install</button>`;
              const rm = i.folder ? `<button type="button" class="fc-btn fc-btn-danger" data-a="extdel" data-id="${esc(i.folder)}">Remove</button>` : '';
              return `<div class="fc-auto-item fc-market-item"><span class="fc-grow">${esc(i.name)} ${esc(i.version)} <span class="fc-chip">${esc(i.category)}</span>${i.signed ? ' <span class="fc-chip">signed</span>' : ''}<small>${esc(i.description)}${i.author ? ` By ${esc(i.author)}.` : ''}${i.installedVersion ? ` Installed: ${esc(i.installedVersion)}.` : ''}</small></span>${act}${rm}</div>`;
            })
            .join('')
        : '<p class="fc-auto-hint">Nothing in the registry matches.</p>';
      this.regMsg(`${r.items.length} extension${r.items.length === 1 ? '' : 's'} in ${r.registry.name || r.registry.url}.`);
    } catch (err) {
      list.replaceChildren();
      this.regMsg(err instanceof Error ? err.message : String(err));
    }
  }

  private async marketInstall(id: string): Promise<void> {
    this.regMsg('Downloading and checking the package');
    try {
      const r = await api<Ext & { trust: string }>('POST', '/api/extensions/market/install', { id });
      this.regMsg(`Installed ${r.name} ${r.version}. Check: ${r.trust}.`);
      await this.load();
      await this.browse();
    } catch (err) {
      this.regMsg(err instanceof Error ? err.message : String(err));
    }
  }

  private async updateAll(): Promise<void> {
    for (const i of this.market.filter((x) => x.status === 'update')) await this.marketInstall(i.id);
  }

  private async installPath(): Promise<void> {
    const input = this.root.querySelector<HTMLInputElement>('[data-f="extpath"]')!;
    if (!input.value.trim()) return;
    await this.sendInstall({ path: input.value.trim() });
    input.value = '';
  }

  private async installZip(input: HTMLInputElement): Promise<void> {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const data = await new Promise<string>((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result));
      rd.onerror = () => reject(rd.error);
      rd.readAsDataURL(f);
    });
    await this.sendInstall({ zip: data });
  }

  private async sendInstall(body: { path?: string; zip?: string }): Promise<void> {
    const msg = this.root.querySelector<HTMLElement>('.fc-ext-msg')!;
    try {
      const x = await api<Ext>('POST', '/api/extensions/install', body);
      setText(msg, `Installed ${x.name} ${x.version}.`);
      await this.load();
    } catch (err) {
      setText(msg, err instanceof Error ? err.message : String(err));
    }
  }

  private async removeExt(id: string): Promise<void> {
    const msg = this.root.querySelector<HTMLElement>('.fc-ext-msg')!;
    try {
      await api('DELETE', `/api/extensions/${encodeURIComponent(id)}`);
      setText(msg, 'Removed. Scripts already added to a workbook stay in it.');
      await this.load();
    } catch (err) {
      setText(msg, err instanceof Error ? err.message : String(err));
    }
  }

  private install(id: string): void {
    const x = this.exts.find((e) => e.id === id);
    if (!x) return;
    let n = 0;
    for (const s of x.scripts) {
      const sid = uid();
      const meta = s.custom ? x.functions.filter((f) => !f.script || f.script === s.file) : [];
      this.env.auto.scripts.push({ id: sid, name: `${x.name}: ${s.name}`, code: s.code, ...(meta.length ? { meta } : {}) });
      if (s.button) this.env.auto.buttons.push({ id: uid(), label: s.button, script: sid, x: 24 + 120 * n++, y: 48 });
    }
    this.env.changed();
    this.onScripts();
    this.paintButtons();
    document.dispatchEvent(new CustomEvent('fc-buttons'));
    this.env.customChanged();
  }

  private async token(on: boolean): Promise<void> {
    const r = await api<{ enabled: boolean; token: string }>('PUT', '/api/settings/api', on ? { generate: true } : { token: '' });
    setText(this.apiMsg, on ? `Token: ${r.token}  (shown once; keep it somewhere safe)` : 'The token was removed.');
    await this.load();
  }
}
