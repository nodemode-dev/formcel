import { actions, el, makeModal, type Modal } from '../ui/modal';
import { getQuoteSettings, putQuoteSettings, testProvider, type ProviderInfo, type QuoteSettings } from './api';

export interface ProviderPanel {
  reload(): Promise<void>;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', 'fc-dt-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function numberField(value: number, min: number): HTMLInputElement {
  const i = el('input', 'fc-dt-num');
  i.type = 'number';
  i.min = String(min);
  i.value = String(value);
  return i;
}

export function mountProviderSettings(root: HTMLElement, onSaved?: (s: QuoteSettings) => void): ProviderPanel {
  root.classList.add('fc-dt-prov');
  const intro = el('p', 'fc-dt-note', 'FormCel ships no market data feed. Pick a provider and use your own key where it needs one. Keys stay in the engine process data folder and are never written into a workbook. Prices come from the provider you pick and may be delayed; they are for information only.');
  const pick = el('select', 'fc-dt-select');
  pick.setAttribute('aria-label', 'Market data provider');
  const cards = el('div', 'fc-dt-cards');
  const fxRow = el('div', 'fc-dt-row');
  const fxSel = el('select', 'fc-dt-select');
  fxSel.setAttribute('aria-label', 'Exchange rate source');
  fxSel.append(new Option('European Central Bank daily reference rates (free, no key)', 'ecb'), new Option('The market data provider above', 'provider'));
  const ecbNote = el('div', 'fc-dt-note');
  const ttlRow = el('div', 'fc-dt-row');
  const result = el('div', 'fc-dt-result');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  const save = el('button', 'fc-btn fc-btn-primary', 'Save');
  save.type = 'button';
  const test = el('button', 'fc-btn', 'Test connection');
  test.type = 'button';
  const provRow = el('label', 'fc-dt-row');
  provRow.append(el('span', 'fc-dt-lab', 'Provider'), pick);
  fxRow.append(el('span', 'fc-dt-lab', 'Exchange rates'), fxSel);
  const quoteTtl = numberField(60, 0);
  const histTtl = numberField(21600, 0);
  ttlRow.append(el('span', 'fc-dt-lab', 'Keep quotes (seconds)'), quoteTtl, el('span', 'fc-dt-lab', 'Keep history and company data (seconds)'), histTtl);
  const buttons = el('div', 'fc-dt-actions');
  buttons.append(test, save);
  root.replaceChildren(intro, provRow, cards, fxRow, ecbNote, ttlRow, buttons, result);

  let state: QuoteSettings | null = null;
  const keyInputs = new Map<string, HTMLInputElement>();
  const baseInputs = new Map<string, HTMLInputElement>();
  const rpmInputs = new Map<string, HTMLInputElement>();
  const delayInputs = new Map<string, HTMLInputElement>();

  const card = (p: ProviderInfo): HTMLElement => {
    const c = el('section', 'fc-dt-pcard');
    c.dataset.provider = p.id;
    const head = el('h3', 'fc-dt-ph', p.label);
    const help = el('p', 'fc-dt-note', p.key_help);
    const key = el('input', 'fc-dt-key');
    key.type = 'password';
    key.autocomplete = 'off';
    key.spellcheck = false;
    key.placeholder = p.key_set ? 'A key is saved. Type to replace it, or clear to remove it.' : 'Paste your key';
    key.setAttribute('aria-label', `${p.label} key`);
    keyInputs.set(p.id, key);
    const clear = el('button', 'fc-btn', 'Remove key');
    clear.type = 'button';
    clear.hidden = !p.key_set;
    clear.addEventListener('click', async () => {
      state = await putQuoteSettings({ keys: { [p.id]: '' } });
      render(state);
      say('Key removed.');
    });
    const base = el('input', 'fc-dt-base');
    base.type = 'url';
    base.placeholder = p.default_base;
    base.value = p.base;
    base.setAttribute('aria-label', `${p.label} address`);
    baseInputs.set(p.id, base);
    const rpm = numberField(p.rpm, 1);
    rpmInputs.set(p.id, rpm);
    const delay = numberField(p.delay, 0);
    delayInputs.set(p.id, delay);
    const adv = el('details', 'fc-dt-adv');
    adv.append(el('summary', '', 'Address, request limit and data delay'));
    const grid = el('div', 'fc-dt-advgrid');
    grid.append(el('span', 'fc-dt-lab', 'Address'), base, el('span', 'fc-dt-lab', 'Requests a minute'), rpm, el('span', 'fc-dt-lab', 'Data delay (minutes)'), delay);
    adv.append(grid);
    const links = el('div', 'fc-dt-links');
    links.append(link(p.site, 'Provider site'), link(p.terms, 'Terms of use'));
    const keyRow = el('div', 'fc-dt-row');
    keyRow.append(key, clear);
    c.append(head, help, keyRow, adv, links);
    return c;
  };

  const say = (text: string, bad = false) => {
    result.textContent = text;
    result.dataset.state = bad ? 'bad' : 'ok';
  };

  const render = (s: QuoteSettings) => {
    state = s;
    keyInputs.clear();
    baseInputs.clear();
    rpmInputs.clear();
    delayInputs.clear();
    pick.replaceChildren(new Option('None selected', ''), ...s.providers.map((p) => new Option(p.label, p.id)));
    pick.value = s.provider;
    cards.replaceChildren(...s.providers.map(card));
    fxSel.value = s.fx;
    ecbNote.replaceChildren('Rates are the ECB euro reference rates, published about 16:00 CET on working days for around 30 currencies and cross-calculated through the euro. They are for information only. Source: ', link(s.ecb.terms, 'European Central Bank'), '.');
    quoteTtl.value = String(s.ttl.quote ?? 60);
    histTtl.value = String(s.ttl.history ?? 21600);
    mark();
  };

  const mark = () => {
    for (const c of cards.querySelectorAll<HTMLElement>('.fc-dt-pcard')) c.dataset.on = String(c.dataset.provider === pick.value);
  };
  pick.addEventListener('change', mark);

  const collect = () => {
    const keys: Record<string, string> = {};
    const bases: Record<string, string> = {};
    const rpm: Record<string, number> = {};
    const delay: Record<string, number> = {};
    for (const [id, i] of keyInputs) if (i.value.trim()) keys[id] = i.value.trim();
    for (const [id, i] of baseInputs) bases[id] = i.value.trim();
    for (const [id, i] of rpmInputs) rpm[id] = Math.max(1, Math.round(Number(i.value) || 1));
    for (const [id, i] of delayInputs) delay[id] = Math.max(0, Math.round(Number(i.value) || 0));
    return { provider: pick.value, fx: fxSel.value, keys, bases, rpm, delay, ttl: { quote: Number(quoteTtl.value) || 0, history: Number(histTtl.value) || 0, profile: Number(histTtl.value) || 0 } };
  };

  const persist = async (): Promise<boolean> => {
    try {
      const s = await putQuoteSettings(collect());
      render(s);
      onSaved?.(s);
      return true;
    } catch (err) {
      say(err instanceof Error ? err.message : 'The settings were not saved.', true);
      return false;
    }
  };

  save.addEventListener('click', async () => {
    if (await persist()) say('Saved. Cells that read market data refresh on the next Refresh All.');
  });
  test.addEventListener('click', async () => {
    if (!(await persist())) return;
    say('Testing');
    try {
      const r = await testProvider(pick.value);
      const lines = [`Exchange rates: ${r.ecb.ok ? 'reached' : 'not reached'}, ${r.ecb.note}`];
      if (r.provider) lines.push(`${pick.selectedOptions[0]?.text ?? 'Provider'}: ${r.provider.ok ? 'reached' : 'not reached'}, ${r.provider.note}`);
      else lines.push('No provider is selected.');
      say(lines.join('\n'), !(r.ecb.ok && (!r.provider || r.provider.ok)));
    } catch (err) {
      say(err instanceof Error ? err.message : 'The test failed.', true);
    }
  });

  return {
    async reload() {
      try {
        render(await getQuoteSettings());
        say('');
      } catch (err) {
        say(err instanceof Error ? err.message : 'The engine process could not be reached.', true);
      }
    },
  };
}

let dialog: { modal: Modal; panel: ProviderPanel } | null = null;

export async function openProviderDialog(): Promise<void> {
  if (!dialog) {
    const modal = makeModal('Market data providers', { wide: true });
    const host = el('div');
    modal.body.append(host, actions('Close', () => modal.close(), () => modal.close(), [], ''));
    dialog = { modal, panel: mountProviderSettings(host) };
  }
  await dialog.panel.reload();
  dialog.modal.open();
}
