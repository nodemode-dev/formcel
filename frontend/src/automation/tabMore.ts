import { api, el, esc, setText } from './dom';
import { uid, type Env } from './model';

interface Ext {
  id: string;
  name: string;
  version: string;
  description: string;
  scripts: { name: string; code: string; custom: boolean }[];
}

export class MoreTab {
  readonly root = el('div', 'fc-auto-pane');
  private readonly ext: HTMLElement;
  private readonly btns: HTMLElement;
  private readonly apiMsg: HTMLElement;
  private readonly apiState: HTMLElement;
  private exts: Ext[] = [];

  constructor(private readonly env: Env, private readonly onScripts: () => void) {
    this.root.innerHTML = `
      <h3 class="fc-auto-h">Buttons on this sheet</h3>
      <div class="fc-auto-list" data-l="btns"></div>
      <h3 class="fc-auto-h">Extensions</h3>
      <p class="fc-auto-hint">Script packages found in the Extensions folder of FormCel's data folder. Each has a manifest.json that lists its scripts. FormCel has no online marketplace.</p>
      <div class="fc-auto-list" data-l="ext"></div>
      <h3 class="fc-auto-h">REST API</h3>
      <p class="fc-auto-hint fc-api-state"></p>
      <div class="fc-auto-row"><button type="button" class="fc-btn" data-a="gen">Create token</button><button type="button" class="fc-btn" data-a="off">Remove token</button><a class="fc-btn" href="/api/docs" target="_blank" rel="noopener">OpenAPI page</a></div>
      <p class="fc-auto-hint fc-api-msg" aria-live="polite"></p>
      <h3 class="fc-auto-h">Not here</h3>
      <p class="fc-auto-hint">Python in cells (=PY) is not included: it would need a bundled Python runtime in the window. VBA macros are kept in .xlsm files and never run. Data from a picture (OCR) is not included: no offline OCR engine is bundled.</p>`;
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
      else if (a === 'delbtn') {
        this.env.auto.buttons = this.env.auto.buttons.filter((x) => x.id !== b.dataset.id);
        this.env.changed();
        this.paintButtons();
        document.dispatchEvent(new CustomEvent('fc-buttons'));
      }
    });
    this.root.addEventListener('change', (e) => {
      const s = e.target as HTMLSelectElement;
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
      ? this.exts.map((x) => `<div class="fc-auto-item"><span class="fc-grow">${esc(x.name)} ${esc(x.version)}<small>${esc(x.description)} (${x.scripts.length} script${x.scripts.length === 1 ? '' : 's'})</small></span><button type="button" class="fc-btn" data-a="install" data-id="${esc(x.id)}">Add to workbook</button></div>`).join('')
      : '<p class="fc-auto-hint">No extensions installed.</p>';
    try {
      const s = await api<{ enabled: boolean }>('GET', '/api/settings/api');
      this.apiState.innerHTML = `Read and write cells over HTTP at <code>/api/v1/workbooks/{id}/sheets/{sheet}/values?range=A1:C5</code> (GET and PUT), and list workbooks and sheets. ${s.enabled ? 'A token is required: send <code>Authorization: Bearer TOKEN</code>.' : 'No token is set, so calls from this computer are open.'} This workbook's id is <code>${esc(this.env.id())}</code>.`;
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

  private install(id: string): void {
    const x = this.exts.find((e) => e.id === id);
    if (!x) return;
    for (const s of x.scripts) this.env.auto.scripts.push({ id: uid(), name: `${x.name}: ${s.name}`, code: s.code });
    this.env.changed();
    this.onScripts();
  }

  private async token(on: boolean): Promise<void> {
    const r = await api<{ enabled: boolean; token: string }>('PUT', '/api/settings/api', on ? { generate: true } : { token: '' });
    setText(this.apiMsg, on ? `Token: ${r.token}  (shown once; keep it somewhere safe)` : 'The token was removed.');
    await this.load();
  }
}
