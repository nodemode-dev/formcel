import type { CaseTest, DimItem, Expr, ModAst, Param, Proc, Stmt, UdtDef } from './ast';
import { BUILTINS, VB_CONSTS, VRegExp, newRnd, type BuiltinCtx } from './builtins';
import { DebugObject, ErrObject, VCollection, VDictionary, describeValue, setMessageLookup } from './objects';
import { Parser, SyntaxErr } from './parser';
import type { CompileProblem, Location, PauseInfo, StackEntry, StepAction, VbaEvent, VbaHost, VbaModule } from './types';
import {
  HostObject,
  MESSAGES,
  MISSING,
  NULLV,
  VArray,
  VbaError,
  VDate,
  VError,
  VUdt,
  type TypeRef,
  coerce,
  compare,
  defaultOf,
  fail,
  isObj,
  likePattern,
  toBool,
  toNum,
  toStr,
  typeNameOf,
} from './values';

export interface Var {
  v: any;
  t: TypeRef;
  isConst?: boolean;
  ev?: { name: string; mod: ModInfo; owner: any };
}

export class RefArg {
  constructor(readonly ref: Var) {}
}

export class ModInfo {
  vars = new Map<string, Var>();
  procs = new Map<string, Proc[]>();
  types = new Map<string, UdtDef>();
  enums = new Map<string, Map<string, number>>();
  inited = false;
  constructor(readonly name: string, readonly kind: VbaModule['kind'], readonly ast: ModAst, readonly sheet?: string) {}
}

export class VInstance {
  readonly typeName: string;
  fields = new Map<string, Var>();
  terminated = false;
  subs: Var[] = [];
  constructor(readonly mod: ModInfo) {
    this.typeName = mod.name;
  }
}

class ModuleRef extends HostObject {
  readonly typeName: string;
  constructor(readonly mod: ModInfo, private readonly it: Interp) {
    super();
    this.typeName = mod.name;
  }

  member(name: string, args: unknown[], mode: 0 | 1 | 2, value?: unknown): Promise<unknown> | unknown {
    const v = this.mod.vars.get(name);
    if (v) {
      if (mode === 0) return args.length ? this.it.indexValue(v.v, args) : v.v;
      v.v = coerce(value, v.t);
      return undefined;
    }
    const ps = this.mod.procs.get(name);
    if (ps) return this.it.callByMode(ps, this.mod, null, args, mode, value);
    return fail(438);
  }
}

type Signal = { t: 'exit'; what: string } | { t: 'goto'; label: string } | { t: 'jump'; block: Stmt[]; idx: number } | { t: 'return' };

export class Frame {
  vars = new Map<string, Var>();
  withs: any[] = [];
  onErr: { mode: 'none' | 'goto' | 'next'; label: string } = { mode: 'none', label: '' };
  inHandler = false;
  failed: { block: Stmt[]; idx: number } | null = null;
  line = 0;
  topIdx = 0;
  failedTop = 0;
  constructor(readonly mod: ModInfo, readonly proc: Proc | null, readonly me: any) {}
}

class StopRun extends Error {
  constructor(readonly reason: 'end' | 'stop') {
    super(reason);
  }
}

const DECLARED: Record<string, string> = { long: 'Long', integer: 'Integer', single: 'Single', double: 'Double', currency: 'Currency', byte: 'Byte', string: 'String', boolean: 'Boolean', date: 'Date', longlong: 'LongLong' };

const ITEM_MEMBERS =new Set(['cells', 'range', 'item', 'offset', 'resize', 'rows', 'columns']);

export class Interp {
  private pending = '';
  private capture: string | null = null;
  mods = new Map<string, ModInfo>();
  globals = new Map<string, (f: Frame) => any>();
  host: VbaHost;
  err = new ErrObject();
  rnd = newRnd();
  listeners: ((e: VbaEvent) => void)[] = [];
  breakpoints = new Map<string, Set<number>>();
  stack: { proc: Proc; mod: ModInfo; frame: Frame }[] = [];
  private stepMode: 'run' | 'into' | 'over' | 'out' = 'run';
  private stepDepth = 0;
  private resumeFn: ((a: StepAction) => void) | null = null;
  private ticks = 0;
  private lastYield = 0;
  private aborted = false;
  private deadline = 0;
  paused: Frame | null = null;
  publicVars = new Map<string, Var>();
  publicProcs = new Map<string, { proc: Proc[]; mod: ModInfo }>();
  publicTypes = new Map<string, UdtDef>();
  consts: Record<string, unknown> = { ...VB_CONSTS };
  curLine = 0;
  curMod = '';
  curProc = '';
  lastLoc: Location | null = null;
  debugObj: DebugObject;
  extraCreate: (progId: string) => unknown = () => fail(429);
  labelCache = new WeakMap<Stmt[], Map<string, number>>();
  bctx: BuiltinCtx;
  classCache = new Map<string, ModInfo>();
  immediateFrame: Frame | null = null;

  constructor(host: VbaHost) {
    this.host = host;
    this.debugObj = new DebugObject((t) => this.out(t));
    setMessageLookup((n) => MESSAGES[n] ?? 'Application-defined or object-defined error');
    const it = this;
    this.bctx = {
      host,
      get textMode() {
        return it.curMode();
      },
      get base() {
        return it.curBase();
      },
      rnd: this.rnd,
      now: () => this.nowSerial(),
      out: (t) => this.out(t),
      createObject: (p) => this.createObject(p),
      callByName: (o, n, m, a) => this.callByName(o, n, m, a),
      yieldNow: () => this.yieldNow(),
    };
  }

  nowSerial(): number {
    const ms = this.host.now();
    const d = new Date(ms);
    const local = ms - d.getTimezoneOffset() * 60000;
    return local / 86400000 + 25569;
  }

  curMode(): boolean {
    const m = this.mods.get(this.curMod.toLowerCase());
    return m ? m.ast.optionText : false;
  }

  curBase(): number {
    const m = this.mods.get(this.curMod.toLowerCase());
    return m ? m.ast.optionBase : 0;
  }

  on(fn: (e: VbaEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  emit(e: VbaEvent): void {
    for (const l of this.listeners) l(e);
  }

  out(text: string): void {
    if (this.capture !== null) {
      this.capture += `${text}\n`;
      return;
    }
    this.emit({ type: 'output', text });
  }

  registerGlobal(name: string, get: (f: Frame) => any): void {
    this.globals.set(name.toLowerCase(), get);
  }

  async load(modules: VbaModule[]): Promise<CompileProblem[]> {
    const problems: CompileProblem[] = [];
    this.mods = new Map();
    this.publicVars = new Map();
    this.publicProcs = new Map();
    this.publicTypes = new Map();
    this.classCache = new Map();
    for (const m of modules) {
      try {
        const ast = new Parser(m.code).parseModule();
        const info = new ModInfo(m.name, m.kind, ast, m.sheet);
        for (const p of ast.procs) {
          const list = info.procs.get(p.name) ?? [];
          list.push(p);
          info.procs.set(p.name, list);
        }
        for (const t of ast.types) info.types.set(t.name, t);
        this.mods.set(m.name.toLowerCase(), info);
      } catch (e) {
        if (e instanceof SyntaxErr) problems.push({ module: m.name, line: e.line, message: e.description });
        else problems.push({ module: m.name, line: 0, message: e instanceof Error ? e.message : String(e) });
      }
    }
    for (const info of this.mods.values()) {
      for (const [n, t] of info.types) this.publicTypes.set(n, t);
      if (info.kind === 'class' || info.kind === 'form') continue;
      for (const [n, ps] of info.procs) {
        const pub = ps.filter((p) => p.vis !== 'private');
        if (pub.length && !this.publicProcs.has(n)) this.publicProcs.set(n, { proc: pub, mod: info });
      }
    }
    for (const info of this.mods.values()) {
      if (info.kind === 'class') continue;
      try {
        await this.initModule(info);
      } catch (e) {
        problems.push({ module: info.name, line: this.curLine, message: e instanceof VbaError ? e.description : String(e) });
      }
    }
    return problems;
  }

  async initModule(info: ModInfo): Promise<void> {
    const f = new Frame(info, null, null);
    for (const en of info.ast.enums) {
      const m = new Map<string, number>();
      let next = 0;
      for (const mem of en.members) {
        if (mem.value) next = toNum(await this.eval(mem.value, f));
        m.set(mem.name, next);
        const v: Var = { v: next, t: { name: 'long' }, isConst: true };
        info.vars.set(mem.name, v);
        if (en.vis !== 'private') this.publicVars.set(mem.name, v);
        next++;
      }
      info.enums.set(en.name, m);
    }
    for (const s of info.ast.vars) {
      if (s.k === 'const') {
        for (const c of s.items) {
          const raw = await this.eval(c.value, f);
          const v: Var = { v: c.type ? coerce(raw, c.type) : raw, t: c.type ?? { name: 'variant' }, isConst: true };
          info.vars.set(c.name, v);
          if (s.scope !== 'private') this.publicVars.set(c.name, v);
        }
      } else {
        for (const it of s.items) {
          const v = await this.makeVar(it, f);
          info.vars.set(it.name, v);
          if (s.scope === 'public') this.publicVars.set(it.name, v);
        }
      }
    }
    info.inited = true;
  }

  moduleFor(name: string): ModInfo | undefined {
    return this.mods.get(name.toLowerCase());
  }

  async makeVar(it: DimItem, f: Frame): Promise<Var> {
    const v = await this.makeVarBase(it, f);
    if (it.withEvents) v.ev = { name: it.name, mod: f.mod, owner: f.me };
    return v;
  }

  private async makeVarBase(it: DimItem, f: Frame): Promise<Var> {
    if (it.dims) {
      const lb: number[] = [];
      const ub: number[] = [];
      for (const d of it.dims) {
        lb.push(d.lo ? toNum(await this.eval(d.lo, f)) : f.mod.ast.optionBase);
        ub.push(toNum(await this.eval(d.hi, f)));
      }
      return { v: VArray.make(lb, ub, () => this.defaultFor(it.type, f.mod), true, it.type.name), t: it.type };
    }
    if (it.dynamic) return { v: new VArray([f.mod.ast.optionBase], [f.mod.ast.optionBase - 1], [], false, it.type.name), t: it.type };
    return { v: this.defaultFor(it.type, f.mod), t: it.type };
  }

  defaultFor(t: TypeRef, mod: ModInfo): any {
    const d = defaultOf(t);
    if (d !== null || t.name === 'object') return d;
    const udt = mod.types.get(t.name) ?? this.publicTypes.get(t.name);
    if (udt) return this.newUdt(udt, mod);
    return null;
  }

  newUdt(def: UdtDef, mod: ModInfo): VUdt {
    const m = new Map<string, unknown>();
    for (const fl of def.fields) {
      if (fl.dims) {
        const lb = fl.dims.map((d) => (d.lo ? Number((d.lo as { v?: number }).v ?? 0) : 0));
        const ub = fl.dims.map((d) => Number((d.hi as { v?: number }).v ?? 0));
        m.set(fl.name, VArray.make(lb, ub, () => this.defaultFor(fl.type, mod), true, fl.type.name));
      } else m.set(fl.name, this.defaultFor(fl.type, mod));
    }
    return new VUdt(def.name, m);
  }

  procedures(): { module: string; name: string; kind: string; isPublic: boolean; params: number }[] {
    const out: { module: string; name: string; kind: string; isPublic: boolean; params: number }[] = [];
    for (const m of this.mods.values()) for (const ps of m.procs.values()) for (const p of ps) out.push({ module: m.name, name: p.raw, kind: p.kind, isPublic: p.vis !== 'private', params: p.params.length });
    return out;
  }

  findProc(name: string, from?: ModInfo): { proc: Proc; mod: ModInfo } | undefined {
    let n = name.toLowerCase();
    let mod: ModInfo | undefined;
    const dot = n.lastIndexOf('.');
    if (dot > 0) {
      mod = this.mods.get(n.slice(0, dot));
      n = n.slice(dot + 1);
    }
    if (mod) {
      const p = mod.procs.get(n)?.find((x) => x.kind === 'sub' || x.kind === 'function');
      return p ? { proc: p, mod } : undefined;
    }
    if (from) {
      const p = from.procs.get(n)?.find((x) => x.kind === 'sub' || x.kind === 'function');
      if (p) return { proc: p, mod: from };
    }
    for (const m of this.mods.values()) {
      if (m.kind === 'class' || m.kind === 'form') continue;
      const p = m.procs.get(n)?.find((x) => (x.kind === 'sub' || x.kind === 'function') && (x.vis !== 'private' || m === from));
      if (p) return { proc: p, mod: m };
    }
    return undefined;
  }

  async runProc(name: string, args: unknown[] = [], limitMs = 0): Promise<unknown> {
    const hit = this.findProc(name);
    if (!hit) fail(1004, `Cannot run the macro '${name}'. The macro may not be available in this workbook or all macros may be disabled.`);
    this.aborted = false;
    this.deadline = limitMs ? Date.now() + limitMs : 0;
    this.lastYield = Date.now();
    try {
      return await this.callProc(hit.proc, hit.mod, null, args);
    } catch (e) {
      if (e instanceof StopRun) return undefined;
      throw e;
    } finally {
      this.flushPending();
    }
  }

  async runHandler(mod: ModInfo, name: string, args: unknown[], me: unknown): Promise<boolean> {
    const p = mod.procs.get(name.toLowerCase())?.[0];
    if (!p) return false;
    this.aborted = false;
    try {
      await this.callProc(p, mod, me, args);
    } catch (e) {
      if (!(e instanceof StopRun)) throw e;
    } finally {
      this.flushPending();
    }
    return true;
  }

  abort(): void {
    this.aborted = true;
    if (this.resumeFn) this.resumeFn('stop');
  }

  setBreakpoints(module: string, lines: number[]): void {
    this.breakpoints.set(module.toLowerCase(), new Set(lines));
  }

  get debugging(): boolean {
    return this.stepMode !== 'run' || [...this.breakpoints.values()].some((s) => s.size > 0);
  }

  startStepping(): void {
    this.stepMode = 'into';
  }

  resume(a: StepAction): void {
    const fn = this.resumeFn;
    this.resumeFn = null;
    if (a === 'stop') this.aborted = true;
    this.paused = null;
    this.stepMode = a === 'into' ? 'into' : a === 'over' ? 'over' : a === 'out' ? 'out' : 'run';
    this.stepDepth = this.stack.length;
    this.emit({ type: 'resumed' });
    fn?.(a);
  }

  async yieldNow(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0));
    this.lastYield = Date.now();
  }

  private async checkpoint(s: Stmt, f: Frame): Promise<void> {
    const bp = this.breakpoints.get(f.mod.name.toLowerCase());
    let hit = false;
    let reason: PauseInfo['reason'] = 'step';
    if (bp && bp.has(s.line)) {
      hit = true;
      reason = 'breakpoint';
    } else if (this.stepMode === 'into') hit = true;
    else if (this.stepMode === 'over' && this.stack.length <= this.stepDepth) hit = true;
    else if (this.stepMode === 'out' && this.stack.length < this.stepDepth) hit = true;
    if (!hit) return;
    const info: PauseInfo = { ...this.locOf(f, s.line), reason, stack: this.stackInfo(s.line), locals: this.localsOf(f) };
    this.paused = f;
    this.stepMode = 'run';
    const act = await new Promise<StepAction>((res) => {
      this.resumeFn = res;
      this.emit({ type: 'pause', info });
    });
    if (act === 'stop') {
      this.aborted = true;
      throw new StopRun('stop');
    }
  }

  locOf(f: Frame, line: number): Location {
    return { module: f.mod.name, proc: f.proc?.raw ?? '', line };
  }

  stackInfo(line: number): StackEntry[] {
    return this.stack
      .map((s, i) => ({ module: s.mod.name, proc: s.proc.raw, line: i === this.stack.length - 1 ? line : s.frame.line, depth: i }))
      .reverse();
  }

  localsOf(f: Frame): PauseInfo['locals'] {
    const out: PauseInfo['locals'] = [];
    for (const [k, v] of f.vars) out.push({ name: f.proc?.params.find((p) => p.name === k)?.raw ?? k, value: describeValue(v.v), type: v.t.name === 'variant' ? typeNameOf(v.v) : v.t.name });
    if (f.me instanceof VInstance) for (const [k, v] of f.me.fields) out.push({ name: `Me.${k}`, value: describeValue(v.v), type: v.t.name });
    else for (const [k, v] of f.mod.vars) if (!v.isConst) out.push({ name: `${f.mod.name}.${k}`, value: describeValue(v.v), type: v.t.name });
    return out;
  }

  async evaluateText(text: string): Promise<string> {
    const { parseImmediate, parseExpr } = await import('./parser');
    const f = this.paused ?? this.immediateFrame ?? new Frame([...this.mods.values()].find((m) => m.kind === 'std') ?? new ModInfo('Immediate', 'std', { optionExplicit: false, optionBase: 0, optionText: false, vars: [], procs: [], types: [], enums: [], implementsList: [] }), null, null);
    let captured = '';
    this.capture = '';
    try {
      const t = text.trim();
      let stmts: Stmt[] | null = null;
      try {
        stmts = parseImmediate(t);
      } catch {
        stmts = null;
      }
      if (stmts && stmts.length && !(stmts.length === 1 && stmts[0].k === 'call' && stmts[0].e.k === 'name')) {
        await this.execBlock(stmts, f);
      } else {
        const v = await this.eval(parseExpr(t), f);
        captured += `${describeValue(await this.val(v))}\n`;
      }
    } catch (e) {
      const err = this.toVbaError(e);
      captured += `Run-time error '${err.number}': ${err.description}\n`;
    } finally {
      captured = this.capture + captured;
      this.capture = null;
    }
    return captured.replace(/\n$/, '');
  }

  toVbaError(e: unknown): VbaError {
    if (e instanceof VbaError) return e;
    if (e instanceof RangeError && /call stack/i.test(e.message)) return new VbaError(28, 'Out of stack space');
    return new VbaError(1004, e instanceof Error ? e.message : String(e));
  }

  async callProc(p: Proc, mod: ModInfo, me: any, args: unknown[], mode = 0, value?: unknown): Promise<any> {
    if (this.stack.length >= 5000) fail(28, 'Out of stack space');
    if (this.stack.length % 24 === 23) await Promise.resolve();
    const f = new Frame(mod, p, me);
    const names = (args as unknown as { names?: (string | undefined)[] }).names;
    let list = args;
    if (names) {
      list = [];
      let pos = 0;
      for (let i = 0; i < args.length; i++) {
        const n = names[i];
        if (n) {
          const at = p.params.findIndex((x) => x.name === n);
          if (at < 0) fail(448, 'Named argument not found');
          list[at] = args[i];
        } else list[pos++] = args[i];
      }
      for (let i = 0; i < list.length; i++) if (!(i in list)) list[i] = MISSING;
    }
    if (mode !== 0) list = [...list, value];
    await this.bindParams(p, f, list);
    const rt = p.ret ?? { name: 'variant' };
    if (p.kind === 'function' || p.kind === 'get') {
      f.vars.set(p.name, { v: p.retArray ? new VArray([0], [-1], [], false, rt.name) : this.defaultFor(rt, mod), t: p.retArray ? { name: 'variant' } : rt });
    }
    this.stack.push({ proc: p, mod, frame: f });
    const saveMod = this.curMod;
    const saveProc = this.curProc;
    this.curMod = mod.name;
    this.curProc = p.raw;
    try {
      const sig = await this.execBlock(p.body, f);
      if (sig && sig.t === 'goto') fail(0, `Label not defined: ${sig.label}`);
    } finally {
      this.stack.pop();
      this.curMod = saveMod;
      this.curProc = saveProc;
    }
    if (p.kind === 'function' || p.kind === 'get') return f.vars.get(p.name)?.v;
    return undefined;
  }

  async bindParams(p: Proc, f: Frame, args: unknown[]): Promise<void> {
    const ps = p.params;
    const hasPA = ps.some((x) => x.paramArray);
    if (args.length > ps.length && !hasPA) fail(450);
    for (let i = 0; i < ps.length; i++) {
      const pr = ps[i];
      if (pr.paramArray) {
        const rest = args.slice(i).map((x) => (x instanceof RefArg ? x.ref.v : x));
        f.vars.set(pr.name, { v: new VArray([0], [rest.length - 1], rest, false, 'variant'), t: { name: 'variant' } });
        break;
      }
      const a = args[i];
      if (i >= args.length || a === MISSING) {
        if (!pr.optional) fail(449);
        const val = pr.def ? await this.eval(pr.def, f) : pr.type.name === 'variant' ? MISSING : this.defaultFor(pr.type, f.mod);
        f.vars.set(pr.name, { v: pr.def ? coerce(val, pr.type) : val, t: pr.type });
        continue;
      }
      if (a instanceof RefArg) {
        if (pr.byRef) {
          f.vars.set(pr.name, a.ref);
          continue;
        }
        f.vars.set(pr.name, { v: this.copyOf(this.paramValue(a.ref.v, pr)), t: pr.type });
        continue;
      }
      f.vars.set(pr.name, { v: this.copyOf(this.paramValue(a, pr)), t: pr.type });
    }
  }

  private paramValue(v: any, pr: Param): any {
    if (pr.type.name === 'variant' || pr.isArray) return v;
    if (v instanceof VArray || v instanceof VUdt) return v;
    if (isObj(v) || v === null) return v;
    return coerce(v, pr.type);
  }

  copyOf(v: any): any {
    if (v instanceof VArray) return v.clone();
    if (v instanceof VUdt) return v.clone();
    return v;
  }

  async val(v: any): Promise<any> {
    if (v === MISSING) return undefined;
    if (v !== null && typeof v === 'object' && v instanceof HostObject && v.defaultProp !== null) return this.val(await v.member(v.defaultProp, [], 0));
    return v;
  }

  private labels(block: Stmt[]): Map<string, number> {
    let m = this.labelCache.get(block);
    if (!m) {
      m = new Map();
      block.forEach((s, i) => {
        if (s.k === 'label') m!.set(s.name, i);
      });
      this.labelCache.set(block, m);
    }
    return m;
  }

  async execBlock(stmts: Stmt[], f: Frame): Promise<Signal | undefined> {
    let i = 0;
    while (i < stmts.length) {
      const s = stmts[i];
      let sig: Signal | undefined;
      if (f.proc && stmts === f.proc.body) f.topIdx = i;
      try {
        sig = await this.exec(s, f);
      } catch (e) {
        if (e instanceof StopRun || this.aborted) throw e;
        const verr = this.toVbaError(e);
        if (!this.lastLoc || this.lastLoc.line === 0 || (verr as { located?: boolean }).located !== true) {
          this.lastLoc = this.locOf(f, s.line);
          (verr as { located?: boolean }).located = true;
        }
        if (f.inHandler || f.onErr.mode === 'none') throw verr;
        this.err.set(verr);
        if (f.onErr.mode === 'next') {
          i++;
          continue;
        }
        f.failed = { block: stmts, idx: i };
        f.failedTop = f.topIdx;
        f.inHandler = true;
        sig = { t: 'goto', label: f.onErr.label };
      }
      if (sig) {
        if (sig.t === 'goto') {
          const at = this.labels(stmts).get(sig.label);
          if (at !== undefined) {
            i = at;
            continue;
          }
        } else if (sig.t === 'jump' && sig.block === stmts) {
          i = sig.idx;
          continue;
        }
        return sig;
      }
      i++;
    }
    return undefined;
  }

  private async exec(s: Stmt, f: Frame): Promise<Signal | undefined> {
    f.line = s.line;
    this.curLine = s.line;
    if ((++this.ticks & 0x1ff) === 0) {
      if (this.aborted) throw new StopRun('stop');
      const now = Date.now();
      if (this.deadline && now > this.deadline) {
        this.aborted = true;
        fail(1004, 'The macro ran longer than its time limit and was stopped.');
      }
      if (now - this.lastYield > 40) await this.yieldNow();
    }
    if (this.stepMode !== 'run' || this.breakpoints.size) await this.checkpoint(s, f);
    switch (s.k) {
      case 'nop':
      case 'label':
        return undefined;
      case 'dim':
        await this.execDim(s, f);
        return undefined;
      case 'const':
        for (const c of s.items) {
          const raw = await this.eval(c.value, f);
          f.vars.set(c.name, { v: c.type ? coerce(raw, c.type) : raw, t: c.type ?? { name: 'variant' }, isConst: true });
        }
        return undefined;
      case 'redim':
        await this.execRedim(s, f);
        return undefined;
      case 'erase':
        for (const t of s.names) {
          const ref = await this.refOf(t, f);
          if (ref && ref.v instanceof VArray) {
            const a: VArray = ref.v;
            if (a.fixed) a.data = a.data.map(() => this.defaultFor({ name: a.elType }, f.mod));
            else ref.v = new VArray([a.lb[0]], [a.lb[0] - 1], [], false, a.elType);
          }
        }
        return undefined;
      case 'assign': {
        let v = await this.eval(s.value, f);
        if (!s.isSet) v = await this.val(v);
        else if (v === MISSING) v = undefined;
        await this.assignTo(s.target, v, s.isSet, f);
        return undefined;
      }
      case 'call': {
        await this.evalStatementCall(s.e, f);
        return undefined;
      }
      case 'if': {
        if (toBool(await this.val(await this.eval(s.cond, f)))) return this.execBlock(s.then, f);
        for (const ei of s.elifs) if (toBool(await this.val(await this.eval(ei.cond, f)))) return this.execBlock(ei.body, f);
        if (s.else) return this.execBlock(s.else, f);
        return undefined;
      }
      case 'select':
        return this.execSelect(s, f);
      case 'for':
        return this.execFor(s, f);
      case 'foreach':
        return this.execForEach(s, f);
      case 'do':
        return this.execDo(s, f);
      case 'with': {
        const o = await this.eval(s.o, f);
        f.withs.push(o);
        try {
          return await this.execBlock(s.body, f);
        } finally {
          f.withs.pop();
        }
      }
      case 'raise': {
        const target = s.e.k === 'call' ? s.e.t : s.e;
        if (target.k !== 'name') fail(1004, 'Invalid RaiseEvent');
        const args = s.e.k === 'call' ? await this.evalArgs(s.e.a, f) : [];
        const self = f.me;
        if (self instanceof VInstance) {
          for (const ref of [...self.subs]) {
            const ev = ref.ev;
            const p = ev?.mod.procs.get(`${ev.name}_${target.n}`)?.[0];
            if (ev && p) await this.callProc(p, ev.mod, ev.owner, args);
          }
        }
        return undefined;
      }
      case 'goto':
        return { t: 'goto', label: s.label };
      case 'gosub':
        return fail(3, 'GoSub is not supported');
      case 'return':
        return { t: 'return' };
      case 'onerror':
        f.inHandler = false;
        f.onErr = { mode: s.mode === 'zero' ? 'none' : s.mode, label: s.label };
        if (s.mode === 'zero') this.err.clear();
        return undefined;
      case 'resume': {
        const fl = f.failed;
        f.inHandler = false;
        this.err.clear();
        if (s.mode === 'label') return { t: 'goto', label: s.label };
        if (!fl) fail(20);
        f.failed = null;
        const top = f.proc ? f.proc.body : fl.block;
        if (fl.block !== top) return { t: 'jump', block: top, idx: s.mode === 'next' ? f.failedTop + 1 : f.failedTop };
        return { t: 'jump', block: fl.block, idx: s.mode === 'next' ? fl.idx + 1 : fl.idx };
      }
      case 'exit':
        return { t: 'exit', what: s.what };
      case 'end':
        throw new StopRun('end');
      case 'stop':
        if (this.debugging || this.listeners.length) {
          this.stepMode = 'into';
        }
        return undefined;
      case 'print':
        await this.execPrint(s, f);
        return undefined;
      default:
        return undefined;
    }
  }

  private async execPrint(s: Extract<Stmt, { k: 'print' }>, f: Frame): Promise<void> {
    if (!s.debug) fail(52, 'Bad file name or number');
    let line = this.pending;
    this.pending = '';
    let col = 0;
    for (const it of s.items) {
      if (it.e) {
        const v = await this.val(await this.eval(it.e, f));
        if (v && typeof v === 'object' && 'tabTo' in v) {
          const to = (v as { tabTo: number }).tabTo;
          if (to > line.length) line += ' '.repeat(to - line.length);
        } else {
          let t: string;
          if (v === undefined) t = '';
          else if (v === NULLV) t = 'Null';
          else if (v instanceof VError) t = `Error ${v.code}`;
          else if (typeof v === 'number') t = `${v >= 0 ? ' ' : ''}${toStr(v)} `;
          else t = toStr(v);
          line += t;
        }
      }
      col = line.length;
      if (it.sep === ',') line += ' '.repeat(14 - (col % 14));
    }
    const last = s.items[s.items.length - 1];
    if (last && (last.sep === ';' || last.sep === ',')) this.pending = line;
    else this.out(line.replace(/ +$/, ''));
  }

  flushPending(): void {
    if (!this.pending) return;
    this.out(this.pending.replace(/ +$/, ''));
    this.pending = '';
  }

  private async execDim(s: Extract<Stmt, { k: 'dim' }>, f: Frame): Promise<void> {
    for (const it of s.items) {
      if (s.scope === 'static' && f.proc) {
        const key = `${f.mod.name}.${f.proc.name}.${it.name}`;
        let v = this.statics.get(key);
        if (!v) {
          v = await this.makeVar(it, f);
          this.statics.set(key, v);
        }
        f.vars.set(it.name, v);
        continue;
      }
      const v = await this.makeVar(it, f);
      f.vars.set(it.name, v);
    }
  }

  statics = new Map<string, Var>();

  private async execRedim(s: Extract<Stmt, { k: 'redim' }>, f: Frame): Promise<void> {
    for (const it of s.items) {
      const lb: number[] = [];
      const ub: number[] = [];
      for (const d of it.dims) {
        lb.push(d.lo ? toNum(await this.eval(d.lo, f)) : f.mod.ast.optionBase);
        ub.push(toNum(await this.eval(d.hi, f)));
      }
      const ref = await this.refOf(it.target, f, true);
      if (!ref) fail(35, 'Variable not defined');
      const old = ref.v instanceof VArray ? (ref.v as VArray) : null;
      const et = it.type ? it.type.name : old ? old.elType : ref.t.name === 'variant' ? 'variant' : ref.t.name;
      if (old && old.fixed && old.data.length) fail(10);
      const na = VArray.make(lb, ub, () => this.defaultFor({ name: et }, f.mod), false, et);
      if (s.preserve && old && old.data.length && old.dims === na.dims) {
        const idx = new Array<number>(na.dims).fill(0);
        const walk = (d: number) => {
          if (d === na.dims) {
            na.data[na.offset(idx)] = old.data[old.offset(idx)];
            return;
          }
          const lo = Math.max(old.lb[d], na.lb[d]);
          const hi = Math.min(old.ub[d], na.ub[d]);
          for (let k = lo; k <= hi; k++) {
            idx[d] = k;
            walk(d + 1);
          }
        };
        walk(0);
      }
      ref.v = na;
    }
  }

  private async execSelect(s: Extract<Stmt, { k: 'select' }>, f: Frame): Promise<Signal | undefined> {
    const v = await this.val(await this.eval(s.e, f));
    const text = f.mod.ast.optionText;
    for (const c of s.cases) {
      if (c.tests === null) return this.execBlock(c.body, f);
      for (const t of c.tests) {
        if (await this.caseMatch(t, v, f, text)) return this.execBlock(c.body, f);
      }
    }
    return undefined;
  }

  private async caseMatch(t: CaseTest, v: any, f: Frame, text: boolean): Promise<boolean> {
    if (t.t === 'val') {
      const x = await this.val(await this.eval(t.e, f));
      return compare(v, x, text) === 0;
    }
    if (t.t === 'range') {
      const lo = await this.val(await this.eval(t.lo, f));
      const hi = await this.val(await this.eval(t.hi, f));
      const a = compare(v, lo, text);
      const b = compare(v, hi, text);
      return a !== null && b !== null && a >= 0 && b <= 0;
    }
    const x = await this.val(await this.eval(t.e, f));
    const c = compare(v, x, text);
    if (c === null) return false;
    return t.op === '=' ? c === 0 : t.op === '<>' ? c !== 0 : t.op === '<' ? c < 0 : t.op === '>' ? c > 0 : t.op === '<=' ? c <= 0 : c >= 0;
  }

  private async execFor(s: Extract<Stmt, { k: 'for' }>, f: Frame): Promise<Signal | undefined> {
    const from = toNum(await this.val(await this.eval(s.from, f)));
    const to = toNum(await this.val(await this.eval(s.to, f)));
    const step = s.step ? toNum(await this.val(await this.eval(s.step, f))) : 1;
    const ref = await this.refOf(s.v, f, true);
    if (!ref) fail(35, 'Variable not defined');
    const t = ref.t;
    ref.v = t.name === 'variant' ? from : coerce(from, t);
    for (;;) {
      const cur = toNum(ref.v);
      if (step > 0 ? cur > to : step < 0 ? cur < to : false) break;
      const sig = await this.execBlock(s.body, f);
      if (sig) {
        if (sig.t === 'exit' && sig.what === 'for') break;
        return sig;
      }
      await this.endMark(s.endLine, f);
      const next = toNum(ref.v) + step;
      ref.v = t.name === 'variant' ? next : coerce(next, t);
      if (step === 0 && (++this.ticks & 0xfff) === 0) await this.yieldNow();
    }
    return undefined;
  }

  private async execForEach(s: Extract<Stmt, { k: 'foreach' }>, f: Frame): Promise<Signal | undefined> {
    const coll = await this.eval(s.coll, f);
    const items = await this.enumerate(coll);
    const ref = await this.refOf(s.v, f, true);
    if (!ref) fail(35, 'Variable not defined');
    for (const it of items) {
      ref.v = ref.t.name === 'variant' || isObj(it) ? it : coerce(it, ref.t);
      const sig = await this.execBlock(s.body, f);
      if (sig) {
        if (sig.t === 'exit' && sig.what === 'for') break;
        return sig;
      }
      await this.endMark(s.endLine, f);
    }
    return undefined;
  }

  private async endMark(line: number, f: Frame): Promise<void> {
    if (this.stepMode !== 'run' || this.breakpoints.size) await this.checkpoint({ k: 'nop', line }, f);
  }

  async enumerate(coll: any): Promise<unknown[]> {
    if (coll instanceof VArray) {
      if (coll.dims === 1) return [...coll.data];
      const out: unknown[] = [];
      const idx = coll.lb.slice();
      const total = coll.data.length;
      for (let n = 0; n < total; n++) {
        out.push(coll.get(idx));
        for (let d = 0; d < coll.dims; d++) {
          if (++idx[d] <= coll.ub[d]) break;
          idx[d] = coll.lb[d];
        }
      }
      return out;
    }
    if (coll instanceof HostObject && coll.enumerate) return coll.enumerate();
    if (coll instanceof VInstance) {
      const e = coll.mod.procs.get('_newenum');
      if (e) fail(438);
    }
    return fail(438, 'For Each requires an array or collection object');
  }

  private async execDo(s: Extract<Stmt, { k: 'do' }>, f: Frame): Promise<Signal | undefined> {
    for (;;) {
      if (s.cond && !s.post) {
        const c = toBool(await this.val(await this.eval(s.cond, f)));
        if (s.until ? c : !c) break;
      }
      const sig = await this.execBlock(s.body, f);
      if (sig) {
        if (sig.t === 'exit' && sig.what === 'do') break;
        return sig;
      }
      await this.endMark(s.endLine, f);
      if (s.cond && s.post) {
        const c = toBool(await this.val(await this.eval(s.cond, f)));
        if (s.until ? c : !c) break;
      }
      if (!s.cond && (++this.ticks & 0xfff) === 0) await this.yieldNow();
    }
    return undefined;
  }

  lookupVar(name: string, f: Frame): Var | undefined {
    const v = f.vars.get(name);
    if (v) return v;
    if (f.me instanceof VInstance) {
      const fv = f.me.fields.get(name);
      if (fv) return fv;
    }
    const mv = f.mod.vars.get(name);
    if (mv) return mv;
    return this.publicVars.get(name);
  }

  private async refOf(node: Expr, f: Frame, create = false): Promise<Var | null> {
    if (node.k === 'paren') return null;
    if (node.k === 'name') {
      const v = this.lookupVar(node.n, f);
      if (v) {
        if (v.t.isNew && v.v === null) v.v = await this.instantiate(v.t.name, f);
        return v;
      }
      if (create) {
        if (f.mod.ast.optionExplicit) fail(35, `Variable not defined: ${node.raw}`);
        const nv: Var = { v: undefined, t: { name: 'variant' } };
        f.vars.set(node.n, nv);
        return nv;
      }
      return null;
    }
    if (node.k === 'mem') {
      const o = node.o ? await this.eval(node.o, f) : this.withTop(f);
      if (o instanceof VUdt) {
        if (!o.fields.has(node.n)) return null;
        return {
          get v() {
            return o.fields.get(node.n);
          },
          set v(x: any) {
            o.fields.set(node.n, x);
          },
          t: { name: 'variant' },
        } as Var;
      }
      if (o instanceof VInstance) {
        const fv = o.fields.get(node.n);
        return fv ?? null;
      }
      if (o instanceof ModuleRef) return o.mod.vars.get(node.n) ?? null;
      return null;
    }
    if (node.k === 'call') {
      let base: any = null;
      if (node.t.k === 'name') base = this.lookupVar(node.t.n, f)?.v;
      else if (node.t.k === 'mem') base = (await this.refOf(node.t, f))?.v;
      if (base instanceof VArray) {
        const idx = await this.evalIdx(node.a, f);
        const et: TypeRef = { name: base.elType };
        const off = base.offset(idx);
        return {
          get v() {
            return base.data[off];
          },
          set v(x: any) {
            base.data[off] = x;
          },
          t: et,
        } as Var;
      }
    }
    return null;
  }

  private async evalIdx(args: { e: Expr | null }[], f: Frame): Promise<number[]> {
    const out: number[] = [];
    for (const a of args) out.push(Math.round(toNum(await this.val(await this.eval(a.e as Expr, f)))));
    return out;
  }

  private async evalTarget(t: Expr, f: Frame): Promise<any> {
    if (t.k === 'name') {
      const v = this.lookupVar(t.n, f);
      if (v) return v.v;
    }
    return this.eval(t, f);
  }

  withTop(f: Frame): any {
    if (!f.withs.length) fail(91);
    return f.withs[f.withs.length - 1];
  }

  async assignTo(target: Expr, v: any, isSet: boolean, f: Frame): Promise<void> {
    switch (target.k) {
      case 'name': {
        let ref = this.lookupVar(target.n, f);
        if (!ref) {
          if (f.proc && f.proc.name === target.n) ref = f.vars.get(target.n);
          if (!ref) {
            if (f.mod.ast.optionExplicit) fail(35, `Variable not defined: ${target.raw}`);
            ref = { v: undefined, t: { name: 'variant' } };
            f.vars.set(target.n, ref);
          }
        }
        if (ref.isConst) fail(1004, 'Cannot assign to a constant');
        if (isSet) {
          if (v === null && ref.v instanceof VInstance) await this.terminate(ref.v);
          if (v !== null && !isObj(v) && ref.t.name !== 'variant') fail(91);
          if (ref.ev) {
            if (ref.v instanceof VInstance) ref.v.subs = ref.v.subs.filter((s) => s !== ref);
            if (v instanceof VInstance) v.subs.push(ref);
          }
          ref.v = v;
          return;
        }
        if (v instanceof VArray || v instanceof VUdt) {
          ref.v = v.clone();
          return;
        }
        ref.v = this.coerceFor(ref.t, v, ref.v);
        return;
      }
      case 'mem': {
        const o = target.o ? await this.eval(target.o, f) : this.withTop(f);
        await this.setMember(o, target.n, [], v, isSet, f);
        return;
      }
      case 'bang': {
        const o = target.o ? await this.eval(target.o, f) : this.withTop(f);
        await this.setMember(o, '', [target.n], v, isSet, f);
        return;
      }
      case 'call': {
        const t = target.t;
        if (t.k === 'name' && t.n === 'mid' && !this.lookupVar('mid', f)) {
          const ref = await this.refOf(target.a[0].e as Expr, f);
          if (!ref) fail(35);
          const s = toStr(ref.v);
          const st = toNum(await this.eval(target.a[1].e as Expr, f)) - 1;
          const len = target.a[2] ? toNum(await this.eval(target.a[2].e as Expr, f)) : s.length - st;
          const rep = toStr(v).slice(0, Math.min(len, toStr(v).length, s.length - st));
          ref.v = s.slice(0, st) + rep + s.slice(st + rep.length);
          return;
        }
        if (t.k === 'mem') {
          const o = t.o ? await this.eval(t.o, f) : this.withTop(f);
          const args = await this.evalArgs(target.a, f);
          await this.setMember(o, t.n, args, v, isSet, f);
          return;
        }
        const base = await this.evalTarget(t, f);
        const args = await this.evalArgs(target.a, f);
        if (base instanceof VArray) {
          const idx = args.map((x) => Math.round(toNum(x)));
          base.set(idx, base.elType !== 'variant' && !isObj(v) ? coerce(v, { name: base.elType }) : v);
          return;
        }
        if (base instanceof HostObject) {
          if (!isSet && base.defaultProp === null) {
            const target = await base.member('', args, 0);
            if (target instanceof HostObject && target.defaultProp) {
              await target.member(target.defaultProp, [], 1, v);
              return;
            }
          }
          await base.member('', args, isSet ? 2 : 1, v);
          return;
        }
        if (base instanceof VInstance) {
          await this.instanceMember(base, '', args, isSet ? 2 : 1, v, f);
          return;
        }
        fail(13);
      }
      default:
        fail(1004, 'Invalid assignment target');
    }
  }

  coerceFor(t: TypeRef, v: any, _old: any): any {
    if (t.name === 'variant') return v;
    return coerce(v, t);
  }

  async terminate(inst: VInstance): Promise<void> {
    if (inst.terminated) return;
    inst.terminated = true;
    const p = inst.mod.procs.get('class_terminate')?.[0];
    if (p) await this.callProc(p, inst.mod, inst, []);
  }

  async setMember(o: any, name: string, args: unknown[], v: any, isSet: boolean, f: Frame): Promise<void> {
    if (o === null || o === undefined) fail(91);
    if (o instanceof HostObject) {
      if (!isSet && args.length && ITEM_MEMBERS.has(name)) {
        const target = await o.member(name, args, 0);
        if (target instanceof HostObject && target.defaultProp) {
          await target.member(target.defaultProp, [], 1, v);
          return;
        }
      }
      await o.member(name, args, isSet ? 2 : 1, v);
      return;
    }
    if (o instanceof VInstance) {
      await this.instanceMember(o, name, args, isSet ? 2 : 1, v, f);
      return;
    }
    if (o instanceof VUdt) {
      if (!o.fields.has(name)) fail(438);
      const cur = o.fields.get(name);
      if (args.length && cur instanceof VArray) {
        cur.set(args.map((x) => Math.round(toNum(x))), v);
        return;
      }
      o.fields.set(name, v instanceof VArray ? v.clone() : v);
      return;
    }
    fail(424);
  }

  async getMember(o: any, name: string, args: unknown[], f: Frame): Promise<any> {
    if (o === null) fail(91);
    if (o === undefined || o === MISSING) fail(424);
    if (o instanceof HostObject) return o.member(name, args, 0);
    if (o instanceof VInstance) return this.instanceMember(o, name, args, 0, undefined, f);
    if (o instanceof VUdt) {
      const v = o.fields.get(name);
      if (v === undefined && !o.fields.has(name)) fail(438);
      if (args.length && v instanceof VArray) return v.get(args.map((x) => Math.round(toNum(x))));
      return v;
    }
    if (o instanceof VArray) fail(424);
    fail(424);
  }

  async instanceMember(o: VInstance, name: string, args: unknown[], mode: 0 | 1 | 2, value: any, f: Frame): Promise<any> {
    const ps = o.mod.procs.get(name);
    const inside = f.me === o || f.mod === o.mod;
    if (ps) {
      const vis = ps.filter((p) => inside || p.vis !== 'private');
      if (vis.length) return this.callByMode(vis, o.mod, o, args, mode, value);
    }
    for (const iface of o.mod.ast.implementsList) {
      const via = o.mod.procs.get(`${iface.toLowerCase()}_${name}`);
      if (via) return this.callByMode(via, o.mod, o, args, mode, value);
    }
    const fv = o.fields.get(name);
    if (fv && (inside || o.mod.ast.vars.some((s) => s.k === 'dim' && s.scope === 'public' && s.items.some((i) => i.name === name)))) {
      if (mode === 0) return args.length ? this.indexValue(fv.v, args) : fv.v;
      fv.v = mode === 2 ? value : this.coerceFor(fv.t, value, fv.v);
      return undefined;
    }
    if (name === '' && mode === 0) fail(438);
    return fail(438);
  }

  async callByMode(ps: Proc[], mod: ModInfo, me: any, args: unknown[], mode: 0 | 1 | 2 | number, value?: unknown): Promise<any> {
    const want = mode === 0 ? ['sub', 'function', 'get'] : mode === 1 ? ['let', 'set'] : ['set', 'let'];
    let p: Proc | undefined;
    for (const k of want) {
      p = ps.find((x) => x.kind === k);
      if (p) break;
    }
    if (!p) fail(438);
    if (mode === 0 || p.kind === 'sub' || p.kind === 'function' || p.kind === 'get') return this.callProc(p, mod, me, args);
    return this.callProc(p, mod, me, args, 1, value);
  }

  async indexValue(base: any, args: unknown[]): Promise<any> {
    if (base instanceof VArray) return base.get(args.map((x) => Math.round(toNum(x))));
    if (base instanceof HostObject) return base.member('', args, 0);
    if (base instanceof VInstance) return this.instanceMember(base, '', args, 0, undefined, new Frame(base.mod, null, base));
    if (base === null) fail(91);
    return fail(13);
  }

  async instantiate(cls: string, _f?: Frame): Promise<any> {
    const m = this.mods.get(cls);
    if (m && (m.kind === 'class' || m.kind === 'form')) return this.newInstance(m);
    switch (cls) {
      case 'collection':
        return new VCollection();
      case 'dictionary':
        return new VDictionary();
      case 'regexp':
        return new VRegExp();
      default:
    }
    return this.extraCreate(cls);
  }

  async newInstance(m: ModInfo): Promise<VInstance> {
    const inst = new VInstance(m);
    const f = new Frame(m, null, inst);
    for (const s of m.ast.vars) {
      if (s.k === 'const') {
        for (const c of s.items) inst.fields.set(c.name, { v: await this.eval(c.value, f), t: c.type ?? { name: 'variant' }, isConst: true });
      } else for (const it of s.items) inst.fields.set(it.name, await this.makeVar(it, f));
    }
    for (const en of m.ast.enums) for (const [k, v] of m.enums.get(en.name) ?? []) inst.fields.set(k, { v, t: { name: 'long' }, isConst: true });
    const init = m.procs.get('class_initialize')?.[0];
    if (init) await this.callProc(init, m, inst, []);
    return inst;
  }

  createObject(progId: string): any {
    const p = progId.toLowerCase();
    if (p === 'scripting.dictionary') return new VDictionary();
    if (p === 'vbscript.regexp') return new VRegExp();
    return this.extraCreate(p);
  }

  async callByName(obj: any, name: string, mode: number, args: unknown[]): Promise<any> {
    const f = new Frame([...this.mods.values()][0], null, null);
    const n = name.toLowerCase();
    if (mode === 4 || mode === 8) {
      await this.setMember(obj, n, args.slice(0, -1), args[args.length - 1], mode === 8, f);
      return undefined;
    }
    return this.getMember(obj, n, args, f);
  }

  async evalArgs(args: { e: Expr | null; name?: string }[], f: Frame, target?: Proc): Promise<any[]> {
    const out: any[] = [];
    const names: (string | undefined)[] = [];
    let any = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.e === null) {
        out.push(MISSING);
        names.push(undefined);
        continue;
      }
      let v: any;
      if (target) {
        const pidx = a.name ? target.params.findIndex((p) => p.name === a.name) : i;
        const pr = target.params[pidx] ?? (target.params.length && target.params[target.params.length - 1].paramArray ? target.params[target.params.length - 1] : undefined);
        if (pr && pr.byRef && !pr.paramArray && a.e.k !== 'paren') {
          const r = await this.refOf(a.e, f);
          v = r ? new RefArg(r) : await this.eval(a.e, f);
        } else if (pr && pr.paramArray && a.e.k !== 'paren') {
          const r = await this.refOf(a.e, f);
          v = r ? new RefArg(r) : await this.eval(a.e, f);
        } else v = await this.eval(a.e, f);
      } else v = await this.eval(a.e, f);
      out.push(v);
      names.push(a.name);
      if (a.name) any = true;
    }
    if (any) (out as unknown as { names: (string | undefined)[] }).names = names;
    return out;
  }

  private async evalStatementCall(e: Expr, f: Frame): Promise<void> {
    await this.eval(e, f);
  }

  async eval(e: Expr, f: Frame): Promise<any> {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'str':
        return e.v;
      case 'lit':
        return e.v;
      case 'paren': {
        const v = await this.eval(e.e, f);
        return v;
      }
      case 'name':
        return this.evalName(e, f);
      case 'mem': {
        const o = e.o ? await this.eval(e.o, f) : this.withTop(f);
        return this.getMember(o, e.n, [], f);
      }
      case 'bang': {
        const o = e.o ? await this.eval(e.o, f) : this.withTop(f);
        return this.getMember(o, '', [e.n], f);
      }
      case 'call':
        return this.evalCall(e, f);
      case 'bin':
        return this.evalBin(e, f);
      case 'un': {
        const v = await this.val(await this.eval(e.e, f));
        if (e.op === 'neg') {
          if (v === NULLV) return NULLV;
          if (v instanceof VDate) return -v.serial;
          return -toNum(v);
        }
        if (v === NULLV) return NULLV;
        if (typeof v === 'boolean') return !v;
        const n = toNum(v);
        return ~Math.trunc(n);
      }
      case 'new':
        return this.instantiate(e.cls, f);
      case 'typeof': {
        const v = await this.eval(e.e, f);
        return this.isTypeOf(v, e.t);
      }
      case 'addr':
        return e.n;
      default:
        return undefined;
    }
  }

  isTypeOf(v: any, t: string): boolean {
    if (v === null || v === undefined) return false;
    if (t === 'object') return true;
    if (v instanceof VInstance) return v.typeName.toLowerCase() === t || v.mod.ast.implementsList.some((x) => x.toLowerCase() === t);
    const n = typeNameOf(v).toLowerCase();
    return n === t || (t === 'worksheet' && n === 'worksheet') || (t === 'range' && n === 'range');
  }

  private async evalName(e: Extract<Expr, { k: 'name' }>, f: Frame): Promise<any> {
    const n = e.n;
    const v = this.lookupVar(n, f);
    if (v) {
      if (v.t.isNew && v.v === null) v.v = await this.instantiate(v.t.name, f);
      return v.v;
    }
    if (n === 'me') {
      if (f.me !== null && f.me !== undefined) return f.me;
      if (f.mod.kind === 'document' || f.mod.kind === 'form') return this.docObject(f.mod);
      return fail(1004, 'Invalid use of Me keyword');
    }
    const pr = this.resolveProc(n, f);
    if (pr) return this.callProc(pr.proc[0], pr.mod, pr.mod === f.mod ? f.me : null, []);
    if (n in this.consts) return this.consts[n];
    const g = this.globals.get(n);
    if (g) return g(f);
    const b = BUILTINS[n];
    if (b) return b([], this.bctx);
    if (n === 'err') return this.err;
    if (n === 'debug') return this.debugObj;
    const mod = this.mods.get(n);
    if (mod) return new ModuleRef(mod, this);
    for (const m of this.mods.values()) for (const [en, members] of m.enums) if (en === n) return enumObject(members);
    if (f.mod.ast.optionExplicit) fail(35, `Variable not defined: ${e.raw}`);
    fail(35, `Sub or Function not defined: ${e.raw}`);
  }

  docObject: (m: ModInfo) => any = () => null;

  private resolveProc(n: string, f: Frame): { proc: Proc[]; mod: ModInfo } | undefined {
    const own = f.mod.procs.get(n);
    if (own) {
      const ok = own.filter((p) => p.kind === 'sub' || p.kind === 'function');
      if (ok.length) return { proc: ok, mod: f.mod };
    }
    const pub = this.publicProcs.get(n);
    if (pub) {
      const ok = pub.proc.filter((p) => p.kind === 'sub' || p.kind === 'function');
      if (ok.length) return { proc: ok, mod: pub.mod };
    }
    return undefined;
  }

  private async evalCall(e: Extract<Expr, { k: 'call' }>, f: Frame): Promise<any> {
    const t = e.t;
    if (t.k === 'name') {
      const n = t.n;
      let v = this.lookupVar(n, f);
      if (v && f.proc && f.proc.name === n && !f.proc.retArray && f.vars.get(n) === v && f.proc.kind !== 'sub') v = undefined;
      if (v) {
        if (v.t.isNew && v.v === null) v.v = await this.instantiate(v.t.name, f);
        const args = await this.evalArgs(e.a, f);
        return this.indexValue(await this.val0(v.v), args.map((x) => (x instanceof RefArg ? x.ref.v : x)));
      }
      const pr = this.resolveProc(n, f);
      if (pr) {
        const proc = pr.proc.find((p) => p.params.length >= e.a.length || p.params.some((x) => x.paramArray)) ?? pr.proc[0];
        const args = await this.evalArgs(e.a, f, proc);
        return this.callProc(proc, pr.mod, pr.mod === f.mod ? f.me : null, args);
      }
      if (n === 'err') {
        return this.err.member('', await this.evalArgs(e.a, f), 0);
      }
      const b = BUILTINS[n];
      if (n === 'typename' && e.a.length === 1 && e.a[0].e?.k === 'name') {
        const ref = this.lookupVar(e.a[0].e.n, f);
        const declared = ref ? DECLARED[ref.t.name] : undefined;
        if (declared && !(ref?.v instanceof VArray)) return declared;
      }
      if (b && !this.globals.has(n)) {
        const raw = await this.evalArgs(e.a, f);
        const args: any[] = [];
        for (let i = 0; i < raw.length; i++) args.push(raw[i] instanceof RefArg ? raw[i].ref.v : await this.val(raw[i]));
        const nm = (raw as unknown as { names?: unknown }).names;
        if (nm) (args as unknown as { names: unknown }).names = nm;
        if (n === 'ismissing') return (raw[0] instanceof RefArg ? raw[0].ref.v : raw[0]) === MISSING;
        return b(args, this.bctx);
      }
      const g = this.globals.get(n);
      if (g) {
        const o = g(f);
        const args = await this.evalArgs(e.a, f);
        return this.indexValue(o, args);
      }
      const mod = this.mods.get(n);
      if (mod) return fail(13);
      fail(35, `Sub or Function not defined: ${t.raw}`);
    }
    if (t.k === 'mem') {
      const o = t.o ? await this.eval(t.o, f) : this.withTop(f);
      let target: Proc | undefined;
      if (o instanceof VInstance) target = o.mod.procs.get(t.n)?.find((p) => p.kind === 'sub' || p.kind === 'function' || p.kind === 'get');
      else if (o instanceof ModuleRef) target = o.mod.procs.get(t.n)?.[0];
      const args = await this.evalArgs(e.a, f, target);
      return this.getMember(o, t.n, args, f);
    }
    const base = await this.eval(t, f);
    const args = await this.evalArgs(e.a, f);
    return this.indexValue(await this.val0(base), args.map((x) => (x instanceof RefArg ? x.ref.v : x)));
  }

  private async val0(v: any): Promise<any> {
    return v;
  }

  private async evalBin(e: Extract<Expr, { k: 'bin' }>, f: Frame): Promise<any> {
    const op = e.op;
    if (op === 'and' || op === 'or') {
      const l = await this.val(await this.eval(e.l, f));
      if (typeof l === 'boolean') {
        if (op === 'and' && !l) {
          await this.val(await this.eval(e.r, f));
          return false;
        }
        if (op === 'or' && l) {
          await this.val(await this.eval(e.r, f));
          return true;
        }
      }
      const r = await this.val(await this.eval(e.r, f));
      return logical(op, l, r);
    }
    if (op === 'is') {
      const l = await this.eval(e.l, f);
      const r = await this.eval(e.r, f);
      if (l === null || r === null) return l === r;
      if (l instanceof HostObject && r instanceof HostObject && l.identity && r.identity) return l.identity() === r.identity();
      return l === r;
    }
    const l = await this.val(await this.eval(e.l, f));
    const r = await this.val(await this.eval(e.r, f));
    switch (op) {
      case '+': {
        if (l === NULLV || r === NULLV) return NULLV;
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        if (l instanceof VDate && !(r instanceof VDate)) return new VDate(l.serial + toNum(r));
        if (r instanceof VDate && !(l instanceof VDate)) return new VDate(toNum(l) + r.serial);
        if (l instanceof VDate && r instanceof VDate) return new VDate(l.serial + r.serial);
        if (typeof l === 'string' || typeof r === 'string') {
          if ((typeof l === 'string' && l !== '' && !numeric(l)) || (typeof r === 'string' && r !== '' && !numeric(r))) {
            if (typeof l === 'string' && typeof r === 'string') return l + r;
            fail(13);
          }
        }
        return toNum(l) + toNum(r);
      }
      case '-': {
        if (l === NULLV || r === NULLV) return NULLV;
        if (l instanceof VDate && r instanceof VDate) return l.serial - r.serial;
        if (l instanceof VDate) return new VDate(l.serial - toNum(r));
        return toNum(l) - toNum(r);
      }
      case '*':
        if (l === NULLV || r === NULLV) return NULLV;
        return toNum(l) * toNum(r);
      case '/': {
        if (l === NULLV || r === NULLV) return NULLV;
        const d = toNum(r);
        if (d === 0) fail(11);
        return toNum(l) / d;
      }
      case '\\': {
        if (l === NULLV || r === NULLV) return NULLV;
        const d = Math.round(toNum(r));
        if (d === 0) fail(11);
        return Math.trunc(Math.round(toNum(l)) / d);
      }
      case 'mod': {
        if (l === NULLV || r === NULLV) return NULLV;
        const d = Math.round(toNum(r));
        if (d === 0) fail(11);
        const n = Math.round(toNum(l));
        return n % d;
      }
      case '^': {
        if (l === NULLV || r === NULLV) return NULLV;
        return Math.pow(toNum(l), toNum(r));
      }
      case '&': {
        const a = l === NULLV || l === undefined ? '' : l instanceof VError ? fail(13) : toStr(l);
        const b = r === NULLV || r === undefined ? '' : r instanceof VError ? fail(13) : toStr(r);
        return a + b;
      }
      case '=':
      case '<>':
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const c = compare(l, r, this.curModeOf(f));
        if (c === null) return NULLV;
        return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
      }
      case 'like': {
        if (l === NULLV || r === NULLV) return NULLV;
        return likePattern(toStr(r), this.curModeOf(f)).test(toStr(l));
      }
      case 'xor':
      case 'eqv':
      case 'imp':
        return logical(op, l, r);
      default:
        return fail(1004, `Unknown operator ${op}`);
    }
  }

  private curModeOf(f: Frame): boolean {
    return f.mod.ast.optionText;
  }
}

function numeric(s: string): boolean {
  return /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(s);
}

function logical(op: string, l: any, r: any): any {
  if (l === NULLV || r === NULLV) {
    if (op === 'and') return (l === false || r === false) ? false : NULLV;
    if (op === 'or') return (l === true || r === true) ? true : NULLV;
    return NULLV;
  }
  if (typeof l === 'boolean' && typeof r === 'boolean') {
    switch (op) {
      case 'and':
        return l && r;
      case 'or':
        return l || r;
      case 'xor':
        return l !== r;
      case 'eqv':
        return l === r;
      default:
        return !l || r;
    }
  }
  const a = Math.trunc(toNum(l));
  const b = Math.trunc(toNum(r));
  switch (op) {
    case 'and':
      return a & b;
    case 'or':
      return a | b;
    case 'xor':
      return a ^ b;
    case 'eqv':
      return ~(a ^ b);
    default:
      return ~a | b;
  }
}

function enumObject(members: Map<string, number>): HostObject {
  return new (class extends HostObject {
    readonly typeName = 'Enum';
    member(name: string): unknown {
      if (members.has(name)) return members.get(name);
      return fail(438);
    }
  })();
}
