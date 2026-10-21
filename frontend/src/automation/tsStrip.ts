type Tok = { t: 'id' | 'num' | 'str' | 'tpl' | 'p' | 'ws' | 'nl' | 'cm' | 're'; s: string };

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  const lastSig = (): Tok | undefined => {
    for (let k = out.length - 1; k >= 0; k--) if (out[k].t !== 'ws' && out[k].t !== 'nl' && out[k].t !== 'cm') return out[k];
    return undefined;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      out.push({ t: 'nl', s: c });
      i++;
    } else if (/\s/.test(c)) {
      let j = i;
      while (j < n && /[^\S\n]/.test(src[j])) j++;
      out.push({ t: 'ws', s: src.slice(i, j) });
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out.push({ t: 'cm', s: src.slice(i, j) });
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const e = j < 0 ? n : j + 2;
      out.push({ t: 'cm', s: src.slice(i, e) });
      i = e;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out.push({ t: 'str', s: src.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '$' && src[j + 1] === '{') {
          depth++;
          j += 2;
        } else if (src[j] === '}' && depth) {
          depth--;
          j++;
        } else if (src[j] === '`' && !depth) break;
        else j++;
      }
      out.push({ t: 'tpl', s: src.slice(i, j + 1) });
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      out.push({ t: 'id', s: src.slice(i, j) });
      i = j;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out.push({ t: 'num', s: src.slice(i, j) });
      i = j;
    } else if (c === '/') {
      const prev = lastSig();
      const regexOk = !prev || (prev.t === 'p' && !')]}'.includes(prev.s)) || (prev.t === 'id' && KEYWORDS_BEFORE_REGEX.has(prev.s));
      if (regexOk) {
        let j = i + 1;
        let cls = false;
        while (j < n && (src[j] !== '/' || cls) && src[j] !== '\n') {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          j++;
        }
        j++;
        while (j < n && /[a-z]/.test(src[j])) j++;
        out.push({ t: 're', s: src.slice(i, j) });
        i = j;
      } else {
        out.push({ t: 'p', s: c });
        i++;
      }
    } else {
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      const p = ['===', '!==', '...', '>>>', '**=', '<<=', '>>='].includes(three) ? three : ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '**', '<<', '>>'].includes(two) ? two : c;
      out.push({ t: 'p', s: p });
      i += p.length;
    }
  }
  return out;
}

let dropped = new Set<number>();

const sig = (toks: Tok[], i: number, step: 1 | -1): number => {
  let k = i + step;
  while (k >= 0 && k < toks.length && (toks[k].t === 'ws' || toks[k].t === 'nl' || toks[k].t === 'cm' || dropped.has(k))) k += step;
  return k;
};

function matching(toks: Tok[], open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let k = open; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (pairs[t.s]) stack.push(pairs[t.s]);
    else if (t.s === ')' || t.s === ']' || t.s === '}') {
      if (stack.pop() !== t.s) return -1;
      if (!stack.length) return k;
    }
  }
  return -1;
}

function typeEnd(toks: Tok[], from: number, stops: string[]): number {
  let depth = 0;
  let k = from;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'p') {
      if (!depth && stops.includes(t.s)) return k;
      if ('([{'.includes(t.s)) depth++;
      else if (')]}'.includes(t.s)) {
        if (!depth) return k;
        depth--;
      } else if (t.s === '<') depth++;
      else if (t.s === '>') depth = Math.max(0, depth - 1);
      else if (t.s === '>>') depth = Math.max(0, depth - 2);
    } else if (t.t === 'nl' && !depth && stops.includes('\n')) return k;
    k++;
  }
  return k;
}

export function strip(src: string): string {
  const toks = tokenize(src);
  const drop = new Set<number>();
  dropped = drop;
  const dropRange = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (toks[k].t !== 'nl') drop.add(k);
  };
  const isId = (k: number, s?: string) => k >= 0 && k < toks.length && toks[k].t === 'id' && (s === undefined || toks[k].s === s);
  const isP = (k: number, s: string) => k >= 0 && k < toks.length && toks[k].t === 'p' && toks[k].s === s;
  const params = new Set<number>();

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'id' && (t.s === 'interface' || t.s === 'declare') && isId(sig(toks, i, 1)) ) {
      const kw = t.s === 'declare' ? sig(toks, i, 1) : i;
      if (t.s === 'declare' || toks[sig(toks, kw, 1)]?.t === 'id') {
        let k = sig(toks, i, 1);
        while (k < toks.length && !isP(k, '{') && !isP(k, ';')) k++;
        const e = isP(k, '{') ? matching(toks, k) : k;
        if (e > 0) {
          dropRange(i, e + 1);
          i = e;
        }
      }
    } else if (t.t === 'id' && t.s === 'type' && isId(sig(toks, i, 1)) && (isP(sig(toks, sig(toks, i, 1), 1), '=') || isP(sig(toks, sig(toks, i, 1), 1), '<'))) {
      const e = typeEnd(toks, i + 1, [';', '\n']);
      dropRange(i, Math.min(e + (isP(e, ';') ? 1 : 0), toks.length));
      i = e;
    } else if (t.t === 'id' && t.s === 'function') {
      let k = sig(toks, i, 1);
      if (isP(k, '*')) k = sig(toks, k, 1);
      const g = isId(k) ? sig(toks, k, 1) : k;
      if (isP(g, '<')) {
        const e = matching2(toks, g);
        if (e > 0) dropRange(g, e + 1);
      }
    } else if (t.t === 'id' && t.s === 'export' && (isId(sig(toks, i, 1), 'function') || isId(sig(toks, i, 1), 'async') || isId(sig(toks, i, 1), 'const') || isId(sig(toks, i, 1), 'let'))) {
      drop.add(i);
    } else if (t.t === 'p' && t.s === '(') {
      const close = matching(toks, i);
      if (close < 0) continue;
      const prev = sig(toks, i, -1);
      const after = sig(toks, close, 1);
      const fnHead = isId(prev, 'function') || (isId(prev) && isId(sig(toks, prev, -1), 'function')) || (isP(prev, '*') && isId(sig(toks, prev, -1), 'function'));
      const arrow = isP(after, '=>') || (isP(after, ':') && toks.slice(close, close + 60).some((x) => x.t === 'p' && x.s === '=>') && arrowAfterType(toks, after));
      const method = isId(prev) && !['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'in', 'of', 'new', 'else'].includes(toks[prev].s) && isP(after, '{') && !isId(sig(toks, prev, -1), 'function') && declHead(toks, prev);
      if (fnHead || arrow || method) {
        params.add(i);
        if (isP(after, ':')) {
          const stops = arrow ? ['=>'] : ['{', ';'];
          const e = typeEnd(toks, after + 1, stops);
          dropRange(after, e);
        }
      }
    }
  }

  const inParams: boolean[] = new Array(toks.length).fill(false);
  for (const o of params) {
    const c = matching(toks, o);
    for (let k = o + 1; k < c; k++) inParams[k] = true;
  }

  for (let i = 0; i < toks.length; i++) {
    if (drop.has(i)) continue;
    const t = toks[i];
    if (t.t === 'p' && t.s === ':' && inParams[i]) {
      const before = sig(toks, i, -1);
      const depthOk = paramDepth(toks, i, params) ;
      if (depthOk && (toks[before]?.t === 'id' || isP(before, '?') || isP(before, ']') || isP(before, '}'))) {
        const e = typeEnd(toks, i + 1, [',', '=', ')']);
        dropRange(i, e);
        if (isP(before, '?')) drop.add(before);
        i = e - 1;
      }
    } else if (t.t === 'p' && t.s === '?' && inParams[i] && isP(sig(toks, i, 1), ':') && paramDepth(toks, i, params)) {
      drop.add(i);
    } else if (t.t === 'id' && (t.s === 'let' || t.s === 'const' || t.s === 'var')) {
      let k = sig(toks, i, 1);
      while (k < toks.length) {
        if (isP(k, '[') || isP(k, '{')) k = matching(toks, k);
        else k = k + 0;
        const nx = sig(toks, k, 1);
        if (isP(nx, '!') && isP(sig(toks, nx, 1), ':')) {
          drop.add(nx);
          k = nx;
        }
        const colon = sig(toks, k, 1);
        if (isP(colon, ':')) {
          const e = typeEnd(toks, colon + 1, ['=', ',', ';', '\n']);
          dropRange(colon, e);
          k = e;
        }
        const comma = findComma(toks, k);
        if (comma < 0) break;
        k = sig(toks, comma, 1);
      }
    } else if (t.t === 'id' && t.s === 'as' && sig(toks, i, -1) >= 0 && !isP(sig(toks, i, -1), '.')) {
      const prev = toks[sig(toks, i, -1)];
      if (prev && (prev.t !== 'p' || ')]}!'.includes(prev.s)) && !isP(sig(toks, i, 1), ':')) {
        const e = typeEnd(toks, i + 1, [',', ';', ')', ']', '}', '=', '?', ':', '&&', '||', '\n', '+', '-', '*', '===', '!==', '==', '!=', '<=', '>=']);
        dropRange(i, e);
        i = e - 1;
      }
    } else if (t.t === 'p' && t.s === '!' ) {
      const prev = toks[sig(toks, i, -1)];
      const next = toks[sig(toks, i, 1)];
      if (prev && (prev.t === 'id' || (prev.t === 'p' && (prev.s === ')' || prev.s === ']'))) && next && next.t === 'p' && ['.', ')', ',', ';', ']', '?.'].includes(next.s) && !(prev.t === 'id' && KEYWORDS_BEFORE_REGEX.has(prev.s))) drop.add(i);
    } else if (t.t === 'p' && t.s === '<' && callGenerics(toks, i)) {
      const e = matching2(toks, i);
      dropRange(i, e + 1);
      i = e;
    }
  }
  return toks.filter((_, k) => !drop.has(k)).map((x) => x.s).join('');
}

function arrowAfterType(toks: Tok[], colon: number): boolean {
  const e = typeEnd(toks, colon + 1, ['=>', '{', ';', ',', '\n']);
  return toks[e]?.s === '=>';
}

function declHead(toks: Tok[], id: number): boolean {
  const before = sig(toks, id, -1);
  return before < 0 || toks[before].s === '}' || toks[before].s === '{' || toks[before].s === ';' || ['async', 'static', 'public', 'private', 'get', 'set'].includes(toks[before].s);
}

function paramDepth(toks: Tok[], i: number, params: Set<number>): boolean {
  let depth = 0;
  for (let k = i - 1; k >= 0; k--) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (')]}'.includes(t.s)) depth++;
    else if ('([{'.includes(t.s)) {
      if (!depth) return params.has(k);
      depth--;
    }
  }
  return false;
}

function findComma(toks: Tok[], from: number): number {
  let depth = 0;
  for (let k = from; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p') {
      if ('([{'.includes(t.s)) depth++;
      else if (')]}'.includes(t.s)) {
        if (!depth) return -1;
        depth--;
      } else if (t.s === ',' && !depth) return k;
      else if (t.s === ';' && !depth) return -1;
    } else if (t.t === 'nl' && !depth) {
      const nx = sig(toks, k, 1);
      if (!isCont(toks, sig(toks, k, -1), nx)) return -1;
    }
  }
  return -1;
}

function isCont(toks: Tok[], prev: number, next: number): boolean {
  return toks[prev]?.s === '=' || toks[prev]?.s === ',' || toks[next]?.s === '.' || ['+', '-', '*', '/', '&&', '||', '?', ':', '=>'].includes(toks[next]?.s ?? '') || ['+', '-', '*', '/', '&&', '||', '?', ':', '=>', '(', '[', '{'].includes(toks[prev]?.s ?? '');
}

function callGenerics(toks: Tok[], i: number): boolean {
  const prev = toks[sig(toks, i, -1)];
  if (!prev || prev.t !== 'id' || KEYWORDS_BEFORE_REGEX.has(prev.s) && prev.s !== 'new') return false;
  const e = matching2(toks, i);
  if (e < 0) return false;
  const after = toks[sig(toks, e, 1)];
  if (!after || after.s !== '(') return false;
  for (let k = i + 1; k < e; k++) {
    const t = toks[k];
    if (t.t === 'num' || t.t === 'str' && false) return false;
    if (t.t === 'p' && !['<', '>', '[', ']', ',', '|', '&', '.', '{', '}', ':', ';', '(', ')', '=>', '?'].includes(t.s)) return false;
  }
  return true;
}

function matching2(toks: Tok[], open: number): number {
  let depth = 0;
  for (let k = open; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (t.s === '<') depth++;
    else if (t.s === '>') {
      depth--;
      if (!depth) return k;
    } else if (t.s === '>>') {
      depth -= 2;
      if (depth <= 0) return k;
    } else if (t.s === ';' || t.s === '{' && false) return -1;
  }
  return -1;
}
