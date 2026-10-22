import type { Arg, CaseTest, DimItem, Expr, ModAst, Param, Proc, Stmt, UdtDef } from './ast';
import { tokenize, type Tok } from './lexer';
import { NULLV, VbaError, type TypeRef, VDate } from './values';

export class SyntaxErr extends VbaError {
  constructor(message: string, readonly line: number) {
    super(0, message);
  }
}

const NOT_LABEL = new Set(['else', 'case', 'default', 'next', 'loop', 'wend', 'then']);
const BLOCK_END = new Set(['if', 'select', 'with', 'sub', 'function', 'property', 'type', 'enum']);

export class Parser {
  private p = 0;
  private toks: Tok[];

  constructor(src: string | Tok[]) {
    this.toks = typeof src === 'string' ? tokenize(src) : src;
  }

  private get t(): Tok {
    return this.toks[this.p] ?? { k: 'eol', v: '', line: 0, sp: false };
  }

  private peek(o = 0): Tok {
    return this.toks[this.p + o] ?? { k: 'eol', v: '', line: 0, sp: false };
  }

  private word(o = 0): string {
    const t = this.peek(o);
    return t.k === 'id' ? t.v.toLowerCase() : '';
  }

  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.k === 'op' && t.v === v;
  }

  private err(msg: string): never {
    throw new SyntaxErr(msg, this.t.line);
  }

  private eof(): boolean {
    return this.p >= this.toks.length;
  }

  private atEol(): boolean {
    return this.eof() || this.t.k === 'eol' || this.t.k === 'colon';
  }

  private skipSep(): void {
    while (!this.eof() && (this.t.k === 'eol' || this.t.k === 'colon')) this.p++;
  }

  private skipLine(): void {
    while (!this.eof() && this.t.k !== 'eol') this.p++;
  }

  private expectOp(v: string): void {
    if (!this.isOp(v)) this.err(`Expected ${v}`);
    this.p++;
  }

  private expectWord(w: string): void {
    if (this.word() !== w) this.err(`Expected ${w}`);
    this.p++;
  }

  private ident(): Tok {
    if (this.t.k !== 'id') this.err('Expected identifier');
    return this.toks[this.p++];
  }

  private endOf(kind: string): boolean {
    return this.word() === 'end' && this.word(1) === kind;
  }

  parseModule(): ModAst {
    const m: ModAst = { optionExplicit: false, optionBase: 0, optionText: false, vars: [], procs: [], types: [], enums: [], implementsList: [] };
    for (;;) {
      this.skipSep();
      if (this.eof()) break;
      const w = this.word();
      if (w === 'version' || w === 'begin') {
        if (w === 'begin') {
          while (!this.eof() && !(this.word() === 'end' && this.peek(1).k === 'eol')) this.skipLine(), this.skipSep();
          this.p++;
        }
        this.skipLine();
        continue;
      }
      if (w === 'attribute') {
        this.skipLine();
        continue;
      }
      if (w === 'option') {
        this.p++;
        const o = this.word();
        this.p++;
        if (o === 'explicit') m.optionExplicit = true;
        else if (o === 'base') m.optionBase = Number(this.toks[this.p++].v);
        else if (o === 'compare') {
          m.optionText = this.word() === 'text';
          this.p++;
        } else this.skipLine();
        continue;
      }
      if (w === 'implements') {
        this.p++;
        m.implementsList.push(this.ident().v);
        continue;
      }
      let vis: 'public' | 'private' | 'friend' = 'public';
      let isStatic = false;
      let line = this.t.line;
      let scope: 'dim' | 'static' | 'public' | 'private' = 'dim';
      for (;;) {
        const x = this.word();
        if (x === 'public' || x === 'global') {
          vis = 'public';
          scope = 'public';
          this.p++;
        } else if (x === 'private') {
          vis = 'private';
          scope = 'private';
          this.p++;
        } else if (x === 'friend') {
          vis = 'friend';
          this.p++;
        } else if (x === 'static') {
          isStatic = true;
          this.p++;
        } else break;
      }
      line = this.t.line;
      const k = this.word();
      if (k === 'sub' || k === 'function' || k === 'property') {
        m.procs.push(this.parseProc(vis, isStatic));
      } else if (k === 'declare') {
        this.skipLine();
      } else if (k === 'event') {
        this.skipLine();
      } else if (k === 'type') {
        m.types.push(this.parseType());
      } else if (k === 'enum') {
        m.enums.push(this.parseEnum(vis));
      } else if (k === 'const') {
        const s = this.parseConst(scope === 'dim' ? 'public' : scope);
        m.vars.push(s as Extract<Stmt, { k: 'const' }>);
      } else if (k === 'dim' || k === 'withevents' || scope !== 'dim' || (k && this.peek(1).k !== 'op')) {
        if (k === 'dim') this.p++;
        if (this.word() === 'withevents') this.p++;
        const s = this.parseDimBody(scope === 'dim' ? 'private' : scope, line);
        m.vars.push(s as Extract<Stmt, { k: 'dim' }>);
      } else {
        this.err(`Unexpected ${this.t.v || 'end of line'} at module level`);
      }
    }
    return m;
  }

  private parseType(): UdtDef {
    this.expectWord('type');
    const name = this.ident().v;
    const fields: UdtDef['fields'] = [];
    for (;;) {
      this.skipSep();
      if (this.endOf('type')) {
        this.p += 2;
        break;
      }
      if (this.eof()) this.err('Type without End Type');
      const f = this.ident();
      let dims: { lo: Expr | null; hi: Expr }[] | null = null;
      if (this.isOp('(')) dims = this.parseDims();
      let type: TypeRef = { name: 'variant' };
      if (this.word() === 'as') {
        this.p++;
        type = this.parseType2();
      }
      fields.push({ name: f.v.toLowerCase(), raw: f.v, type, dims });
    }
    return { name: name.toLowerCase(), fields };
  }

  private parseEnum(vis: string) {
    this.expectWord('enum');
    const name = this.ident().v;
    const members: { name: string; raw: string; value: Expr | null }[] = [];
    for (;;) {
      this.skipSep();
      if (this.endOf('enum')) {
        this.p += 2;
        break;
      }
      if (this.eof()) this.err('Enum without End Enum');
      const id = this.ident();
      let value: Expr | null = null;
      if (this.isOp('=')) {
        this.p++;
        value = this.expr();
      }
      members.push({ name: id.v.toLowerCase(), raw: id.v, value });
    }
    return { name: name.toLowerCase(), vis, members };
  }

  private parseType2(): TypeRef {
    let isNew = false;
    if (this.word() === 'new') {
      isNew = true;
      this.p++;
    }
    let name = this.ident().v.toLowerCase();
    while (this.isOp('.')) {
      this.p++;
      name = this.ident().v.toLowerCase();
    }
    const t: TypeRef = { name };
    if (isNew) t.isNew = true;
    if (name === 'string' && this.isOp('*')) {
      this.p++;
      const n = this.t;
      this.p++;
      t.len = n.k === 'num' ? n.n : 255;
    }
    return t;
  }

  private parseDims(): { lo: Expr | null; hi: Expr }[] | null {
    this.expectOp('(');
    const dims: { lo: Expr | null; hi: Expr }[] = [];
    if (this.isOp(')')) {
      this.p++;
      return null;
    }
    for (;;) {
      const a = this.expr();
      if (this.word() === 'to') {
        this.p++;
        dims.push({ lo: a, hi: this.expr() });
      } else dims.push({ lo: null, hi: a });
      if (this.isOp(',')) {
        this.p++;
        continue;
      }
      break;
    }
    this.expectOp(')');
    return dims;
  }

  private parseDimBody(scope: 'dim' | 'static' | 'public' | 'private', line: number): Stmt {
    const items: DimItem[] = [];
    for (;;) {
      const id = this.ident();
      let dims: { lo: Expr | null; hi: Expr }[] | null = null;
      let dynamic = false;
      if (this.isOp('(')) {
        dims = this.parseDims();
        if (!dims) dynamic = true;
      }
      let type: TypeRef = { name: suffixType(id.suffix) };
      if (this.word() === 'as') {
        this.p++;
        type = this.parseType2();
      }
      items.push({ name: id.v.toLowerCase(), raw: id.v, type, dims, dynamic });
      if (this.isOp(',')) {
        this.p++;
        continue;
      }
      break;
    }
    return { k: 'dim', scope, items, line };
  }

  private parseConst(scope: string): Stmt {
    const line = this.t.line;
    this.expectWord('const');
    const items: { name: string; raw: string; type: TypeRef | null; value: Expr }[] = [];
    for (;;) {
      const id = this.ident();
      let type: TypeRef | null = id.suffix ? { name: suffixType(id.suffix) } : null;
      if (this.word() === 'as') {
        this.p++;
        type = this.parseType2();
      }
      this.expectOp('=');
      items.push({ name: id.v.toLowerCase(), raw: id.v, type, value: this.expr() });
      if (this.isOp(',')) {
        this.p++;
        continue;
      }
      break;
    }
    return { k: 'const', items, scope, line };
  }

  private parseProc(vis: 'public' | 'private' | 'friend', isStatic: boolean): Proc {
    const line = this.t.line;
    const kw = this.word();
    this.p++;
    let kind: Proc['kind'] = kw === 'sub' ? 'sub' : 'function';
    if (kw === 'property') {
      const w = this.word();
      this.p++;
      kind = w === 'get' ? 'get' : w === 'let' ? 'let' : 'set';
    }
    const id = this.ident();
    const params: Param[] = [];
    if (this.isOp('(')) {
      this.p++;
      while (!this.isOp(')')) {
        params.push(this.parseParam());
        if (this.isOp(',')) this.p++;
        else if (!this.isOp(')')) this.err('Expected , or ) in parameter list');
      }
      this.p++;
    }
    let ret: TypeRef | null = id.suffix ? { name: suffixType(id.suffix) } : null;
    let retArray = false;
    if (this.word() === 'as') {
      this.p++;
      ret = this.parseType2();
      if (this.isOp('(')) {
        this.p++;
        this.expectOp(')');
        retArray = true;
      }
    }
    while (!this.atEol() && !this.eof()) this.p++;
    const endWord = kw === 'property' ? 'property' : kw;
    const body = this.block(() => this.endOf(endWord));
    if (!this.endOf(endWord)) this.err(`${kw} without End ${kw}`);
    const endLine = this.t.line;
    this.p += 2;
    return { name: id.v.toLowerCase(), raw: id.v, kind, vis, isStatic, params, ret, retArray, body, line, endLine };
  }

  private parseParam(): Param {
    let optional = false;
    let byRef = true;
    let paramArray = false;
    for (;;) {
      const w = this.word();
      if (w === 'optional') optional = true;
      else if (w === 'byval') byRef = false;
      else if (w === 'byref') byRef = true;
      else if (w === 'paramarray') paramArray = true;
      else break;
      this.p++;
    }
    const id = this.ident();
    let isArray = false;
    if (this.isOp('(')) {
      this.p++;
      this.expectOp(')');
      isArray = true;
    }
    let type: TypeRef = { name: suffixType(id.suffix) };
    if (this.word() === 'as') {
      this.p++;
      type = this.parseType2();
    }
    let def: Expr | null = null;
    if (this.isOp('=')) {
      this.p++;
      def = this.expr();
    }
    return { name: id.v.toLowerCase(), raw: id.v, byRef, optional: optional || paramArray, paramArray, type, isArray, def };
  }

  parseStatements(): Stmt[] {
    const s = this.block(() => false);
    return s;
  }

  private block(stop: () => boolean): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      this.skipSep();
      if (this.eof() || stop()) break;
      out.push(this.statement());
      if (!this.atEol() && !this.eof() && !stop()) this.err(`Expected end of statement but found ${this.t.v}`);
    }
    return out;
  }

  private statement(): Stmt {
    const t = this.t;
    const line = t.line;
    const lineStart = this.p === 0 || this.toks[this.p - 1].k === 'eol';
    if (lineStart && t.k === 'num' && this.peek(1).k !== 'op') {
      this.p++;
      return { k: 'label', name: t.v, line };
    }
    if (lineStart && t.k === 'id' && this.peek(1).k === 'colon' && !NOT_LABEL.has(this.word()) && !this.peek(1).sp) {
      this.p += 2;
      return { k: 'label', name: t.v.toLowerCase(), line };
    }
    const w = this.word();
    switch (w) {
      case 'dim':
        this.p++;
        return this.parseDimBody('dim', line);
      case 'static':
        this.p++;
        if (this.word() === 'const') return this.parseConst('static');
        return this.parseDimBody('static', line);
      case 'private':
      case 'public':
        this.p++;
        if (this.word() === 'const') return this.parseConst(w);
        return this.parseDimBody('dim', line);
      case 'const':
        return this.parseConst('private');
      case 'redim':
        return this.parseRedim();
      case 'erase': {
        this.p++;
        const names = [this.postfix()];
        while (this.isOp(',')) {
          this.p++;
          names.push(this.postfix());
        }
        return { k: 'erase', names, line };
      }
      case 'set': {
        this.p++;
        const target = this.postfix();
        this.expectOp('=');
        return { k: 'assign', target, value: this.expr(), isSet: true, line };
      }
      case 'let': {
        this.p++;
        const target = this.postfix();
        this.expectOp('=');
        return { k: 'assign', target, value: this.expr(), isSet: false, line };
      }
      case 'call': {
        this.p++;
        const e = this.postfix();
        return { k: 'call', e: e.k === 'call' || e.k === 'mem' || e.k === 'name' ? e : e, line };
      }
      case 'if':
        return this.parseIf();
      case 'select':
        return this.parseSelect();
      case 'for':
        return this.parseFor();
      case 'do':
        return this.parseDo();
      case 'while': {
        this.p++;
        const cond = this.expr();
        const body = this.block(() => this.word() === 'wend');
        this.expectWord('wend');
        return { k: 'do', cond, until: false, post: false, body, line };
      }
      case 'with': {
        this.p++;
        const o = this.expr();
        const body = this.block(() => this.endOf('with'));
        if (!this.endOf('with')) this.err('With without End With');
        this.p += 2;
        return { k: 'with', o, body, line };
      }
      case 'goto': {
        this.p++;
        const target = this.t.v.toLowerCase();
        this.p++;
        return { k: 'goto', label: target, line };
      }
      case 'gosub': {
        this.p++;
        const l = this.t.v.toLowerCase();
        this.p++;
        return { k: 'gosub', label: l, line };
      }
      case 'return':
        this.p++;
        return { k: 'return', line };
      case 'on': {
        if (this.word(1) === 'error') {
          this.p += 2;
          if (this.word() === 'resume') {
            this.p += 2;
            return { k: 'onerror', mode: 'next', label: '', line };
          }
          this.expectWord('goto');
          const l = this.t;
          this.p++;
          if (l.k === 'op' && l.v === '-') {
            this.p++;
            return { k: 'onerror', mode: 'zero', label: '', line };
          }
          if (l.k === 'num' && l.n === 0) return { k: 'onerror', mode: 'zero', label: '', line };
          return { k: 'onerror', mode: 'goto', label: l.v.toLowerCase(), line };
        }
        break;
      }
      case 'resume': {
        this.p++;
        if (this.word() === 'next') {
          this.p++;
          return { k: 'resume', mode: 'next', label: '', line };
        }
        if (!this.atEol()) {
          const l = this.t.v.toLowerCase();
          this.p++;
          return { k: 'resume', mode: 'label', label: l, line };
        }
        return { k: 'resume', mode: 'retry', label: '', line };
      }
      case 'exit': {
        this.p++;
        const what = this.word();
        this.p++;
        return { k: 'exit', what, line };
      }
      case 'end':
        if (this.peek(1).k === 'eol' || this.peek(1).k === 'colon' || this.eofAt(1)) {
          this.p++;
          return { k: 'end', line };
        }
        if (BLOCK_END.has(this.word(1))) this.err(`End ${this.peek(1).v} without matching block`);
        this.p++;
        return { k: 'end', line };
      case 'stop':
        this.p++;
        return { k: 'stop', line };
      case 'print':
        if (this.isOp('#', 1)) {
          this.p += 2;
          const file = this.expr();
          if (this.isOp(',')) this.p++;
          return { k: 'print', file, items: this.printItems(), debug: false, line };
        }
        break;
      case 'rem':
        this.skipLine();
        return { k: 'nop', line };
      case 'option':
      case 'attribute':
        this.skipLine();
        return { k: 'nop', line };
      case 'randomize':
      case 'doevents':
        break;
      default:
    }
    return this.callOrAssign(line);
  }

  private eofAt(o: number): boolean {
    return this.p + o >= this.toks.length;
  }

  private printItems(): { e: Expr | null; sep: string }[] {
    const items: { e: Expr | null; sep: string }[] = [];
    while (!this.atEol()) {
      let e: Expr | null = null;
      if (!(this.isOp(';') || this.isOp(','))) {
        e = this.expr();
      }
      let sep = '';
      if (this.isOp(';')) {
        sep = ';';
        this.p++;
      } else if (this.isOp(',')) {
        sep = ',';
        this.p++;
      }
      items.push({ e, sep });
      if (e === null && sep === '') break;
    }
    return items;
  }

  private callOrAssign(line: number): Stmt {
    const startTok = this.p;
    if (this.word() === 'debug' && this.isOp('.', 1) && (this.word(2) === 'print')) {
      this.p += 3;
      return { k: 'print', file: null, items: this.printItems(), debug: true, line };
    }
    const e = this.postfix();
    if (this.isOp('=') ) {
      this.p++;
      const value = this.expr();
      return { k: 'assign', target: e, value, isSet: false, line };
    }
    if (this.atEol() || this.eof() || this.word() === 'else') {
      if (e.k === 'call' || e.k === 'mem' || e.k === 'name') return { k: 'call', e, line };
      this.p = startTok;
      this.err('Expected statement');
    }
    const args = this.bareArgs();
    return { k: 'call', e: attachArgs(e, args), line };
  }

  private bareArgs(): Arg[] {
    const args: Arg[] = [];
    for (;;) {
      if (this.isOp(',')) {
        args.push({ e: null });
        this.p++;
        continue;
      }
      args.push(this.arg());
      if (this.isOp(',')) {
        this.p++;
        if (this.atEol()) {
          args.push({ e: null });
          break;
        }
        continue;
      }
      break;
    }
    return args;
  }

  private arg(): Arg {
    if (this.t.k === 'id' && this.isOp(':=', 1)) {
      const name = this.t.v.toLowerCase();
      this.p += 2;
      return { e: this.expr(), name };
    }
    return { e: this.expr() };
  }

  private parseRedim(): Stmt {
    const line = this.t.line;
    this.p++;
    let preserve = false;
    if (this.word() === 'preserve') {
      preserve = true;
      this.p++;
    }
    const items: { target: Expr; dims: { lo: Expr | null; hi: Expr }[]; type: TypeRef | null }[] = [];
    for (;;) {
      const id = this.ident();
      const target: Expr = { k: 'name', n: id.v.toLowerCase(), raw: id.v };
      let t: Expr = target;
      while (this.isOp('.')) {
        this.p++;
        const m = this.ident();
        t = { k: 'mem', o: t, n: m.v.toLowerCase(), raw: m.v };
      }
      const dims = this.parseDims() ?? [];
      let type: TypeRef | null = null;
      if (this.word() === 'as') {
        this.p++;
        type = this.parseType2();
      }
      items.push({ target: t, dims, type });
      if (this.isOp(',')) {
        this.p++;
        continue;
      }
      break;
    }
    return { k: 'redim', preserve, items, line };
  }

  private inline(stopElse: boolean): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      while (this.t.k === 'colon') this.p++;
      if (this.eof() || this.t.k === 'eol') break;
      if (stopElse && this.word() === 'else') break;
      out.push(this.statement());
    }
    return out;
  }

  private parseIf(): Stmt {
    const line = this.t.line;
    this.p++;
    const cond = this.expr();
    this.expectWord('then');
    if (!(this.t.k === 'eol' || this.eof())) {
      const then = this.inline(true);
      let els: Stmt[] | null = null;
      if (this.word() === 'else') {
        this.p++;
        els = this.inline(false);
      }
      return { k: 'if', cond, then, elifs: [], else: els, line };
    }
    const stop = () => this.endOf('if') || this.word() === 'else' || this.word() === 'elseif';
    const then = this.block(stop);
    const elifs: { cond: Expr; body: Stmt[] }[] = [];
    let els: Stmt[] | null = null;
    for (;;) {
      if (this.word() === 'elseif') {
        this.p++;
        const c = this.expr();
        this.expectWord('then');
        elifs.push({ cond: c, body: this.block(stop) });
      } else if (this.word() === 'else') {
        this.p++;
        els = this.block(stop);
      } else break;
    }
    if (!this.endOf('if')) this.err('If without End If');
    this.p += 2;
    return { k: 'if', cond, then, elifs, else: els, line };
  }

  private parseSelect(): Stmt {
    const line = this.t.line;
    this.p++;
    this.expectWord('case');
    const e = this.expr();
    const cases: { tests: CaseTest[] | null; body: Stmt[] }[] = [];
    this.skipSep();
    while (this.word() === 'case') {
      this.p++;
      let tests: CaseTest[] | null = null;
      if (this.word() === 'else') this.p++;
      else {
        tests = [];
        for (;;) {
          if (this.word() === 'is' && ['=', '<', '>', '<=', '>=', '<>'].includes(this.peek(1).v)) {
            const op = this.peek(1).v;
            this.p += 2;
            tests.push({ t: 'is', op, e: this.expr() });
          } else if (['<', '>', '<=', '>=', '<>', '='].includes(this.t.v) && this.t.k === 'op') {
            const op = this.t.v;
            this.p++;
            tests.push({ t: 'is', op, e: this.expr() });
          } else {
            const a = this.expr();
            if (this.word() === 'to') {
              this.p++;
              tests.push({ t: 'range', lo: a, hi: this.expr() });
            } else tests.push({ t: 'val', e: a });
          }
          if (this.isOp(',')) {
            this.p++;
            continue;
          }
          break;
        }
      }
      const body = this.block(() => this.word() === 'case' || this.endOf('select'));
      cases.push({ tests, body });
    }
    if (!this.endOf('select')) this.err('Select Case without End Select');
    this.p += 2;
    return { k: 'select', e, cases, line };
  }

  private parseFor(): Stmt {
    const line = this.t.line;
    this.p++;
    if (this.word() === 'each') {
      this.p++;
      const v = this.postfix();
      this.expectWord('in');
      const coll = this.expr();
      const body = this.block(() => this.word() === 'next');
      this.expectWord('next');
      if (!this.atEol()) this.postfix();
      return { k: 'foreach', v, coll, body, line };
    }
    const v = this.postfix();
    this.expectOp('=');
    const from = this.expr();
    this.expectWord('to');
    const to = this.expr();
    let step: Expr | null = null;
    if (this.word() === 'step') {
      this.p++;
      step = this.expr();
    }
    const body = this.block(() => this.word() === 'next');
    this.expectWord('next');
    if (!this.atEol()) {
      this.postfix();
      while (this.isOp(',')) {
        this.p++;
        this.postfix();
      }
    }
    return { k: 'for', v, from, to, step, body, line };
  }

  private parseDo(): Stmt {
    const line = this.t.line;
    this.p++;
    let cond: Expr | null = null;
    let until = false;
    let post = false;
    if (this.word() === 'while' || this.word() === 'until') {
      until = this.word() === 'until';
      this.p++;
      cond = this.expr();
    }
    const body = this.block(() => this.word() === 'loop');
    this.expectWord('loop');
    if (!cond && (this.word() === 'while' || this.word() === 'until')) {
      until = this.word() === 'until';
      this.p++;
      cond = this.expr();
      post = true;
    }
    return { k: 'do', cond, until, post, body, line };
  }

  parseExpressionOnly(): Expr {
    const e = this.expr();
    return e;
  }

  expr(): Expr {
    return this.imp();
  }

  private imp(): Expr {
    let l = this.eqv();
    while (this.word() === 'imp') {
      this.p++;
      l = { k: 'bin', op: 'imp', l, r: this.eqv() };
    }
    return l;
  }

  private eqv(): Expr {
    let l = this.xor();
    while (this.word() === 'eqv') {
      this.p++;
      l = { k: 'bin', op: 'eqv', l, r: this.xor() };
    }
    return l;
  }

  private xor(): Expr {
    let l = this.or();
    while (this.word() === 'xor') {
      this.p++;
      l = { k: 'bin', op: 'xor', l, r: this.or() };
    }
    return l;
  }

  private or(): Expr {
    let l = this.and();
    while (this.word() === 'or') {
      this.p++;
      l = { k: 'bin', op: 'or', l, r: this.and() };
    }
    return l;
  }

  private and(): Expr {
    let l = this.not();
    while (this.word() === 'and') {
      this.p++;
      l = { k: 'bin', op: 'and', l, r: this.not() };
    }
    return l;
  }

  private not(): Expr {
    if (this.word() === 'not') {
      this.p++;
      return { k: 'un', op: 'not', e: this.not() };
    }
    return this.cmp();
  }

  private cmp(): Expr {
    let l = this.concat();
    for (;;) {
      const t = this.t;
      if (t.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.p++;
        l = { k: 'bin', op: t.v, l, r: this.concat() };
      } else if (t.k === 'id' && t.v.toLowerCase() === 'like') {
        this.p++;
        l = { k: 'bin', op: 'like', l, r: this.concat() };
      } else if (t.k === 'id' && t.v.toLowerCase() === 'is') {
        this.p++;
        l = { k: 'bin', op: 'is', l, r: this.concat() };
      } else break;
    }
    return l;
  }

  private concat(): Expr {
    let l = this.add();
    while (this.isOp('&')) {
      this.p++;
      l = { k: 'bin', op: '&', l, r: this.add() };
    }
    return l;
  }

  private add(): Expr {
    let l = this.mod();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.t.v;
      this.p++;
      l = { k: 'bin', op, l, r: this.mod() };
    }
    return l;
  }

  private mod(): Expr {
    let l = this.idiv();
    while (this.word() === 'mod') {
      this.p++;
      l = { k: 'bin', op: 'mod', l, r: this.idiv() };
    }
    return l;
  }

  private idiv(): Expr {
    let l = this.mul();
    while (this.isOp('\\')) {
      this.p++;
      l = { k: 'bin', op: '\\', l, r: this.mul() };
    }
    return l;
  }

  private mul(): Expr {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.t.v;
      this.p++;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.t.v;
      this.p++;
      const e = this.unary();
      if (op === '-' && e.k === 'num') return { k: 'num', v: -e.v };
      return op === '-' ? { k: 'un', op: 'neg', e } : e;
    }
    return this.pow();
  }

  private pow(): Expr {
    let l = this.postfix();
    while (this.isOp('^')) {
      this.p++;
      let r: Expr;
      if (this.isOp('-')) {
        this.p++;
        r = { k: 'un', op: 'neg', e: this.postfix() };
      } else r = this.postfix();
      l = { k: 'bin', op: '^', l, r };
    }
    return l;
  }

  postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(') && !(this.t.sp && e.k === 'num')) {
        this.p++;
        const a: Arg[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            if (this.isOp(',')) {
              a.push({ e: null });
              this.p++;
              continue;
            }
            a.push(this.arg());
            if (this.isOp(',')) {
              this.p++;
              if (this.isOp(')')) a.push({ e: null });
              continue;
            }
            break;
          }
        }
        this.expectOp(')');
        e = { k: 'call', t: e, a };
      } else if (this.isOp('.') ) {
        this.p++;
        const id = this.ident();
        e = { k: 'mem', o: e, n: id.v.toLowerCase(), raw: id.v };
      } else if (this.isOp('!') && this.peek(1).k === 'id') {
        this.p++;
        const id = this.ident();
        e = { k: 'bang', o: e, n: id.v };
      } else break;
    }
    return e;
  }

  private primary(): Expr {
    const t = this.t;
    if (t.k === 'num') {
      this.p++;
      return { k: 'num', v: t.n as number };
    }
    if (t.k === 'str') {
      this.p++;
      return { k: 'str', v: t.v };
    }
    if (t.k === 'date') {
      this.p++;
      return { k: 'lit', v: new VDate(t.n as number) };
    }
    if (t.k === 'op') {
      if (t.v === '(') {
        this.p++;
        const e = this.expr();
        this.expectOp(')');
        return { k: 'paren', e };
      }
      if (t.v === '.') {
        this.p++;
        const id = this.ident();
        return { k: 'mem', o: null, n: id.v.toLowerCase(), raw: id.v };
      }
      if (t.v === '!') {
        this.p++;
        const id = this.ident();
        return { k: 'bang', o: null, n: id.v };
      }
    }
    if (t.k === 'id') {
      const w = t.v.toLowerCase();
      if (t.suffix === '[') {
        this.p++;
        return { k: 'call', t: { k: 'name', n: 'evaluate', raw: 'Evaluate' }, a: [{ e: { k: 'str', v: t.v } }] };
      }
      if (w === 'true') {
        this.p++;
        return { k: 'lit', v: true };
      }
      if (w === 'false') {
        this.p++;
        return { k: 'lit', v: false };
      }
      if (w === 'nothing') {
        this.p++;
        return { k: 'lit', v: null };
      }
      if (w === 'empty') {
        this.p++;
        return { k: 'lit', v: undefined };
      }
      if (w === 'null') {
        this.p++;
        return { k: 'lit', v: NULLV };
      }
      if (w === 'new') {
        this.p++;
        let name = this.ident().v.toLowerCase();
        while (this.isOp('.')) {
          this.p++;
          name = this.ident().v.toLowerCase();
        }
        return { k: 'new', cls: name };
      }
      if (w === 'typeof') {
        this.p++;
        const e = this.postfix();
        this.expectWord('is');
        let name = this.ident().v.toLowerCase();
        while (this.isOp('.')) {
          this.p++;
          name = this.ident().v.toLowerCase();
        }
        return { k: 'typeof', e, t: name, neg: false };
      }
      if (w === 'addressof') {
        this.p++;
        return { k: 'addr', n: this.ident().v.toLowerCase() };
      }
      this.p++;
      return { k: 'name', n: w + (t.suffix && t.suffix !== '[' ? '' : ''), raw: t.v };
    }
    this.err(t.k === 'eol' ? 'Expected expression' : `Unexpected ${t.v}`);
  }
}

function suffixType(s?: string): string {
  switch (s) {
    case '$':
      return 'string';
    case '%':
      return 'integer';
    case '&':
      return 'long';
    case '#':
      return 'double';
    case '@':
      return 'currency';
    default:
      return 'variant';
  }
}

function attachArgs(e: Expr, args: Arg[]): Expr {
  if (e.k === 'call') return { k: 'call', t: e, a: args };
  return { k: 'call', t: e, a: args };
}

export function parseModule(src: string): ModAst {
  return new Parser(src).parseModule();
}

export function parseProcFromText(src: string): Proc[] {
  return new Parser(src).parseModule().procs;
}

export function parseImmediate(src: string): Stmt[] {
  let t = src.trim();
  if (t.startsWith('?')) t = `Debug.Print ${t.slice(1)}`;
  return new Parser(t).parseStatements();
}

export function parseExpr(src: string): Expr {
  return new Parser(src).parseExpressionOnly();
}
