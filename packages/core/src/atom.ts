// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { canonInt, type IntVal } from "./number";

/**
 * The MeTTa term model. A discriminated union on `kind` (convention C1).
 * Every variant declares ALL seven fields in the SAME order so V8 keeps one
 * hidden class across atoms (monomorphic property access on the hot path).
 * Unused fields are `undefined`, never absent, never deleted (C1).
 */
export type MetaType = "Symbol" | "Variable" | "Expression" | "Grounded";

export interface SymAtom {
  readonly kind: "sym";
  readonly name: string;
  readonly items: undefined;
  readonly value: undefined;
  readonly typ: undefined;
  readonly exec: undefined;
  readonly match: undefined;
  readonly ground: true;
}
export interface VarAtom {
  readonly kind: "var";
  readonly name: string;
  readonly items: undefined;
  readonly value: undefined;
  readonly typ: undefined;
  readonly exec: undefined;
  readonly match: undefined;
  readonly ground: false;
}
export interface ExprAtom {
  readonly kind: "expr";
  readonly name: undefined;
  readonly items: readonly Atom[];
  readonly value: undefined;
  readonly typ: undefined;
  readonly exec: undefined;
  readonly match: undefined;
  /** True iff no variable occurs anywhere inside (a precomputed ground flag): lets `applySubst`,
   *  `atomVars`, and `occurs` short-circuit instantly on closed terms. Computed once at construction. */
  readonly ground: boolean;
}
/** A grounded value (LeaTTa `Ground`). Numbers track int vs float so `3` and `3.0` stay distinct. */
export type Ground =
  | { readonly g: "int"; readonly n: number | bigint }
  | { readonly g: "float"; readonly n: number }
  | { readonly g: "str"; readonly s: string }
  | { readonly g: "bool"; readonly b: boolean }
  | { readonly g: "unit" }
  | { readonly g: "error"; readonly msg: string }
  | { readonly g: "ext"; readonly kind: string; readonly id: string };

/** A grounded atom: a structured `Ground` value with a derived type atom, plus optional executor
 *  and custom matcher (used by DAS-style grounded atoms; core built-in ops dispatch by symbol). */
export interface GndAtom {
  readonly kind: "gnd";
  readonly name: undefined;
  readonly items: undefined;
  readonly value: Ground;
  readonly typ: Atom;
  readonly exec: GroundedExec | undefined;
  readonly match: GroundedMatch | undefined;
  readonly ground: true;
}
export type Atom = SymAtom | VarAtom | ExprAtom | GndAtom;

/** A grounded atom's executor: applied when the atom heads an expression `(<gnd> arg...)`. Receives
 *  the evaluated argument atoms and returns the result atoms. May throw to signal a runtime error. */
export type GroundedExec = (args: readonly Atom[]) => readonly Atom[];
export type GroundedMatch = (other: Atom) => readonly unknown[];

/** Structural equality of grounded values (LeaTTa `Ground.BEq`). */
export function groundEq(a: Ground, b: Ground): boolean {
  if (a.g !== b.g) return false;
  switch (a.g) {
    case "int":
    case "float":
      return a.n === (b as { n: number }).n;
    case "str":
      return a.s === (b as { s: string }).s;
    case "bool":
      return a.b === (b as { b: boolean }).b;
    case "unit":
      return true;
    case "error":
      return a.msg === (b as { msg: string }).msg;
    case "ext": {
      const e = b as { kind: string; id: string };
      return a.kind === e.kind && a.id === e.id;
    }
  }
}

const SYM_INTERN = new Map<string, SymAtom>();

/** Interned symbol atom: equal names share one object (reference equality, low allocation). */
export function sym(name: string): SymAtom {
  let s = SYM_INTERN.get(name);
  if (s === undefined) {
    s = {
      kind: "sym",
      name,
      items: undefined,
      value: undefined,
      typ: undefined,
      exec: undefined,
      match: undefined,
      ground: true,
    };
    SYM_INTERN.set(name, s);
  }
  return s;
}

/** Variable atom. Not interned: freshening needs distinct identities. */
export function variable(name: string): VarAtom {
  return {
    kind: "var",
    name,
    items: undefined,
    value: undefined,
    typ: undefined,
    exec: undefined,
    match: undefined,
    ground: false,
  };
}

export function expr(items: readonly Atom[]): ExprAtom {
  let ground = true;
  for (const it of items)
    if (!it.ground) {
      ground = false;
      break;
    }
  return {
    kind: "expr",
    name: undefined,
    items,
    value: undefined,
    typ: undefined,
    exec: undefined,
    match: undefined,
    ground,
  };
}

/** The built-in type atom for a grounded value (LeaTTa `getTypes` on grounded). */
export function groundType(v: Ground): Atom {
  switch (v.g) {
    case "int":
    case "float":
      return sym("Number");
    case "str":
      return sym("String");
    case "bool":
      return sym("Bool");
    default:
      return sym("Grounded");
  }
}

export function gnd(
  value: Ground,
  typ: Atom = groundType(value),
  exec?: GroundedExec,
  match?: GroundedMatch,
): GndAtom {
  return { kind: "gnd", name: undefined, items: undefined, value, typ, exec, match, ground: true };
}

/** Grounded literal constructors. */
export const gint = (n: IntVal): GndAtom => gnd({ g: "int", n: canonInt(n) });
export const gfloat = (n: number): GndAtom => gnd({ g: "float", n });
export const gstr = (s: string): GndAtom => gnd({ g: "str", s });
export const gbool = (b: boolean): GndAtom => gnd({ g: "bool", b });
export const gunit: GndAtom = gnd({ g: "unit" });

export function metaType(a: Atom): MetaType {
  switch (a.kind) {
    case "sym":
      return "Symbol";
    case "var":
      return "Variable";
    case "expr":
      return "Expression";
    case "gnd":
      return "Grounded";
  }
}

// --- structural hashing (for the ground-fact exact-match index) ---
// A 32-bit hash that is equal for structurally-equal atoms. Expression hashes are memoised in a WeakMap
// (so the atom representation is untouched), and an expression mixes its children's hashes, so hashing a
// freshly-built atom over already-cached subterms is O(1), not O(term size). That is what keeps an exact
// ground-membership `match` over runtime facts O(1) instead of O(N) per check. Hash collisions are
// possible (32 bits), so every consumer MUST verify a hit with `atomEq` rather than trust the hash alone.
const exprHashCache = new WeakMap<ExprAtom, number>();

const mixHash = (h: number, x: number): number => {
  h = Math.imul(h ^ x, 0x9e3779b1);
  return (h ^ (h >>> 15)) >>> 0;
};
const strHash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
function groundHash(g: Ground): number {
  switch (g.g) {
    case "int":
      return strHash("i" + g.n.toString());
    case "float":
      return strHash("f" + g.n.toString());
    case "str":
      return strHash("s" + g.s);
    case "bool":
      return g.b ? 0x1 : 0x2;
    case "unit":
      return 0x3;
    case "error":
      return strHash("e" + g.msg);
    case "ext":
      return strHash("x" + g.kind + "\x00" + g.id);
  }
}

/** A 32-bit structural hash: equal structures hash equal. O(1) amortised for a fresh atom whose subterms
 *  are already hashed. Collisions are possible, so callers verify a match with `atomEq`. */
export function hashOf(a: Atom): number {
  switch (a.kind) {
    case "sym":
      return mixHash(0x53594d42, strHash(a.name)); // tag "SYMB"
    case "var":
      return mixHash(0x56415242, strHash(a.name)); // tag "VARB"
    case "gnd":
      return mixHash(0x474e4444, groundHash(a.value)); // tag "GNDD"
    case "expr": {
      const cached = exprHashCache.get(a);
      if (cached !== undefined) return cached;
      let acc = 0x45585052; // tag "EXPR"
      acc = mixHash(acc, a.items.length);
      for (const it of a.items) acc = mixHash(acc, hashOf(it));
      exprHashCache.set(a, acc);
      return acc;
    }
  }
}

/** Total term size (LeaTTa `Atom.size`): leaves are 1, an expression is 1 + sum of parts. */
export function atomSize(a: Atom): number {
  if (a.kind === "expr") {
    let n = 1;
    for (const it of a.items) n += atomSize(it);
    return n;
  }
  return 1;
}

/** All variable names occurring in an atom (LeaTTa `Atom.vars`), in first-seen order, deduped. */
export function atomVars(a: Atom, out: string[] = []): string[] {
  collectVars(a, out, new Set(out));
  return out;
}

/** Collect an atom's variable names into `out`, deduping via the shared `seen` set (O(1) membership instead
 *  of a linear `out.includes`). Hot accumulation loops (scopeVars/frameVars) reuse one `seen` across many
 *  atoms so the whole walk stays linear; `atomVars` is the one-shot wrapper that seeds `seen` from `out`. */
export function collectVars(a: Atom, out: string[], seen: Set<string>): void {
  if (a.ground) return; // closed term: no variables (ground short-circuit)
  switch (a.kind) {
    case "var":
      if (!seen.has(a.name)) {
        seen.add(a.name);
        out.push(a.name);
      }
      break;
    case "expr":
      for (const it of a.items) collectVars(it, out, seen);
      break;
    default:
      break;
  }
}

/** The empty expression `()` (LeaTTa `Atom.empty`), the success marker used by `assert*`. */
export const emptyExpr: ExprAtom = expr([]);

/** Is this atom an `(Error ...)` expression? */
export function isErrorAtom(a: Atom): boolean {
  return (
    a.kind === "expr" &&
    a.items.length >= 1 &&
    a.items[0]!.kind === "sym" &&
    a.items[0]!.name === "Error"
  );
}

export const isExpr = (a: Atom): a is ExprAtom => a.kind === "expr";
export const isVar = (a: Atom): a is VarAtom => a.kind === "var";
export const isSym = (a: Atom): a is SymAtom => a.kind === "sym";
export const isGnd = (a: Atom): a is GndAtom => a.kind === "gnd";

/** Structural equality. Interned symbols short-circuit to reference identity. */
export function atomEq(a: Atom, b: Atom): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "sym":
      return false; // interned: a !== b means different symbols
    case "var":
      return a.name === (b as VarAtom).name;
    case "gnd":
      return groundEq(a.value, (b as GndAtom).value);
    case "expr": {
      const bi = (b as ExprAtom).items;
      if (a.items.length !== bi.length) return false;
      for (let i = 0; i < a.items.length; i++) {
        const ai = a.items[i] as Atom;
        const bii = bi[i] as Atom;
        if (!atomEq(ai, bii)) return false;
      }
      return true;
    }
  }
}
