import type { TypeRef } from './values';

export interface Arg {
  e: Expr | null;
  name?: string;
}

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'lit'; v: unknown }
  | { k: 'name'; n: string; raw: string }
  | { k: 'mem'; o: Expr | null; n: string; raw: string }
  | { k: 'call'; t: Expr; a: Arg[] }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'new'; cls: string }
  | { k: 'typeof'; e: Expr; t: string; neg: boolean }
  | { k: 'paren'; e: Expr }
  | { k: 'addr'; n: string }
  | { k: 'bang'; o: Expr | null; n: string };

export interface DimItem {
  name: string;
  raw: string;
  type: TypeRef;
  dims: { lo: Expr | null; hi: Expr }[] | null;
  dynamic: boolean;
  withEvents?: boolean;
}

export type Stmt = { line: number } & (
  | { k: 'raise'; e: Expr }
  | { k: 'dim'; scope: 'dim' | 'static' | 'public' | 'private'; items: DimItem[] }
  | { k: 'redim'; preserve: boolean; items: { target: Expr; dims: { lo: Expr | null; hi: Expr }[]; type: TypeRef | null }[] }
  | { k: 'erase'; names: Expr[] }
  | { k: 'const'; items: { name: string; raw: string; type: TypeRef | null; value: Expr }[]; scope: string }
  | { k: 'assign'; target: Expr; value: Expr; isSet: boolean }
  | { k: 'call'; e: Expr }
  | { k: 'if'; cond: Expr; then: Stmt[]; elifs: { cond: Expr; body: Stmt[] }[]; else: Stmt[] | null }
  | { k: 'select'; e: Expr; cases: { tests: CaseTest[] | null; body: Stmt[] }[] }
  | { k: 'for'; v: Expr; from: Expr; to: Expr; step: Expr | null; body: Stmt[]; endLine: number }
  | { k: 'foreach'; v: Expr; coll: Expr; body: Stmt[]; endLine: number }
  | { k: 'do'; cond: Expr | null; until: boolean; post: boolean; body: Stmt[]; endLine: number }
  | { k: 'with'; o: Expr; body: Stmt[] }
  | { k: 'goto'; label: string }
  | { k: 'gosub'; label: string }
  | { k: 'return' }
  | { k: 'label'; name: string }
  | { k: 'onerror'; mode: 'goto' | 'next' | 'zero'; label: string }
  | { k: 'resume'; mode: 'retry' | 'next' | 'label'; label: string }
  | { k: 'exit'; what: string }
  | { k: 'end' }
  | { k: 'stop' }
  | { k: 'print'; file: Expr | null; items: { e: Expr | null; sep: string }[]; debug: boolean }
  | { k: 'nop' }
);

export type CaseTest = { t: 'val'; e: Expr } | { t: 'range'; lo: Expr; hi: Expr } | { t: 'is'; op: string; e: Expr };

export interface Param {
  name: string;
  raw: string;
  byRef: boolean;
  optional: boolean;
  paramArray: boolean;
  type: TypeRef;
  isArray: boolean;
  def: Expr | null;
}

export interface Proc {
  name: string;
  raw: string;
  kind: 'sub' | 'function' | 'get' | 'let' | 'set';
  vis: 'public' | 'private' | 'friend';
  isStatic: boolean;
  params: Param[];
  ret: TypeRef | null;
  retArray: boolean;
  body: Stmt[];
  line: number;
  endLine: number;
}

export interface UdtDef {
  name: string;
  fields: { name: string; raw: string; type: TypeRef; dims: { lo: Expr | null; hi: Expr }[] | null }[];
}

export interface EnumDef {
  name: string;
  vis: string;
  members: { name: string; raw: string; value: Expr | null }[];
}

export interface ModAst {
  optionExplicit: boolean;
  optionBase: number;
  optionText: boolean;
  vars: (Extract<Stmt, { k: 'dim' }> | Extract<Stmt, { k: 'const' }>)[];
  procs: Proc[];
  types: UdtDef[];
  enums: EnumDef[];
  implementsList: string[];
}
