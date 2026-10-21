const NUM = /^-?(\d+\.?\d*|\.\d+)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TAIL = /^(.*?)(\d+)$/;
const LISTS = [
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ['Q1', 'Q2', 'Q3', 'Q4'],
];

function step(nums: number[]): number {
  return nums.length < 2 ? 1 : (nums[nums.length - 1] - nums[0]) / (nums.length - 1);
}

function fmt(n: number): string {
  const r = Math.round(n * 1e10) / 1e10;
  return String(r);
}

function days(s: string): number {
  const m = DATE.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
  const u = US_DATE.exec(s)!;
  return Date.UTC(Number(u[3]), Number(u[1]) - 1, Number(u[2])) / 86400000;
}

function iso(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10);
}

function us(d: number): string {
  const t = new Date(d * 86400000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${t.getUTCFullYear()}`;
}

function caseLike(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like === like.toLowerCase()) return word.toLowerCase();
  return word;
}

export function fillSeries(src: string[], n: number): string[] {
  const out: string[] = [];
  const vals = src.filter((v) => v !== '');
  if (!vals.length || vals.length !== src.length) {
    for (let i = 0; i < n; i++) out.push(src[i % src.length] ?? '');
    return out;
  }
  if (vals.every((v) => NUM.test(v))) {
    if (vals.length === 1) return Array(n).fill(vals[0]);
    const nums = vals.map(Number);
    const d = step(nums);
    for (let i = 1; i <= n; i++) out.push(fmt(nums[nums.length - 1] + d * i));
    return out;
  }
  if (vals.every((v) => DATE.test(v)) || vals.every((v) => US_DATE.test(v))) {
    const ds = vals.map(days);
    const d = vals.length === 1 ? 1 : Math.round(step(ds));
    const show = DATE.test(vals[0]) ? iso : us;
    for (let i = 1; i <= n; i++) out.push(show(ds[ds.length - 1] + d * i));
    return out;
  }
  for (const list of LISTS) {
    const lower = list.map((w) => w.toLowerCase());
    const idx = vals.map((v) => lower.indexOf(v.toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const d = idx.length === 1 ? 1 : Math.round(step(idx));
      const last = idx[idx.length - 1];
      const len = list.length;
      for (let i = 1; i <= n; i++) out.push(caseLike(list[(((last + d * i) % len) + len) % len], vals[vals.length - 1]));
      return out;
    }
  }
  const tails = vals.map((v) => TAIL.exec(v));
  if (tails.every((m) => m) && tails.every((m) => m![1] === tails[0]![1])) {
    const nums = tails.map((m) => Number(m![2]));
    const d = Math.round(step(nums)) || 1;
    const width = tails[tails.length - 1]![2].length;
    const pad = tails[tails.length - 1]![2].startsWith('0');
    for (let i = 1; i <= n; i++) {
      const k = nums[nums.length - 1] + d * i;
      out.push(`${tails[0]![1]}${pad ? String(Math.max(0, k)).padStart(width, '0') : k}`);
    }
    return out;
  }
  for (let i = 0; i < n; i++) out.push(src[i % src.length]);
  return out;
}
