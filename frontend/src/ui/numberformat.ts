import { actions, el, field, makeModal, type Modal } from './modal';

export interface NumFmtCtx {
  current(): Promise<{ code: string; sample: string }>;
  preview(code: string, sample: string): Promise<string>;
  specials(): Promise<[string, string][]>;
  apply(code: string): Promise<void>;
  locale(): string;
}

const CATEGORIES = ['General', 'Number', 'Currency', 'Accounting', 'Date', 'Time', 'Percentage', 'Fraction', 'Scientific', 'Text', 'Special', 'Custom'] as const;
type Category = (typeof CATEGORIES)[number];

const SYMBOLS: [string, string][] = [['$', 'US dollar $'], ['\u20ac', 'Euro \u20ac'], ['\u00a3', 'Pound \u00a3'], ['\u00a5', 'Yen \u00a5'], ['', 'None']];
const LOCALE_SYMBOL: Record<string, string> = { 'en-US': '$', 'en-GB': '\u00a3', 'de-DE': '\u20ac', 'fr-FR': '\u20ac', 'ja-JP': '\u00a5', 'es-ES': '\u20ac', 'it-IT': '\u20ac', 'pt-BR': 'R$', 'nl-NL': '\u20ac', 'sv-SE': 'kr', 'pl-PL': 'z\u0142', 'ru-RU': '\u20bd', 'zh-CN': '\u00a5', 'ko-KR': '\u20a9' };
const LOCALE_DATE: Record<string, string> = { 'en-US': 'm/d/yyyy', 'en-GB': 'dd/mm/yyyy', 'de-DE': 'dd.mm.yyyy', 'fr-FR': 'dd/mm/yyyy', 'ja-JP': 'yyyy/mm/dd', 'es-ES': 'dd/mm/yyyy', 'it-IT': 'dd/mm/yyyy', 'pt-BR': 'dd/mm/yyyy', 'nl-NL': 'dd-mm-yyyy', 'sv-SE': 'yyyy-mm-dd', 'pl-PL': 'dd.mm.yyyy', 'ru-RU': 'dd.mm.yyyy', 'zh-CN': 'yyyy/mm/dd', 'ko-KR': 'yyyy-mm-dd' };
const NEGATIVES = ['-1234.10', '-1234.10 in red', '(1234.10)', '(1234.10) in red'];
const DATES = ['m/d/yyyy', 'dd/mm/yyyy', 'dd.mm.yyyy', 'yyyy/mm/dd', 'yyyy-mm-dd', 'd-mmm-yy', 'd mmmm yyyy', 'mmmm d, yyyy', 'dddd, mmmm d, yyyy', 'dddd, d mmmm yyyy', 'mmm-yy', 'mmmm yyyy', 'm/d', 'd/m', 'yyyy'];
const TIMES = ['h:mm AM/PM', 'h:mm:ss AM/PM', 'h:mm', 'h:mm:ss', '[h]:mm:ss', 'mm:ss.0', 'm/d/yyyy h:mm', 'yyyy-mm-dd hh:mm:ss'];
const FRACTIONS: [string, string][] = [['# ?/?', 'Up to one digit (1/4)'], ['# ??/??', 'Up to two digits (21/35)'], ['# ???/???', 'Up to three digits (312/943)'], ['# ?/2', 'As halves (1/2)'], ['# ?/4', 'As quarters (2/4)'], ['# ?/8', 'As eighths (4/8)'], ['# ??/16', 'As sixteenths (8/16)'], ['# ?/10', 'As tenths (5/10)'], ['# ??/100', 'As hundredths (50/100)']];
const SAVED_KEY = 'fc-custom-codes';

function saved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}

function keep(list: string[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    return;
  }
}

function decimalsOf(code: string): number {
  const m = /\.(0+)/.exec(code);
  return m ? m[1].length : 0;
}

function detect(code: string): Category {
  if (!code) return 'General';
  if (code === '@') return 'Text';
  if (/E[+-]0/i.test(code)) return 'Scientific';
  if (/\?\/[?\d]/.test(code)) return 'Fraction';
  if (/^[0#,.]*%$/.test(code)) return 'Percentage';
  if (code.startsWith('_(')) return 'Accounting';
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  if (/[yd]/i.test(bare)) return 'Date';
  if (/[hs]/i.test(bare) || /\[h\]/i.test(code)) return 'Time';
  if (/^(\[\$[^\]]*\]|"[^"\w]{1,3}"|[$€£¥])/.test(code)) return 'Currency';
  if (/^(#,##0|0)(\.0+)?(_\);\(#,##0(\.0+)?\)|;\[Red\]-?\(?(#,##0|0)(\.0+)?\)?)?$/.test(code)) return 'Number';
  return 'Custom';
}

export class NumberFormatDialog {
  private readonly modal: Modal;
  private readonly category: HTMLSelectElement;
  private readonly panel: HTMLElement;
  private readonly sampleBox: HTMLElement;
  private readonly note: HTMLElement;
  private readonly codeBox: HTMLInputElement;
  private readonly typeList: HTMLSelectElement;
  private readonly decimals: HTMLInputElement;
  private readonly thousands: HTMLInputElement;
  private readonly symbol: HTMLSelectElement;
  private readonly negative: HTMLSelectElement;
  private readonly groups = new Map<string, HTMLElement>();
  private sample = '1234.5678';
  private specials: [string, string][] = [];
  private seq = 0;

  constructor(private readonly ctx: NumFmtCtx) {
    const m = (this.modal = makeModal('Format Cells: Number', { wide: true }));
    this.category = el('select', 'fc-fmt-input');
    this.category.size = 12;
    this.category.setAttribute('aria-label', 'Category');
    for (const c of CATEGORIES) this.category.add(new Option(c, c));
    this.sampleBox = el('output', 'fc-fmt-hint');
    this.sampleBox.setAttribute('aria-live', 'polite');
    this.note = el('p', 'fc-fmt-hint');
    this.codeBox = el('input', 'fc-fmt-input');
    this.codeBox.spellcheck = false;
    this.codeBox.autocomplete = 'off';
    this.typeList = el('select', 'fc-fmt-input');
    this.typeList.size = 8;
    this.typeList.setAttribute('aria-label', 'Type');
    this.decimals = el('input', 'fc-fmt-input');
    this.decimals.type = 'number';
    this.decimals.min = '0';
    this.decimals.max = '30';
    this.thousands = el('input');
    this.thousands.type = 'checkbox';
    this.symbol = el('select', 'fc-fmt-input');
    for (const [v, t] of SYMBOLS) this.symbol.add(new Option(t, v));
    this.negative = el('select', 'fc-fmt-input');
    NEGATIVES.forEach((t, i) => this.negative.add(new Option(t, String(i))));
    const thousandsLabel = el('label', 'fc-sort-check');
    thousandsLabel.append(this.thousands, ' Use 1000 separator (,)');
    this.groups.set('decimals', field('Decimal places', this.decimals));
    this.groups.set('thousands', thousandsLabel);
    this.groups.set('symbol', field('Symbol', this.symbol));
    this.groups.set('negative', field('Negative numbers', this.negative));
    this.groups.set('type', field('Type', this.typeList));
    this.groups.set('code', field('Type the number format code', this.codeBox));
    this.panel = el('div', 'fc-page-group');
    this.panel.append(this.sampleBox, ...this.groups.values(), this.note);
    const row = el('div', 'fc-page-row');
    row.append(field('Category', this.category), this.panel);
    const forget = el('button', 'fc-btn fc-btn-ghost', 'Delete custom code');
    forget.type = 'button';
    forget.addEventListener('click', () => {
      keep(saved().filter((c) => c !== this.typeList.value));
      this.fill();
    });
    this.groups.set('forget', forget);
    this.panel.insertBefore(forget, this.note);
    m.body.append(row, actions('OK', () => void this.submit(), () => m.close()));
    this.category.addEventListener('change', () => this.pick(this.category.value as Category, true));
    for (const n of [this.decimals, this.thousands, this.symbol, this.negative]) n.addEventListener('input', () => this.build());
    this.typeList.addEventListener('change', () => {
      this.codeBox.value = this.typeList.value;
      this.refresh();
    });
    this.codeBox.addEventListener('input', () => this.refresh());
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
        e.preventDefault();
        void this.submit();
      }
    });
  }

  async open(): Promise<void> {
    const now = await this.ctx.current();
    this.specials = await this.ctx.specials().catch(() => []);
    this.sample = now.sample;
    const cat = detect(now.code);
    this.codeBox.value = now.code;
    this.decimals.value = String(['Percentage', 'Scientific', 'Number', 'Currency', 'Accounting'].includes(cat) ? decimalsOf(now.code) : 2);
    this.thousands.checked = /#,##0/.test(now.code) || cat === 'General';
    const used = [...this.symbol.options].find((o) => o.value && now.code.includes(o.value));
    this.symbol.value = used ? used.value : LOCALE_SYMBOL[this.ctx.locale()] ?? '$';
    this.negative.value = /\[Red\]/.test(now.code) ? (/\(/.test(now.code) ? '3' : '1') : /\(/.test(now.code) ? '2' : '0';
    this.category.value = cat;
    this.pick(cat, false);
    this.modal.open(this.category);
  }

  private show(...keys: string[]): void {
    for (const [k, node] of this.groups) node.hidden = !keys.includes(k);
  }

  private pick(cat: Category, rebuild: boolean): void {
    this.note.textContent = '';
    const loc = this.ctx.locale();
    switch (cat) {
      case 'General':
        this.show();
        this.note.textContent = 'General cells have no specific number format.';
        break;
      case 'Number':
        this.show('decimals', 'thousands', 'negative');
        break;
      case 'Currency':
        this.show('decimals', 'symbol', 'negative');
        if (rebuild) this.symbol.value = LOCALE_SYMBOL[loc] ?? '$';
        break;
      case 'Accounting':
        this.show('decimals', 'symbol');
        break;
      case 'Percentage':
      case 'Scientific':
        this.show('decimals');
        break;
      case 'Text':
        this.show();
        this.note.textContent = 'Text cells are shown exactly as entered, even when a number is typed.';
        break;
      default:
        this.show('type', ...(cat === 'Custom' ? ['code', 'forget'] : []));
        break;
    }
    if (cat === 'Date' || cat === 'Time' || cat === 'Fraction' || cat === 'Special' || cat === 'Custom') this.fill();
    if (rebuild) this.build();
    else this.refresh();
  }

  private fill(): void {
    const cat = this.category.value as Category;
    let items: [string, string][];
    if (cat === 'Date') items = [LOCALE_DATE[this.ctx.locale()] ?? 'm/d/yyyy', ...DATES].filter((c, i, a) => a.indexOf(c) === i).map((c) => [c, c]);
    else if (cat === 'Time') items = TIMES.map((c) => [c, c]);
    else if (cat === 'Fraction') items = FRACTIONS;
    else if (cat === 'Special') items = this.specials.map(([n, c]) => [c, n]);
    else items = [...saved(), ...DATES, ...TIMES, '0.00', '#,##0', '0%', '0.00E+00', '@', '[<=9999999]###-####;(###) ###-####', '#,##0.00;[Red]-#,##0.00', '0.0,"K"', '0.0,,"M"', '[Green]0;[Red]-0;[Blue]0'].filter((c, i, a) => a.indexOf(c) === i).map((c) => [c, c]);
    const current = this.codeBox.value;
    this.typeList.replaceChildren(...items.map(([v, t]) => new Option(t === v ? t : `${t}  (${v})`, v)));
    this.typeList.value = items.some(([v]) => v === current) ? current : '';
    if (cat !== 'Custom' && !this.typeList.value && items.length) {
      this.typeList.selectedIndex = 0;
    }
    if (cat !== 'Custom') this.codeBox.value = this.typeList.value;
  }

  private build(): void {
    const cat = this.category.value as Category;
    const d = Math.max(0, Math.min(30, Number(this.decimals.value) || 0));
    const dec = d ? `.${'0'.repeat(d)}` : '';
    const body = (this.thousands.checked ? '#,##0' : '0') + dec;
    const sym = this.symbol.value ? (/^[$]$/.test(this.symbol.value) ? this.symbol.value : `"${this.symbol.value}"`) : '';
    const negative = (core: string) => {
      switch (this.negative.value) {
        case '1':
          return `${core};[Red]-${core}`;
        case '2':
          return `${core}_);(${core})`;
        case '3':
          return `${core}_);[Red](${core})`;
        default:
          return core;
      }
    };
    switch (cat) {
      case 'General':
        this.codeBox.value = '';
        break;
      case 'Number':
        this.codeBox.value = negative(body);
        break;
      case 'Currency':
        this.codeBox.value = negative(`${sym}#,##0${dec}`);
        break;
      case 'Accounting': {
        const s = sym || '';
        this.codeBox.value = `_(${s}* #,##0${dec}_);_(${s}* (#,##0${dec});_(${s}* "-"${'?'.repeat(Math.max(2, d))}_);_(@_)`;
        break;
      }
      case 'Percentage':
        this.codeBox.value = `0${dec}%`;
        break;
      case 'Scientific':
        this.codeBox.value = `0${dec}E+00`;
        break;
      case 'Text':
        this.codeBox.value = '@';
        break;
      default:
        if (cat !== 'Custom') this.codeBox.value = this.typeList.value;
    }
    this.refresh();
  }

  private refresh(): void {
    const code = this.codeBox.value;
    const mine = ++this.seq;
    const cat = this.category.value as Category;
    const sample = (cat === 'Date' || cat === 'Time') && Number.isNaN(Number(this.sample)) ? '2026-03-15 14:30:45' : this.sample;
    void this.ctx.preview(code, sample).then(
      (text) => {
        if (mine === this.seq) this.sampleBox.textContent = `Sample: ${text}`;
      },
      (err: unknown) => {
        if (mine === this.seq) this.sampleBox.textContent = err instanceof Error ? err.message : 'That code is not valid.';
      },
    );
  }

  private async submit(): Promise<void> {
    const code = this.codeBox.value;
    try {
      await this.ctx.apply(code);
    } catch (err) {
      this.sampleBox.textContent = err instanceof Error ? err.message : 'That code is not valid.';
      return;
    }
    if (this.category.value === 'Custom' && code && !saved().includes(code)) keep([code, ...saved()]);
    this.modal.close();
  }
}
