import { api, el, esc, setText } from '../automation/dom';
import { buttonRow, note, numberRow, selectRow, textRow, toggleRow } from './controls';

export interface Panel {
  el: HTMLElement;
  refresh(): Promise<void>;
}

const wrap = (...kids: HTMLElement[]): HTMLElement => {
  const d = el('div', 'fc-panel');
  d.append(...kids);
  return d;
};

const failure = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const pad = (text: string): string => `<span class="fc-grow">${text}</span>`;

interface AppSettings {
  snapshot_gap: number;
  version_limit: number;
  external_content: boolean;
  data_dir: string;
  secrets: { store: string; backend: string };
}

let appCache: Promise<AppSettings> | null = null;
export const appSettings = (fresh = false): Promise<AppSettings> => (!fresh && appCache ? appCache : (appCache = api<AppSettings>('GET', '/api/settings/app')));

export function recoveryPanel(): Panel {
  const gap = numberRow('Keep a version every (minutes)', 1, 1440, 1, (v) => void save({ snapshot_gap: Math.round(v * 60) }));
  const limit = numberRow('Versions kept per workbook', 5, 1000, 1, (v) => void save({ version_limit: Math.round(v) }));
  const msg = note('', true);
  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    try {
      const s = await api<AppSettings>('PUT', '/api/settings/app', patch);
      appCache = Promise.resolve(s);
      setText(msg, 'Saved. New versions follow this from now on.');
    } catch (err) {
      setText(msg, failure(err));
    }
  };
  return {
    el: wrap(gap.el, limit.el, msg),
    async refresh() {
      try {
        const s = await appSettings(true);
        gap.set(s.snapshot_gap / 60);
        limit.set(s.version_limit);
      } catch {
        setText(msg, 'The engine process could not be reached.');
      }
    },
  };
}

export function folderPanel(): Panel {
  const path = el('input', 'fc-input') as HTMLInputElement;
  path.readOnly = true;
  path.setAttribute('aria-label', 'Data folder');
  const row = el('label', 'fc-field');
  row.append(el('span', '', 'Data folder'), path);
  const copy = buttonRow('Copy the folder path', 'Copy', () => void navigator.clipboard?.writeText(path.value).then(() => setText(msg, 'Copied.'), () => setText(msg, 'The browser would not copy.')));
  const msg = note('Workbooks, templates, versions and the engine settings live here. Set FORMCEL_DATA_DIR before starting FormCel to use another folder. The window keeps its own preferences in this browser.', true);
  return {
    el: wrap(row, copy.el, msg),
    async refresh() {
      try {
        path.value = (await appSettings()).data_dir;
      } catch {
        path.value = '';
      }
    },
  };
}

interface Ai {
  configured: boolean;
  kind: string;
  url: string;
  model: string;
  key_set: boolean;
  store: { store: string; backend: string };
}

export function assistantPanel(): Panel {
  const kind = selectRow('API style', [['openai', 'OpenAI compatible'], ['anthropic', 'Anthropic Messages']], () => undefined);
  const url = textRow('Endpoint address', () => undefined, { placeholder: 'https://api.example.com/v1' });
  const model = textRow('Model', () => undefined);
  const key = textRow('API key', () => undefined, { type: 'password', placeholder: 'Not shown again once saved' });
  const msg = note('', true);
  const save = el('button', 'fc-btn fc-btn-primary', 'Save endpoint') as HTMLButtonElement;
  const clear = el('button', 'fc-btn fc-btn-danger', 'Remove endpoint') as HTMLButtonElement;
  const bar = el('div', 'fc-row-actions');
  bar.append(save, clear);
  const kindSel = kind.el.querySelector('select')!;
  const paint = (s: Ai): void => {
    kind.set(s.kind);
    url.set(s.url);
    model.set(s.model);
    key.input.value = '';
    key.input.placeholder = s.key_set ? 'A key is saved. Type to replace it.' : 'No key saved';
    setText(msg, s.configured ? `Connected to ${s.url}. The key is kept ${s.store.store === 'system' ? "in your system's password store" : 'in a file in the data folder that only you can read'}, never in the window or a workbook.` : 'No model endpoint is set. The assistant works offline with fixed rules until one is added.');
  };
  const send = async (gone: boolean): Promise<void> => {
    try {
      paint(await api<Ai>('PUT', '/api/settings/ai', { kind: kindSel.value, url: gone ? '' : url.input.value, model: gone ? '' : model.input.value, key: gone ? '' : key.input.value || null }));
      if (gone) setText(msg, 'The endpoint was removed.');
    } catch (err) {
      setText(msg, failure(err));
    }
  };
  save.addEventListener('click', () => void send(false));
  clear.addEventListener('click', () => void send(true));
  return {
    el: wrap(kind.el, url.el, model.el, key.el, bar, msg),
    async refresh() {
      try {
        paint(await api<Ai>('GET', '/api/settings/ai'));
      } catch {
        setText(msg, 'The engine process could not be reached.');
      }
    },
  };
}

export function tokenPanel(): Panel {
  const state = note('', true);
  const shown = el('input', 'fc-input') as HTMLInputElement;
  shown.readOnly = true;
  shown.hidden = true;
  shown.setAttribute('aria-label', 'New token');
  const make = el('button', 'fc-btn', 'Create token') as HTMLButtonElement;
  const drop = el('button', 'fc-btn fc-btn-danger', 'Remove token') as HTMLButtonElement;
  const docs = el('a', 'fc-btn', 'OpenAPI page') as HTMLAnchorElement;
  docs.href = '/api/docs';
  docs.target = '_blank';
  docs.rel = 'noopener';
  const bar = el('div', 'fc-row-actions');
  bar.append(make, drop, docs);
  const paint = async (): Promise<void> => {
    try {
      const s = await api<{ enabled: boolean }>('GET', '/api/settings/api');
      setText(state, s.enabled ? 'A token is required for the REST API: send Authorization: Bearer TOKEN.' : 'No token is set, so REST calls from this computer are open.');
    } catch {
      setText(state, 'The engine process could not be reached.');
    }
  };
  make.addEventListener('click', () => {
    void api<{ token: string }>('PUT', '/api/settings/api', { generate: true }).then(async (r) => {
      shown.value = r.token;
      shown.hidden = false;
      await paint();
    });
  });
  drop.addEventListener('click', () => {
    void api('PUT', '/api/settings/api', { token: '' }).then(async () => {
      shown.value = '';
      shown.hidden = true;
      await paint();
    });
  });
  return { el: wrap(state, bar, shown, note('A new token is shown once. The engine keeps it in the system password store when there is one, otherwise in a file only you can read.')), refresh: paint };
}

export function pythonPanel(): Panel {
  let on = false;
  const row = toggleRow('Run Python cells (=PY)', (v) => {
    void api('PUT', '/api/settings/python', { enabled: v }).then(refresh, refresh);
  });
  const msg = note('', true);
  async function refresh(): Promise<void> {
    try {
      const s = await api<{ enabled: boolean; version: string; limits: string; network: string }>('GET', '/api/settings/python');
      on = s.enabled;
      row.set(on);
      setText(msg, `Python ${s.version} in a separate process (${s.limits}; ${s.network}). It is restricted, not a security boundary: turn it on only for workbooks you trust.`);
    } catch {
      setText(msg, 'The engine process could not be reached.');
    }
  }
  return { el: wrap(row.el, msg), refresh };
}

export function externalPanel(): Panel {
  const row = toggleRow('Allow web functions (WEBSERVICE, IMPORTDATA, IMPORTXML)', (v) => {
    void api('PUT', '/api/settings/app', { external_content: v }).then((s) => {
      appCache = Promise.resolve(s as AppSettings);
      document.dispatchEvent(new Event('fc-hosted'));
    });
  });
  return {
    el: wrap(row.el, note('When off, those functions return #N/A without contacting any address. Links to other workbooks are managed under Data, Edit Links.')),
    async refresh() {
      try {
        row.set((await appSettings(true)).external_content);
      } catch {
        return;
      }
    },
  };
}

interface Lan {
  on: boolean;
  port: number;
  base: string;
  addresses: string[];
  error: string;
}

export function lanPanel(): Panel {
  const msg = note('', true);
  const row = toggleRow('Share on the local network', (v) => {
    void api<Lan>('PUT', '/api/lan', { on: v }).then(paint, (err) => setText(msg, failure(err)));
  });
  const paint = (s: Lan): void => {
    row.set(s.on);
    setText(msg, s.error || (s.on ? `Shared links open at ${s.base}. Anyone on this network who has a link can open it.` : 'Off. Share links work only on this computer.'));
  };
  return {
    el: wrap(row.el, msg),
    async refresh() {
      try {
        paint(await api<Lan>('GET', '/api/lan'));
      } catch {
        setText(msg, 'The engine process could not be reached.');
      }
    },
  };
}

interface Schedule {
  enabled: boolean;
  minutes: number;
  platform: string;
  active: boolean;
}

export function schedulerPanel(): Panel {
  const msg = note('', true);
  const minutes = selectRow('Refresh every', [['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['360', '6 hours'], ['1440', 'Day']], () => void apply());
  const row = toggleRow('Refresh queries while FormCel is closed', () => void apply());
  const sel = minutes.el.querySelector('select')!;
  const box = row.el.querySelector('input')!;
  const paint = (s: Schedule): void => {
    row.set(s.enabled);
    minutes.set(String(s.minutes));
    setText(msg, s.enabled ? `The operating system (${s.platform}) runs the refresh every ${s.minutes} minutes.` : 'Off. Scheduled queries refresh only while FormCel is open.');
  };
  async function apply(): Promise<void> {
    try {
      const r = await api<{ status: Schedule }>('PUT', '/api/settings/schedule', { enabled: box.checked, minutes: Number(sel.value), activate: true });
      paint(r.status);
    } catch (err) {
      setText(msg, failure(err));
    }
  }
  return {
    el: wrap(row.el, minutes.el, msg),
    async refresh() {
      try {
        paint(await api<Schedule>('GET', '/api/settings/schedule'));
      } catch {
        setText(msg, 'The engine process could not be reached.');
      }
    },
  };
}

interface Ext {
  id: string;
  name: string;
  version: string;
  description: string;
  scripts: unknown[];
}

export function extensionsPanel(): Panel {
  const list = el('div', 'fc-auto-list');
  const msg = note('', true);
  const path = textRow('Folder or .zip path', () => undefined, { placeholder: '/home/me/extensions/my-pack' });
  const install = el('button', 'fc-btn', 'Install') as HTMLButtonElement;
  const regUrl = textRow('Registry address', () => undefined, { placeholder: 'https://example.org/formcel/index.json' });
  const regKey = textRow('Pinned publisher key', () => undefined);
  const regSave = el('button', 'fc-btn', 'Save registry') as HTMLButtonElement;
  const regMsg = note('', true);
  const bar = el('div', 'fc-row-actions');
  bar.append(install);
  const bar2 = el('div', 'fc-row-actions');
  bar2.append(regSave);
  const load = async (): Promise<void> => {
    try {
      const exts = await api<Ext[]>('GET', '/api/extensions');
      list.replaceChildren(
        ...(exts.length
          ? exts.map((x) => {
              const item = el('div', 'fc-auto-item');
              item.innerHTML = `${pad(`${esc(x.name)} ${esc(x.version)}<small>${esc(x.description)} (${x.scripts.length} script${x.scripts.length === 1 ? '' : 's'})</small>`)}<button type="button" class="fc-btn fc-btn-danger" data-id="${esc(x.id)}">Remove</button>`;
              return item;
            })
          : [note('No extensions installed. Packages are folders or zips with a manifest.json.')]),
      );
    } catch {
      setText(msg, 'The engine process could not be reached.');
    }
  };
  list.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;
    void api('DELETE', `/api/extensions/${encodeURIComponent(id)}`).then(
      () => {
        setText(msg, 'Removed. Scripts already added to a workbook stay in it.');
        return load();
      },
      (err) => setText(msg, failure(err)),
    );
  });
  install.addEventListener('click', () => {
    if (!path.input.value.trim()) return;
    void api<Ext>('POST', '/api/extensions/install', { path: path.input.value.trim() }).then(
      (x) => {
        setText(msg, `Installed ${x.name} ${x.version}.`);
        path.input.value = '';
        return load();
      },
      (err) => setText(msg, failure(err)),
    );
  });
  const reg = async (): Promise<void> => {
    try {
      const r = await api<{ url: string; key: string; fingerprint: string }>('GET', '/api/settings/registry');
      regUrl.set(r.url);
      regKey.set(r.key);
      setText(regMsg, r.url ? `Registry set${r.key ? `; publisher key ${r.fingerprint} is pinned` : '; packages are checked by hash only'}. Browse it from Scripts, More.` : 'No registry is set.');
    } catch {
      setText(regMsg, 'The engine process could not be reached.');
    }
  };
  regSave.addEventListener('click', () => {
    void api('PUT', '/api/settings/registry', { url: regUrl.input.value.trim(), key: regKey.input.value.trim(), require_signature: false }).then(reg, (err) => setText(regMsg, failure(err)));
  });
  return { el: wrap(list, path.el, bar, msg, regUrl.el, regKey.el, bar2, regMsg), refresh: async () => void (await Promise.all([load(), reg()])) };
}

export function dictionaryPanel(): Panel {
  const list = el('div', 'fc-auto-list');
  const word = textRow('Add a word', () => undefined);
  const add = el('button', 'fc-btn', 'Add word') as HTMLButtonElement;
  const msg = note('', true);
  const bar = el('div', 'fc-row-actions');
  bar.append(add);
  const paint = (words: string[]): void => {
    list.replaceChildren(...(words.length ? words.map((w) => {
      const item = el('div', 'fc-auto-item');
      item.innerHTML = `${pad(esc(w))}<button type="button" class="fc-btn" data-word="${esc(w)}">Remove</button>`;
      return item;
    }) : [note('Your dictionary is empty. Words you add are accepted by the spelling check in every workbook.')]));
  };
  const load = async (): Promise<void> => {
    try {
      paint((await api<{ words: string[] }>('GET', '/api/spell/dictionary')).words);
    } catch {
      setText(msg, 'The engine process could not be reached.');
    }
  };
  add.addEventListener('click', () => {
    const w = word.input.value.trim();
    if (!w) return;
    void api<{ words: string[] }>('POST', '/api/spell/dictionary', { word: w }).then(
      (r) => {
        word.input.value = '';
        setText(msg, `Added ${w}.`);
        paint(r.words);
      },
      (err) => setText(msg, failure(err)),
    );
  });
  word.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add.click();
  });
  list.addEventListener('click', (e) => {
    const w = (e.target as HTMLElement).closest<HTMLElement>('[data-word]')?.dataset.word;
    if (!w) return;
    void api<{ words: string[] }>('DELETE', `/api/spell/dictionary/${encodeURIComponent(w)}`).then((r) => paint(r.words));
  });
  return { el: wrap(list, word.el, bar, msg), refresh: load };
}
