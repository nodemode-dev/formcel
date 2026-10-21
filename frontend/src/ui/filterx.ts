import { drawIcon } from '../grid/grid';

export const DATE_FILTERS: [string, string][] = [
  ['dyn:today', 'Today'], ['dyn:yesterday', 'Yesterday'], ['dyn:tomorrow', 'Tomorrow'],
  ['dyn:thisweek', 'This week'], ['dyn:lastweek', 'Last week'], ['dyn:nextweek', 'Next week'],
  ['dyn:thismonth', 'This month'], ['dyn:lastmonth', 'Last month'], ['dyn:nextmonth', 'Next month'],
  ['dyn:thisquarter', 'This quarter'], ['dyn:lastquarter', 'Last quarter'], ['dyn:nextquarter', 'Next quarter'],
  ['dyn:thisyear', 'This year'], ['dyn:lastyear', 'Last year'], ['dyn:nextyear', 'Next year'], ['dyn:yeartodate', 'Year to date'],
  ['dyn:q1', 'Quarter 1'], ['dyn:q2', 'Quarter 2'], ['dyn:q3', 'Quarter 3'], ['dyn:q4', 'Quarter 4'],
  ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i): [string, string] => [`dyn:m${i + 1}`, m]),
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');

function node(key: string, label: string, checked: boolean, kids: string): string {
  const twist = kids ? '<button type="button" class="fc-filter-twist" data-a="twist" aria-expanded="false" aria-label="Expand"></button>' : '<span class="fc-filter-twist-gap"></span>';
  return `<div class="fc-filter-node" data-key="${key}"><div class="fc-filter-row">${twist}<label class="fc-filter-item"><input type="checkbox" data-key="${key}"${checked ? ' checked' : ''}> <span>${label}</span></label></div>${kids ? `<div class="fc-filter-kids" hidden>${kids}</div>` : ''}</div>`;
}

export function dateTree(days: [number, number, number][], keep: Set<string> | null, blanks: boolean, blanksOn: boolean): string {
  const on = (y: number, m?: number, d?: number) => !keep || keep.has(String(y)) || (m !== undefined && keep.has(`${y}-${pad(m)}`)) || (m !== undefined && d !== undefined && keep.has(`${y}-${pad(m)}-${pad(d)}`));
  const years = new Map<number, Map<number, number[]>>();
  for (const [y, m, d] of days) {
    const ms = years.get(y) ?? new Map<number, number[]>();
    ms.set(m, [...(ms.get(m) ?? []), d]);
    years.set(y, ms);
  }
  const out: string[] = [];
  for (const [y, ms] of years) {
    const mh: string[] = [];
    for (const [m, ds] of ms) {
      const dh = ds.map((d) => node(`${y}-${pad(m)}-${pad(d)}`, String(d), on(y, m, d), ''));
      mh.push(node(`${y}-${pad(m)}`, MONTH_NAMES[m - 1] ?? String(m), on(y, m), dh.join('')));
    }
    out.push(node(String(y), String(y), on(y), mh.join('')));
  }
  if (blanks) out.push(`<label class="fc-filter-item"><input type="checkbox" data-blank="1"${blanksOn ? ' checked' : ''}> <span>(Blanks)</span></label>`);
  return out.join('');
}

export function cascadeDates(target: HTMLInputElement): void {
  const own = target.closest<HTMLElement>('.fc-filter-node');
  if (!own) return;
  for (const box of own.querySelectorAll<HTMLInputElement>('.fc-filter-kids input[data-key]')) {
    box.checked = target.checked;
    box.indeterminate = false;
  }
  target.indeterminate = false;
  let up = own.parentElement?.closest<HTMLElement>('.fc-filter-node') ?? null;
  while (up) {
    const kids = [...up.querySelectorAll<HTMLInputElement>(':scope > .fc-filter-kids > .fc-filter-node > .fc-filter-row input[data-key]')];
    const box = up.querySelector<HTMLInputElement>(':scope > .fc-filter-row input[data-key]')!;
    const all = kids.every((k) => k.checked && !k.indeterminate);
    box.checked = all;
    box.indeterminate = !all && kids.some((k) => k.checked || k.indeterminate);
    up = up.parentElement?.closest<HTMLElement>('.fc-filter-node') ?? null;
  }
}

export function collectDates(list: HTMLElement): { keys: string[]; blanks: boolean; all: boolean } {
  const keys: string[] = [];
  let all = true;
  const walk = (parent: Element) => {
    for (const n of parent.querySelectorAll<HTMLElement>(':scope > .fc-filter-node')) {
      const box = n.querySelector<HTMLInputElement>(':scope > .fc-filter-row input[data-key]')!;
      if (box.checked && !box.indeterminate) keys.push(n.dataset.key!);
      else {
        all = false;
        const kids = n.querySelector(':scope > .fc-filter-kids');
        if (kids && (box.indeterminate || box.checked)) walk(kids);
      }
    }
  };
  walk(list);
  const blank = list.querySelector<HTMLInputElement>('input[data-blank]');
  const blanks = !!blank?.checked;
  if (blank && !blank.checked) all = false;
  return { keys, blanks, all };
}

export function iconSwatch(id: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fc-filter-swatch';
  b.dataset.a = 'icon';
  b.dataset.v = id;
  b.title = label;
  b.setAttribute('aria-label', label);
  const c = document.createElement('canvas');
  c.width = 36;
  c.height = 36;
  c.style.width = c.style.height = '18px';
  const ctx = c.getContext('2d');
  if (ctx && id !== 'none') {
    ctx.scale(2, 2);
    const cut = id.lastIndexOf(':');
    drawIcon(ctx, id.slice(0, cut), Number(id.slice(cut + 1)), 3, 9);
    b.appendChild(c);
  } else {
    b.textContent = '-';
  }
  return b;
}
