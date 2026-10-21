import type { Arrow, EvalStep, Cell, CfCell, Changed, Effect, FilterList, FormatChange, LinkChange, Request, Response, Shift, StyleChange, Value } from './protocol';

interface Exports {
  memory: WebAssembly.Memory;
  fc_out_ptr(): number;
  fc_alloc(len: number): number;
  fc_free(ptr: number, len: number): void;
  fc_version(): number;
  fc_workbook_new(): number;
  fc_set(book: number, sheet: number, a1: number, a1Len: number, raw: number, rawLen: number): number;
  fc_get(book: number, sheet: number, a1: number, a1Len: number): number;
  fc_apply(book: number, sheet: number, edits: number, len: number): number;
  fc_load(book: number, sheet: number, edits: number, len: number): number;
  fc_add_sheet(book: number, name: number, len: number): number;
  fc_sheet_names(book: number): number;
  fc_shift(book: number, sheet: number, rows: number, at: number, n: number, insert: number): number;
  fc_delete_sheet(book: number, sheet: number): number;
  fc_move_sheet(book: number, from: number, to: number): number;
  fc_rename_sheet(book: number, sheet: number, name: number, len: number): number;
  fc_define_name(book: number, name: number, nameLen: number, refers: number, refersLen: number): number;
  fc_names(book: number): number;
  fc_set_format(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, code: number, len: number): number;
  fc_format_at(book: number, sheet: number, row: number, col: number): number;
  fc_load_formats(book: number, sheet: number, lines: number, len: number): number;
  fc_set_styles(book: number, sheet: number, ops: number, len: number): number;
  fc_styles_in(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_style_at(book: number, sheet: number, row: number, col: number): number;
  fc_load_styles(book: number, sheet: number, lines: number, len: number): number;
  fc_merge(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, mode: number): number;
  fc_merges(book: number, sheet: number): number;
  fc_sort(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, keys: number, len: number, header: number, caseSensitive: number): number;
  fc_region(book: number, sheet: number, row: number, col: number): number;
  fc_sort_lists(): number;
  fc_sort_choices(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, header: number, across: number, key: number): number;
  fc_guess_header(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_load_merges(book: number, sheet: number, lines: number, len: number): number;
  fc_put_formats(book: number, sheet: number, lines: number, len: number): number;
  fc_theme(book: number): number;
  fc_set_theme(book: number, t: number, len: number): number;
  fc_load_theme(book: number, t: number, len: number): number;
  fc_named(book: number): number;
  fc_load_named(book: number, lines: number, len: number): number;
  fc_define_style(book: number, sheet: number, row: number, col: number, name: number, nameLen: number, parts: number, partsLen: number): number;
  fc_delete_style(book: number, name: number, len: number): number;
  fc_apply_style(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, name: number, len: number): number;
  fc_values_in(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_rules(book: number, sheet: number): number;
  fc_set_rules(book: number, sheet: number, lines: number, len: number): number;
  fc_load_rules(book: number, sheet: number, lines: number, len: number): number;
  fc_tables(book: number): number;
  fc_load_tables(book: number, lines: number, len: number): number;
  fc_create_table(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, header: number): number;
  fc_set_table(book: number, name: number, nameLen: number, t: number, len: number): number;
  fc_remove_table(book: number, name: number, len: number): number;
  fc_pivot_error(): number;
  fc_pivots(book: number): number;
  fc_load_pivots(book: number, lines: number, len: number): number;
  fc_pivot_source(book: number, sheet: number, src: number, len: number): number;
  fc_pivot_fields(book: number, name: number, len: number): number;
  fc_pivot_items(book: number, name: number, nameLen: number, field: number, fieldLen: number): number;
  fc_pivot_suggest(book: number, sheet: number, src: number, len: number): number;
  fc_create_pivot(book: number, line: number, len: number): number;
  fc_set_pivot(book: number, name: number, nameLen: number, line: number, len: number): number;
  fc_refresh_pivot(book: number, name: number, len: number): number;
  fc_remove_pivot(book: number, name: number, len: number): number;
  fc_whatif(book: number, cmd: number, len: number): number;
  fc_load_whatif(book: number, lines: number, len: number): number;
  fc_validations(book: number, sheet: number): number;
  fc_load_validations(book: number, sheet: number, lines: number, len: number): number;
  fc_set_validation(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, t: number, len: number): number;
  fc_validation_at(book: number, sheet: number, row: number, col: number): number;
  fc_list_items(book: number, sheet: number, row: number, col: number): number;
  fc_invalid_in(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_check_input(book: number, sheet: number, row: number, col: number, raw: number, len: number): number;
  fc_filter(book: number, sheet: number): number;
  fc_set_filter(book: number, sheet: number, t: number, len: number): number;
  fc_load_filter(book: number, sheet: number, t: number, len: number): number;
  fc_reapply_filter(book: number, sheet: number): number;
  fc_set_hidden_rows(book: number, sheet: number, t: number, len: number): number;
  fc_tool(book: number, sheet: number, cmd: number, len: number): number;
  fc_filter_values(book: number, sheet: number, col: number): number;
  fc_cf_in(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_link_at(book: number, sheet: number, row: number, col: number): number;
  fc_set_link(book: number, sheet: number, row: number, col: number, t: number, tl: number, d: number, dl: number, has: number): number;
  fc_remove_links(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_take_links(book: number): number;
  fc_load_links(book: number, sheet: number, lines: number, len: number): number;
  fc_undo_mark(book: number): number;
  fc_undo_group(book: number, mark: number): number;
  fc_formats_in(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_undo(book: number): number;
  fc_redo(book: number): number;
  fc_history(book: number): number;
  fc_read(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_extent(book: number, sheet: number): number;
  fc_edge(book: number, sheet: number, row: number, col: number, dir: number): number;
  fc_offset(src: number, len: number, dr: number, dc: number): number;
  fc_trace(book: number, sheet: number, row: number, col: number, dependents: number, levels: number): number;
  fc_eval_steps(book: number, sheet: number, row: number, col: number): number;
  fc_set_clock(serial: number): void;
  fc_set_locale(t: number, len: number): number;
  fc_host_keys(book: number, all: number): number;
  fc_host_set(book: number, key: number, keyLen: number, data: number, dataLen: number, has: number): number;
  fc_host_custom(book: number, names: number, len: number): number;
  fc_host_clear(book: number): number;
  fc_protect_text(book: number, sheet: number): number;
  fc_protect_load(book: number, sheet: number, lines: number, len: number): number;
  fc_protect_sheet(book: number, sheet: number, on: number, pw: number, pwLen: number, allow: number, allowLen: number): number;
  fc_protect_book(book: number, on: number, pw: number, len: number): number;
  fc_mark_final(book: number, on: number): number;
  fc_set_flags(book: number, sheet: number, r0: number, c0: number, r1: number, c1: number, unlocked: number, hidden: number): number;
  fc_cell_flags(book: number, sheet: number, row: number, col: number): number;
  fc_edit_ranges(book: number, sheet: number, lines: number, len: number): number;
  fc_set_user(book: number, name: number, len: number): number;
  fc_guard(book: number, sheet: number, op: number, len: number, r0: number, c0: number, r1: number, c1: number): number;
  fc_hides_formula(book: number, sheet: number, row: number, col: number): number;
  fc_is_final(book: number): number;
  fc_bypass(book: number, on: number): number;
  fc_last_refusal(book: number): number;
}

const NO_SHEET = 4294967295;

function protect(x: Exports, req: Extract<Request, { op: 'prot' }>): Value {
  const s = req.sheet < 0 ? NO_SHEET : req.sheet;
  const [r0, c0, r1, c1] = [req.r0 ?? 0, req.c0 ?? 0, req.r1 ?? 0, req.c1 ?? 0];
  const verdict = (n: number): string => {
    const m = out(x, n);
    if (m) throw new Error(m);
    return '';
  };
  switch (req.kind) {
    case 'text':
      return out(x, x.fc_protect_text(req.book, s)).split('\n').filter(Boolean);
    case 'load':
      return withStrings(x, [req.a ?? ''], ([p, l]) => ok(x.fc_protect_load(req.book, s, p, l), 'The engine refused that protection.'));
    case 'sheet':
      return withStrings(x, [req.b ?? '', req.a ?? ''], ([p, l, q, m]) => verdict(x.fc_protect_sheet(req.book, s, req.on ? 1 : 0, p, l, q, m)));
    case 'book':
      return withStrings(x, [req.b ?? ''], ([p, l]) => verdict(x.fc_protect_book(req.book, req.on ? 1 : 0, p, l)));
    case 'final':
      return verdict(x.fc_mark_final(req.book, req.on ? 1 : 0));
    case 'flags':
      return verdict(x.fc_set_flags(req.book, s, r0, c0, r1, c1, Number(req.a ?? 2), Number(req.b ?? 2)));
    case 'flagsAt':
      return x.fc_cell_flags(req.book, s, r0, c0);
    case 'ranges':
      return withStrings(x, [req.a ?? ''], ([p, l]) => verdict(x.fc_edit_ranges(req.book, s, p, l)));
    case 'user':
      return withStrings(x, [req.a ?? ''], ([p, l]) => x.fc_set_user(req.book, p, l));
    case 'guard':
      return withStrings(x, [req.a ?? ''], ([p, l]) => out(x, x.fc_guard(req.book, s, p, l, r0, c0, r1, c1)));
    case 'hides':
      return x.fc_hides_formula(req.book, s, r0, c0);
    case 'isFinal':
      return x.fc_is_final(req.book);
  }
}

function guardOf(req: Request): [string, number, number, number, number, number] | null {
  switch (req.op) {
    case 'shift':
      return [`${req.insert ? 'insert' : 'delete'}_${req.rows ? 'rows' : 'cols'}`, req.sheet, req.rows ? req.at : 0, req.rows ? 0 : req.at, req.rows ? req.at + req.n - 1 : 0, req.rows ? 0 : req.at + req.n - 1];
    case 'sheet.add':
      return ['structure', 0, 0, 0, 0, 0];
    case 'sheet.delete':
    case 'sheet.move':
    case 'sheet.rename':
      return ['structure', req.sheet, 0, 0, 0, 0];
    case 'format.set':
    case 'style.apply':
      return ['format', req.sheet, req.r0, req.c0, req.r1, req.c1];
    case 'style.set':
      return req.ops.length ? ['format', req.sheet, Math.min(...req.ops.map((o) => o[0])), Math.min(...req.ops.map((o) => o[1])), Math.max(...req.ops.map((o) => o[2])), Math.max(...req.ops.map((o) => o[3]))] : null;
    case 'merge.set':
      return ['merge', req.sheet, req.r0, req.c0, req.r1, req.c1];
    case 'sort':
      return ['sort', req.sheet, req.r0, req.c0, req.r1, req.c1];
    case 'filter.set':
      return ['filter', req.sheet, 0, 0, 0, 0];
    case 'table.create':
      return ['edit', req.sheet, req.r0, req.c0, req.r1, req.c1];
    case 'undo':
    case 'redo':
      return ['any', 0, 0, 0, 0, 0];
    default:
      return null;
  }
}

function localSerial(): number {
  const now = Date.now();
  return (now - new Date(now).getTimezoneOffset() * 60000) / 86400000 + 25569;
}

const DIRS = { up: 0, down: 1, left: 2, right: 3 } as const;

function escape(s: string): string {
  return s.replace(/[\\\t\n\r]/g, (c) => (c === '\\' ? '\\\\' : c === '\t' ? '\\t' : c === '\n' ? '\\n' : '\\r'));
}

function unescape(s: string): string {
  return s.indexOf('\\') < 0 ? s : s.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

function lines(s: string): string[][] {
  return s ? s.split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
}

function colorOf(fl: string): string | undefined {
  const i = fl.indexOf('c');
  return i < 0 ? undefined : `#${fl.slice(i + 1, i + 7)}`;
}

function cells(s: string): Cell[] {
  return lines(s).map(([r, c, fl, t, f]) => [Number(r), Number(c), unescape(t ?? ''), f === undefined ? undefined : unescape(f), fl.startsWith('n'), colorOf(fl), fl.includes('l')]);
}

function changed(s: string): Changed[] {
  return lines(s).filter((l) => !'%#&=^@!~?*'.includes(l[0])).map(([sh, r, c, fl, t, f]) => [Number(sh), Number(r), Number(c), unescape(t ?? ''), f === undefined ? undefined : unescape(f), fl.startsWith('n'), colorOf(fl), fl.includes('l')]);
}

function formatsOf(s: string, tag = '%'): FormatChange[] {
  return lines(s).filter((l) => l[0] === tag).map(([, sh, r, c, code]) => [Number(sh), Number(r), Number(c), unescape(code ?? '')]);
}

function shiftOf(line: string): Shift {
  const [, sheet, axis, at, delta] = line.split('\t');
  return { sheet: Number(sheet), rows: axis === 'r', at: Number(at), delta: Number(delta) };
}

function effect(s: string): Effect {
  const shifts = s.split('\n').filter((l) => l.startsWith('#\t')).map(shiftOf);
  const shift = shifts.length ? shifts[shifts.length - 1] : null;
  const m = /^=\t(\d+)$/m.exec(s);
  const rl = /^!\t(\d+)$/m.exec(s);
  const fl = /^~\t(\d+)$/m.exec(s);
  const vl = /^\?\t(\d+)$/m.exec(s);
  const styles = lines(s).filter((l) => l[0] === '&').map(([, sh, r, c, raw, shown]) => [Number(sh), Number(r), Number(c), unescape(raw ?? ''), unescape(shown ?? raw ?? '')] as StyleChange);
  return { shift, more: shifts.slice(0, -1), changes: changed(s).filter((l) => !Number.isNaN(l[0])), formats: formatsOf(s), styles, merges: m ? Number(m[1]) : null, theme: /^\^$/m.test(s), named: /^@$/m.test(s), rules: rl ? Number(rl[1]) : null, filter: fl ? Number(fl[1]) : null, valid: vl ? Number(vl[1]) : null, tables: /^\*$/m.test(s) };
}

const MERGE_MODES = { center: 0, across: 1, cells: 2, unmerge: 3 } as const;

function styled(x: Exports, n: number): string {
  if (n === -3) throw new Error('That cell style or theme is not one FormCel has, or its name is taken by Normal.');
  if (n === -4) throw new Error('That cell has a number format FormCel cannot keep in a style.');
  return out(x, n);
}

function ok(n: number, what: string): number {
  if (n < 0) throw new Error(what);
  return n;
}

function pair(s: string): [number, number] | null {
  if (!s) return null;
  const [r, c] = s.split('\t');
  return [Number(r), Number(c)];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const ready: Promise<Exports> = WebAssembly.instantiateStreaming(fetch('/engine/formcel.wasm'), {}).then(
  (r) => r.instance.exports as unknown as Exports,
);

function out(x: Exports, len: number): string {
  if (len < 0) throw new Error('The engine refused that cell address or sheet.');
  return dec.decode(new Uint8Array(x.memory.buffer, x.fc_out_ptr(), len));
}

function pivotOut(x: Exports, len: number): string {
  if (len === -3) throw new Error(out(x, x.fc_pivot_error()) || 'That PivotTable is not allowed.');
  return out(x, len);
}

function withStrings<T>(x: Exports, parts: string[], fn: (args: number[]) => T): T {
  const held: [number, number][] = [];
  const args: number[] = [];
  for (const s of parts) {
    const bytes = enc.encode(s);
    const len = Math.max(bytes.length, 1);
    const ptr = x.fc_alloc(len);
    new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
    held.push([ptr, len]);
    args.push(ptr, bytes.length);
  }
  try {
    return fn(args);
  } finally {
    for (const [p, l] of held) x.fc_free(p, l);
  }
}

function run(x: Exports, req: Request): Value {
  const g = guardOf(req);
  if (g && 'book' in req) {
    const m = withStrings(x, [g[0]], ([p, l]) => out(x, x.fc_guard(req.book, g[1], p, l, g[2], g[3], g[4], g[5])));
    if (m) throw new Error(m);
  }
  switch (req.op) {
    case 'prot':
      return protect(x, req);
    case 'version':
      return out(x, x.fc_version());
    case 'workbook.new':
      return x.fc_workbook_new();
    case 'cell.set':
      return withStrings(x, [req.a1, req.raw], ([a, al, r, rl]) => out(x, x.fc_set(req.book, req.sheet, a, al, r, rl)));
    case 'cell.get':
      return withStrings(x, [req.a1], ([a, al]) => out(x, x.fc_get(req.book, req.sheet, a, al)));
    case 'apply': {
      const body = req.edits.map(([r, c, raw]) => `${r}\t${c}\t${escape(raw)}`).join('\n');
      if (req.remote) x.fc_bypass(req.book, 1);
      try {
        return withStrings(x, [body], ([p, l]) => {
          const n = x.fc_apply(req.book, req.sheet, p, l);
          if (n === -9) throw new Error(out(x, x.fc_last_refusal(req.book)));
          return changed(out(x, n));
        });
      } finally {
        if (req.remote) x.fc_bypass(req.book, 0);
      }
    }
    case 'load': {
      const body = req.edits.map(([r, c, raw]) => `${r}\t${c}\t${escape(raw)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => {
        const n = x.fc_load(req.book, req.sheet, p, l);
        if (n < 0) throw new Error('The engine refused that workbook data.');
        return n;
      });
    }
    case 'sheet.add':
      return withStrings(x, [req.name], ([p, l]) => x.fc_add_sheet(req.book, p, l));
    case 'sheet.names':
      return out(x, x.fc_sheet_names(req.book)).split('\n').filter(Boolean).map(unescape);
    case 'undo':
    case 'redo': {
      const n = req.op === 'undo' ? x.fc_undo(req.book) : x.fc_redo(req.book);
      return n === -2 ? { changes: [], shift: null, formats: [], styles: [], merges: null, theme: false, named: false, rules: null, filter: null, valid: null, tables: false } : effect(out(x, n));
    }
    case 'shift':
      return shiftOf(out(x, x.fc_shift(req.book, req.sheet, req.rows ? 1 : 0, req.at, req.n, req.insert ? 1 : 0)).trim());
    case 'sheet.delete':
      return ok(x.fc_delete_sheet(req.book, req.sheet), 'A workbook keeps at least one sheet.');
    case 'sheet.move':
      return ok(x.fc_move_sheet(req.book, req.sheet, req.to), 'That sheet cannot move there.');
    case 'sheet.rename':
      return withStrings(x, [req.name], ([p, l]) => ok(x.fc_rename_sheet(req.book, req.sheet, p, l), 'That sheet cannot be renamed.'));
    case 'format.set':
      return withStrings(x, [req.code], ([p, l]) => {
        const n = x.fc_set_format(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, p, l);
        if (n === -3) throw new Error('That is not a number format FormCel can read.');
        return effect(out(x, n));
      });
    case 'format.at':
      return out(x, x.fc_format_at(req.book, req.sheet, req.row, req.col));
    case 'format.load': {
      const body = req.cells.map(([r, c, code]) => `${r}\t${c}\t${escape(code)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => ok(x.fc_load_formats(req.book, req.sheet, p, l), 'The engine refused those formats.'));
    }
    case 'style.set': {
      const body = req.ops.map(([r0, c0, r1, c1, p]) => `${r0}\t${c0}\t${r1}\t${c1}\t${escape(p)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => {
        const n = x.fc_set_styles(req.book, req.sheet, p, l);
        if (n === -3) throw new Error('That is not a cell style FormCel can read.');
        return effect(out(x, n));
      });
    }
    case 'style.read':
      return lines(out(x, x.fc_styles_in(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1))).map(([, r, c, st]) => [Number(r), Number(c), unescape(st ?? '')] as [number, number, string]);
    case 'style.at':
      return out(x, x.fc_style_at(req.book, req.sheet, req.row, req.col));
    case 'style.load': {
      const body = req.cells.map(([r, c, st]) => `${r}\t${c}\t${escape(st)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => ok(x.fc_load_styles(req.book, req.sheet, p, l), 'The engine refused those styles.'));
    }
    case 'merge.set':
      return effect(out(x, x.fc_merge(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, MERGE_MODES[req.mode])));
    case 'sort': {
      const keys = req.keys.map(([c, d, kind, arg]) => `${c}:${d ? 'd' : 'a'}${kind ? `:${kind}:${escape(arg ?? '')}` : ''}`).join('\n');
      return withStrings(x, [keys], ([p, l]) => {
        const n = x.fc_sort(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, p, l, req.header ? 1 : 0, (req.caseSensitive ? 1 : 0) | (req.across ? 2 : 0));
        if (n === -3) throw new Error('Unmerge the cells in the range to sort it.');
        return effect(out(x, n));
      });
    }
    case 'sort.lists':
      return lines(out(x, x.fc_sort_lists()));
    case 'sort.choices': {
      const found = { fills: [] as string[], fonts: [] as string[], icons: [] as string[] };
      for (const [tag, v] of lines(out(x, x.fc_sort_choices(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, req.header ? 1 : 0, req.across ? 1 : 0, req.key)))) {
        (tag === 'f' ? found.fills : tag === 't' ? found.fonts : found.icons).push(v ?? '');
      }
      return found;
    }
    case 'region':
      return out(x, x.fc_region(req.book, req.sheet, req.row, req.col)).split(',').map(Number) as [number, number, number, number, number];
    case 'header':
      return x.fc_guess_header(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1) === 1;
    case 'merge.list':
      return lines(out(x, x.fc_merges(req.book, req.sheet))).map((l) => l.map(Number) as [number, number, number, number]);
    case 'merge.load': {
      const body = req.areas.map((a) => a.join('\t')).join('\n');
      return withStrings(x, [body], ([p, l]) => ok(x.fc_load_merges(req.book, req.sheet, p, l), 'The engine refused those merged cells.'));
    }
    case 'format.put': {
      const body = req.items.map(([r, c, st, code]) => `${r}\t${c}\t${escape(st)}\t${escape(code)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => effect(out(x, x.fc_put_formats(req.book, req.sheet, p, l))));
    }
    case 'locale.set':
      return withStrings(x, [req.tag], ([p, l]) => ok(x.fc_set_locale(p, l), 'FormCel has no such locale.'));
    case 'theme.get':
      return out(x, x.fc_theme(req.book)).split('\n').filter(Boolean);
    case 'theme.set':
      return withStrings(x, [req.text], ([p, l]) => effect(styled(x, x.fc_set_theme(req.book, p, l))));
    case 'theme.load':
      return withStrings(x, [req.text], ([p, l]) => ok(x.fc_load_theme(req.book, p, l), 'The engine refused that theme.'));
    case 'named.list':
      return out(x, x.fc_named(req.book)).split('\n').filter(Boolean);
    case 'named.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_named(req.book, p, l), 'The engine refused those cell styles.'));
    case 'style.define':
      return withStrings(x, [req.name, req.parts], ([n, nl, p, pl]) => effect(styled(x, x.fc_define_style(req.book, req.sheet, req.row, req.col, n, nl, p, pl))));
    case 'style.delete':
      return withStrings(x, [req.name], ([p, l]) => effect(styled(x, x.fc_delete_style(req.book, p, l))));
    case 'style.apply':
      return withStrings(x, [req.name], ([p, l]) => effect(styled(x, x.fc_apply_style(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, p, l))));
    case 'audit.trace':
      return lines(out(x, x.fc_trace(req.book, req.sheet, req.row, req.col, req.dependents ? 1 : 0, req.levels))).map((l) => l.map(Number) as Arrow);
    case 'audit.eval':
      return lines(out(x, x.fc_eval_steps(req.book, req.sheet, req.row, req.col))).map(([b, c, a]) => [unescape(b ?? ''), unescape(c ?? ''), unescape(a ?? '')] as EvalStep);
    case 'values.read':
      return lines(out(x, x.fc_values_in(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1))).map(([r, c, v]) => [Number(r), Number(c), unescape(v ?? '')] as [number, number, string]);
    case 'link.at':
      return out(x, x.fc_link_at(req.book, req.sheet, req.row, req.col));
    case 'link.set':
      return withStrings(x, [req.target, req.display ?? ''], ([t, tl, d, dl]) => {
        const n = x.fc_set_link(req.book, req.sheet, req.row, req.col, t, tl, d, dl, req.display === undefined ? 0 : 1);
        if (n === -3) throw new Error('FormCel links web pages (http, https), email (mailto), ftp and places in the workbook (#Sheet1!A1).');
        return effect(out(x, n));
      });
    case 'link.remove':
      return effect(out(x, x.fc_remove_links(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1)));
    case 'link.take':
      return lines(out(x, x.fc_take_links(req.book))).map(([sh, r, c, t]) => [Number(sh), Number(r), Number(c), unescape(t ?? '')] as LinkChange);
    case 'link.load': {
      const body = req.cells.map(([r, c, t]) => `${r}\t${c}\t${escape(t)}`).join('\n');
      return withStrings(x, [body], ([p, l]) => ok(x.fc_load_links(req.book, req.sheet, p, l), 'The engine refused those links.'));
    }
    case 'rules.get':
      return out(x, x.fc_rules(req.book, req.sheet)).split('\n').filter(Boolean);
    case 'rules.set':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => {
        const n = x.fc_set_rules(req.book, req.sheet, p, l);
        if (n === -3) throw new Error('That rule is not one FormCel can read. Check its values and formula.');
        return effect(out(x, n));
      });
    case 'rules.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_rules(req.book, req.sheet, p, l), 'The engine refused those rules.'));
    case 'table.list':
      return out(x, x.fc_tables(req.book)).split('\n').filter(Boolean);
    case 'table.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_tables(req.book, p, l), 'The engine refused those tables.'));
    case 'table.create': {
      const n = x.fc_create_table(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, req.header ? 1 : 0);
      if (n === -3) throw new Error('A table cannot overlap another table or merged cells.');
      return effect(out(x, n));
    }
    case 'table.set':
      return withStrings(x, [req.name, req.line], ([p, l, q, m]) => {
        const n = x.fc_set_table(req.book, p, l, q, m);
        if (n === -3) throw new Error('That table name or size is not allowed. Names start with a letter, have no spaces and are not used by another table or name.');
        return effect(out(x, n));
      });
    case 'table.remove':
      return withStrings(x, [req.name], ([p, l]) => effect(out(x, x.fc_remove_table(req.book, p, l))));
    case 'pivot.list':
      return out(x, x.fc_pivots(req.book)).split('\n').filter(Boolean);
    case 'pivot.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_pivots(req.book, p, l), 'The engine refused those PivotTables.'));
    case 'pivot.source':
      return withStrings(x, [req.src], ([p, l]) => pivotOut(x, x.fc_pivot_source(req.book, req.sheet, p, l)));
    case 'pivot.fields':
      return withStrings(x, [req.name], ([p, l]) => pivotOut(x, x.fc_pivot_fields(req.book, p, l)));
    case 'pivot.items':
      return withStrings(x, [req.name, req.field], ([p, l, q, m]) => pivotOut(x, x.fc_pivot_items(req.book, p, l, q, m)).split('\n').filter(Boolean).map(unescape));
    case 'pivot.suggest':
      return withStrings(x, [req.src], ([p, l]) => pivotOut(x, x.fc_pivot_suggest(req.book, req.sheet, p, l)).split('\n').filter(Boolean));
    case 'pivot.create':
      return withStrings(x, [req.line], ([p, l]) => effect(pivotOut(x, x.fc_create_pivot(req.book, p, l))));
    case 'pivot.set':
      return withStrings(x, [req.name, req.line], ([p, l, q, m]) => effect(pivotOut(x, x.fc_set_pivot(req.book, p, l, q, m))));
    case 'pivot.refresh':
      return withStrings(x, [req.name], ([p, l]) => effect(pivotOut(x, x.fc_refresh_pivot(req.book, p, l))));
    case 'pivot.remove':
      return withStrings(x, [req.name], ([p, l]) => effect(pivotOut(x, x.fc_remove_pivot(req.book, p, l))));
    case 'whatif.run':
      return withStrings(x, [req.cmd], ([p, l]) => {
        const s = out(x, x.fc_whatif(req.book, p, l));
        const i = s.indexOf('\u001f');
        return { text: s.slice(0, i), effect: effect(s.slice(i + 1)) };
      });
    case 'whatif.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_whatif(req.book, p, l), 'The engine refused those what-if definitions.'));
    case 'valid.list':
      return out(x, x.fc_validations(req.book, req.sheet)).split('\n').filter(Boolean);
    case 'valid.load':
      return withStrings(x, [req.lines.join('\n')], ([p, l]) => ok(x.fc_load_validations(req.book, req.sheet, p, l), 'The engine refused those validation rules.'));
    case 'valid.set':
      return withStrings(x, [req.line], ([p, l]) => {
        const n = x.fc_set_validation(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1, p, l);
        if (n === -3) throw new Error('That rule is not one FormCel can read. Check its values and formulas.');
        return effect(out(x, n));
      });
    case 'valid.at':
      return out(x, x.fc_validation_at(req.book, req.sheet, req.row, req.col));
    case 'valid.items':
      return out(x, x.fc_list_items(req.book, req.sheet, req.row, req.col)).split('\n').filter((l) => l !== '').map(unescape);
    case 'valid.invalid':
      return lines(out(x, x.fc_invalid_in(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1))).map(([r, c]) => [Number(r), Number(c)]);
    case 'valid.check':
      return withStrings(x, [req.raw], ([p, l]) => out(x, x.fc_check_input(req.book, req.sheet, req.row, req.col, p, l)));
    case 'filter.get':
      return out(x, x.fc_filter(req.book, req.sheet));
    case 'filter.set':
      return withStrings(x, [req.text], ([p, l]) => {
        const n = x.fc_set_filter(req.book, req.sheet, p, l);
        if (n === -3) throw new Error('That filter is not one FormCel can read.');
        return effect(out(x, n));
      });
    case 'filter.load':
      return withStrings(x, [req.text], ([p, l]) => ok(x.fc_load_filter(req.book, req.sheet, p, l), 'The engine refused that filter.'));
    case 'filter.reapply':
      return effect(out(x, x.fc_reapply_filter(req.book, req.sheet)));
    case 'rows.hidden':
      return withStrings(x, [req.text], ([p, l]) => effect(out(x, x.fc_set_hidden_rows(req.book, req.sheet, p, l))));
    case 'tool':
      return withStrings(x, [req.cmd], ([p, l]) => {
        const text = out(x, x.fc_tool(req.book, req.sheet, p, l));
        if (text.startsWith('ERR\t')) throw new Error(text.slice(4));
        const cut = text.indexOf('\n');
        return { ...effect(text.slice(cut + 1)), message: unescape(text.slice(0, cut)) };
      });
    case 'filter.values': {
      const list: FilterList = { values: [], blanks: false, more: false, fills: [], fonts: [], days: [], icons: [] };
      for (const [k, v, m, d] of lines(out(x, x.fc_filter_values(req.book, req.sheet, req.col)))) {
        if (k === 'd') list.days.push([Number(v), Number(m), Number(d)]);
        else if (k === 'i') list.icons.push(v ?? '');
        else if (k === 'v') list.values.push(unescape(v ?? ''));
        else if (k === 'b') list.blanks = true;
        else if (k === 'm') list.more = true;
        else if (k === 'f') list.fills.push(v ?? '');
        else if (k === 't') list.fonts.push(v ?? '');
      }
      return list;
    }
    case 'cf.read':
      return lines(out(x, x.fc_cf_in(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1))).map(([r, c, st, bar, icon]) => [Number(r), Number(c), unescape(st ?? ''), bar ?? '', icon ?? ''] as CfCell);
    case 'undo.mark':
      return ok(x.fc_undo_mark(req.book), 'No such workbook.');
    case 'undo.group':
      return ok(x.fc_undo_group(req.book, req.mark), 'The engine could not join those steps.');
    case 'format.read':
      return lines(out(x, x.fc_formats_in(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1))).map(([, r, c, code]) => [Number(r), Number(c), unescape(code ?? '')] as [number, number, string]);
    case 'name.define':
      return withStrings(x, [req.name, req.refers], ([n, nl, r, rl]) => {
        const len = x.fc_define_name(req.book, n, nl, r, rl);
        if (len === -3) throw new Error('A name starts with a letter or underscore, has no spaces, and is not a cell address.');
        if (len === -4) throw new Error('That is not a formula FormCel can read.');
        return changed(out(x, len));
      });
    case 'name.list':
      return lines(out(x, x.fc_names(req.book))).map(([n, f]) => [unescape(n ?? ''), unescape(f ?? '')] as [string, string]);
    case 'history':
      return x.fc_history(req.book);
    case 'read':
      return cells(out(x, x.fc_read(req.book, req.sheet, req.r0, req.c0, req.r1, req.c1)));
    case 'extent':
      return pair(out(x, x.fc_extent(req.book, req.sheet)));
    case 'edge':
      return pair(out(x, x.fc_edge(req.book, req.sheet, req.row, req.col, DIRS[req.dir])));
    case 'offset':
      return req.items.map(([src, dr, dc]) => withStrings(x, [src], ([p, l]) => out(x, x.fc_offset(p, l, dr, dc))));
    case 'host.keys':
      return out(x, x.fc_host_keys(req.book, req.all ? 1 : 0)).split('\n').filter(Boolean).map(unescape);
    case 'host.set':
      return withStrings(x, [escape(req.key), req.data ?? ''], ([k, kl, d, dl]) => changed(out(x, x.fc_host_set(req.book, k, kl, d, dl, req.data === null ? 0 : 1))));
    case 'host.custom':
      return withStrings(x, [req.names.join('\n')], ([p, l]) => changed(out(x, x.fc_host_custom(req.book, p, l))));
    case 'host.clear':
      return changed(out(x, x.fc_host_clear(req.book)));
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  let res: Response;
  try {
    const x = await ready;
    x.fc_set_clock(localSerial());
    res = { id: req.id, ok: true, value: run(x, req) };
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
