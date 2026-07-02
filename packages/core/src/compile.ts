// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Compile the pure, deterministic, integer/bool functional subset of MeTTa to native JS closures.
// A single-equation pure function over ground int parameters whose body is arithmetic, comparison,
// `if`, `unify`-as-equality, ground literals, parameters, and calls to other such functions becomes a
// memoised native closure operating on unwrapped `IntVal`. It is byte-identical to the interpreter by
// construction (it reuses the interpreter's own `addInt`/`intDiv`/... so promotion-to-bigint,
// division-by-zero, and overflow match exactly) and bails to the interpreter for anything outside the
// proven subset. The internal memo makes overlapping-subproblem recursion (fib) polynomial AND native.
import {
  type Atom,
  type SymAtom,
  type ExprAtom,
  atomEq,
  expr,
  gint,
  gbool,
  sym,
  variable,
  emptyExpr,
} from "./atom";
import { type Bindings, emptyBindings, prependValRaw, hasLoop, lookupVal } from "./bindings";
import { addVarBinding, matchAtoms, matchAtomsScoped, merge } from "./match";
import { instantiate } from "./instantiate";
import { IMPURE_OPS } from "./tabling";
import { type IntVal, addInt, subInt, mulInt, intDiv, intMod, isZero, cmpIntVal } from "./number";
import { callGrounded } from "./builtins";
import { type MinEnv, type St } from "./eval";

/** Thrown by a compiled node when it meets a case it cannot handle faithfully (division by zero);
 *  the caller catches it (along with a native stack `RangeError`) and re-runs the call in the
 *  interpreter, which is sound because the compiled subset is side-effect-free. */
export const BAIL = Symbol("bail");

// A fixed-arity tuple of ints, the one non-scalar value the compiled core handles (PeTTa's iterate/
// quad-step thread a `($t $i $sum)` state tuple). Wrapped in a class so it is distinct from the plain
// array that makeRun's loop reads as a tail-call frame.
class Tup {
  constructor(readonly v: readonly IntVal[]) {}
}
type FrameVal = IntVal | Tup;
type Ty = "int" | "bool" | "sym" | `tuple${number}` | `symtuple${number}`;
type Node = (frame: FrameVal[]) => FrameVal | boolean;
interface Compiled {
  readonly node: Node;
  readonly type: Ty;
}

/** A compiled pure function. `run` is filled after the whole dependency group is compiled, so mutual
 *  recursion resolves through the holder object. */
interface FunctionalHolder {
  kind: "functional";
  arity: number;
  retType: Ty;
  paramTypes: Ty[];
  run: (vals: FrameVal[]) => FrameVal | boolean;
}
interface CompiledAtomResult {
  readonly atom: Atom;
  readonly bnd: Bindings;
}
export interface CompiledRunResult {
  readonly results: readonly CompiledAtomResult[];
  readonly counterDelta: number;
  readonly state?: St;
}
interface RewriteHolder {
  kind: "rewrite";
  arity: number;
  retType: Ty;
  paramTypes: Ty[];
  ruleCount: number;
  run: (partAtoms: readonly Atom[]) => CompiledRunResult | undefined;
}
// A compiled general symbolic constructor function: every static clause is a left-linear constructor
// rewrite (nested symbol/constructor LHS patterns; an RHS of symbols, ground literals, LHS-bound vars,
// fresh RHS-only vars, and nested recursive calls). Generalises RewriteHolder (flat symbol tuples) to
// nested patterns, recursive RHS terms, and surviving fresh variables. `run` is a specialised queryOp:
// for a GROUND call it replaces the per-application matchAtomsScoped tree-walk + instantiate with a
// positional match + template build, preserving the interpreter's fresh-variable numbering (clause i
// freshens with suffix "#"+(counter+i); the counter advances by the clause count) and candidate order.
interface SymbolicHolder {
  kind: "symbolic";
  arity: number;
  clauseCount: number;
  run: (partAtoms: readonly Atom[], counter: number) => CompiledRunResult | undefined;
}
export interface CompiledImpureOps {
  readonly addAtom: (env: MinEnv, st: St, space: Atom, atom: Atom) => St | undefined;
  /** Solutions of a `(match space pattern template)` under the current world: the instantiated
   *  template plus that solution's bindings, in the interpreter's own candidate order, and the
   *  fresh-variable counter advance the interpreted match would have cost. Undefined = not a space. */
  readonly matchSolutions?: (
    env: MinEnv,
    st: St,
    space: Atom,
    pattern: Atom,
    template: Atom,
  ) =>
    | { readonly pairs: ReadonlyArray<readonly [Atom, Bindings]>; readonly counterDelta: number }
    | undefined;
  /** The add-if-absent idiom on a ground atom: exact-membership probe, then append when absent.
   *  Undefined when the fast probe is unsound for this space (non-ground facts, static facts of the
   *  same head, state handles), sending the caller back to the interpreter. */
  readonly addIfAbsent?: (
    env: MinEnv,
    st: St,
    space: Atom,
    atom: Atom,
  ) => { readonly added: boolean; readonly state: St } | undefined;
}
type ImpEval = { readonly value: Atom; readonly st: St } | typeof BAIL;
interface ImperativeHolder {
  kind: "imperative";
  arity: number;
  clauseCount: number;
  run: (partAtoms: readonly Atom[], st: St, ops: CompiledImpureOps, discard?: boolean) => ImpEval;
}
// A compiled nondeterministic let*-chain functor (the backward-chainer class); see the section
// header above compileNondet. `run` returns every solution in clause-major depth-first order, or
// undefined to fall back (out of subset, over budget, or native stack exhaustion).
interface NondetHolder {
  kind: "nondet";
  arity: number;
  clauseCount: number;
  run: (
    env: MinEnv,
    partAtoms: readonly Atom[],
    st: St,
    ops: CompiledImpureOps,
  ) => CompiledRunResult | undefined;
}
export type CompiledHolder =
  | FunctionalHolder
  | RewriteHolder
  | SymbolicHolder
  | ImperativeHolder
  | NondetHolder;
export type CompiledFns = Map<string, CompiledHolder>;
type FunctionalFns = Map<string, FunctionalHolder>;

// A lexical scope: each in-scope variable maps to how its value is read out of the frame, plus its type.
// Replaces the old flat `string[]` of int params so a tuple-pattern parameter's elements ($t/$i/$sum) can
// resolve to element accessors on the tuple's frame slot. `len` is the current frame length (let appends).
interface Scope {
  vars: ReadonlyMap<string, { acc: (f: FrameVal[]) => FrameVal; type: Ty }>;
  len: number;
}

const ARITH: Record<string, (x: IntVal, y: IntVal) => IntVal> = {
  "+": addInt,
  "-": subInt,
  "*": mulInt,
};
// Symbol heads compileBody treats as operators (so a symbol-headed expr with one of these is a call, not a
// tuple literal). A compiled function name (in `holders`) is also a call; everything else is a tuple.
const KNOWN_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "if",
  "unify",
  "let",
]);

const asIntNode = (c: Compiled): ((f: FrameVal[]) => IntVal) => c.node as (f: FrameVal[]) => IntVal;

type IntNode = (f: FrameVal[]) => IntVal;

/** Compile the two operands of a binary integer operation to int-valued frame nodes, or `undefined` if
 *  either operand is not a compilable int (so the caller bails the whole function to the interpreter). */
function binIntArgs(
  args: readonly Atom[],
  scope: Scope,
  holders: FunctionalFns,
): [IntNode, IntNode] | undefined {
  if (args.length !== 2) return undefined;
  const x = compileBody(args[0]!, scope, holders);
  const y = compileBody(args[1]!, scope, holders);
  if (!x || !y || x.type !== "int" || y.type !== "int") return undefined;
  return [asIntNode(x), asIntNode(y)];
}

// Compile `(if cond then else)`. The condition is always a (bool) body; the branches are compiled by
// `branch`: compileBody for a body-position if, or compileTail to keep the tail calls of a tail-position
// if. Both branches must share a type, which becomes the result type.
function compileIf(
  cond: Atom,
  then_: Atom,
  els: Atom,
  scope: Scope,
  holders: FunctionalFns,
  branch: (a: Atom) => Compiled | undefined,
): Compiled | undefined {
  const c = compileBody(cond, scope, holders);
  const t = branch(then_);
  const e = branch(els);
  if (!c || !t || !e || c.type !== "bool" || t.type !== e.type) return undefined;
  const cn = c.node as (f: FrameVal[]) => boolean;
  const tn = t.node;
  const en = e.node;
  return { node: (f) => (cn(f) ? tn(f) : en(f)), type: t.type };
}

/** Compile a body atom to a typed node, or `undefined` if it falls outside the supported subset. */
function compileBody(a: Atom, scope: Scope, holders: FunctionalFns): Compiled | undefined {
  if (a.kind === "var") {
    const v = scope.vars.get(a.name);
    if (v === undefined) return undefined;
    return { node: v.acc, type: v.type };
  }
  if (a.kind === "gnd") {
    const v = a.value;
    if (v.g === "int") {
      const k = v.n;
      return { node: () => k, type: "int" };
    }
    if (v.g === "bool") {
      const b = v.b;
      return { node: () => b, type: "bool" };
    }
    return undefined;
  }
  if (a.kind !== "expr" || a.items.length === 0) return undefined;
  // A non-operator-headed expression is a TUPLE literal: `((+ $t 1) 1 (+ $sum (* $t $i)))`. Each element
  // must compile to an int; the node builds a Tup. (An operator/function call has a symbol head handled
  // below; a tuple's head is a non-symbol, or a symbol that is neither a known op nor a compiled function.)
  const head = a.items[0]!;
  const isCall = head.kind === "sym" && (KNOWN_OPS.has(head.name) || holders.has(head.name));
  if (!isCall) {
    const elems = a.items.map((e) => compileBody(e, scope, holders));
    if (elems.some((c) => !c || c.type !== "int")) return undefined;
    const ns = elems.map((c) => asIntNode(c!));
    return { node: (f) => new Tup(ns.map((n) => n(f))), type: `tuple${a.items.length}` };
  }
  const op = (head as { name: string }).name;
  const args = a.items.slice(1);

  if (op === "+" || op === "-" || op === "*") {
    const xy = binIntArgs(args, scope, holders);
    if (!xy) return undefined;
    const [xn, yn] = xy;
    const f = ARITH[op]!;
    return { node: (fr) => f(xn(fr), yn(fr)), type: "int" };
  }
  if (op === "/" || op === "%") {
    const xy = binIntArgs(args, scope, holders);
    if (!xy) return undefined;
    const [xn, yn] = xy;
    const div = op === "/" ? intDiv : intMod;
    return {
      node: (fr) => {
        const d = yn(fr);
        if (isZero(d)) throw BAIL; // interpreter builds the exact DivisionByZero error
        return div(xn(fr), d);
      },
      type: "int",
    };
  }
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==") {
    const xy = binIntArgs(args, scope, holders);
    if (!xy) return undefined;
    const [xn, yn] = xy;
    const test =
      op === "<"
        ? (c: number) => c < 0
        : op === "<="
          ? (c: number) => c <= 0
          : op === ">"
            ? (c: number) => c > 0
            : op === ">="
              ? (c: number) => c >= 0
              : (c: number) => c === 0;
    return { node: (fr) => test(cmpIntVal(xn(fr), yn(fr))), type: "bool" };
  }
  if (op === "if") {
    if (args.length !== 3) return undefined;
    return compileIf(args[0]!, args[1]!, args[2]!, scope, holders, (x) =>
      compileBody(x, scope, holders),
    );
  }
  if (op === "unify") {
    // (unify <x> <ground-int-literal> <then> <else>) with no new binding -> an equality test.
    if (args.length !== 4) return undefined;
    const pat = args[1]!;
    if (!(pat.kind === "gnd" && pat.value.g === "int")) return undefined;
    const patVal = pat.value.n;
    const x = compileBody(args[0]!, scope, holders);
    const t = compileBody(args[2]!, scope, holders);
    const e = compileBody(args[3]!, scope, holders);
    if (!x || !t || !e || x.type !== "int" || t.type !== e.type) return undefined;
    const xn = asIntNode(x);
    const tn = t.node;
    const en = e.node;
    return { node: (fr) => (cmpIntVal(xn(fr), patVal) === 0 ? tn(fr) : en(fr)), type: t.type };
  }
  if (op === "let") {
    // (let <var> <int-value> <body>) binds the variable to the value, then evaluates the body.
    // In MeTTa `let` desugars to `(unify value var body Empty)`; a variable pattern always binds, so
    // the body always runs with the variable bound to the (deterministic int) value.
    if (args.length !== 3 || args[0]!.kind !== "var") return undefined;
    const val = compileBody(args[1]!, scope, holders);
    if (!val || val.type !== "int") return undefined;
    const idx = scope.len;
    const np: Scope = {
      vars: new Map(scope.vars).set((args[0] as { name: string }).name, {
        acc: (f) => f[idx]!,
        type: "int",
      }),
      len: scope.len + 1,
    };
    const body = compileBody(args[2]!, np, holders);
    if (!body) return undefined;
    const vn = asIntNode(val);
    const bn = body.node;
    return { node: (fr) => bn([...fr, vn(fr)]), type: body.type };
  }
  // a call to another compiled function (self or mutual): each argument must match the callee's declared
  // parameter type (int or tuple), so a tuple flows through a call faithfully.
  const h = holders.get(op);
  if (h !== undefined) {
    if (args.length !== h.arity) return undefined;
    const cs = args.map((ar) => compileBody(ar, scope, holders));
    if (cs.some((c, i) => !c || c.type !== h.paramTypes[i])) return undefined;
    const ns = cs.map((c) => c!.node);
    // args are int/tuple (paramTypes never bool), so the mapped values are FrameVal.
    return { node: (fr) => h.run(ns.map((n) => n(fr)) as FrameVal[]), type: h.retType };
  }
  return undefined;
}

/** Compile a body atom in TAIL position. A self-call there returns the next argument frame (an array) for
 *  the caller's loop to consume instead of recursing, and an `if`'s branches stay in tail position. Anything
 *  else compiles normally via `compileBody` (so a non-tail self-call, e.g. fib's, stays ordinary recursion).
 *  This turns a tail-recursive function (find-divisor's trial-division loop is the motivating case) into a
 *  native while-loop in `makeRun`, instead of deep recursion that V8 deoptimises (measured 8x slower than
 *  the interpreter on a deep loop). The array sentinel is unambiguous: a real result is `number | bigint |
 *  boolean`, never an array. */
function compileTail(
  a: Atom,
  scope: Scope,
  holders: FunctionalFns,
  self: string,
): Compiled | undefined {
  if (a.kind === "expr" && a.items.length > 0 && a.items[0]!.kind === "sym") {
    const op = (a.items[0] as { name: string }).name;
    if (op === "if" && a.items.length === 4) {
      return compileIf(a.items[1]!, a.items[2]!, a.items[3]!, scope, holders, (x) =>
        compileTail(x, scope, holders, self),
      );
    }
    if (op === self) {
      const h = holders.get(self);
      if (h !== undefined && a.items.length - 1 === h.arity) {
        const cs = a.items.slice(1).map((x) => compileBody(x, scope, holders));
        if (!cs.some((c, i) => !c || c.type !== h.paramTypes[i])) {
          const ns = cs.map((c) => c!.node);
          return { node: (f) => ns.map((n) => n(f)) as unknown as FrameVal, type: h.retType };
        }
      }
    }
  }
  return compileBody(a, scope, holders);
}

const bailRun = (): FrameVal | boolean => {
  throw BAIL;
};

/** How many times `functor` is applied inside `body`. Tree recursion (>=2 self-calls, e.g. fib) has
 *  overlapping subproblems that memoisation collapses from exponential to polynomial; a single tail call
 *  (find-divisor's trial-division loop) has no overlap, so memoising it only grows an unbounded cache of
 *  never-repeated keys, which made primality testing 875x slower per 10x of work. */
function selfCallCount(a: Atom, functor: string): number {
  if (a.kind !== "expr" || a.items.length === 0) return 0;
  let n = a.items[0]!.kind === "sym" && (a.items[0] as { name: string }).name === functor ? 1 : 0;
  for (const it of a.items) n += selfCallCount(it, functor);
  return n;
}

/** Wrap a compiled body node in per-call memoisation (the function is pure, so the result is a function of
 *  its arguments). Only tree-recursive functions are memoised; a non- or tail-recursive function gains
 *  nothing from the cache and pays the key-building and Map cost on every call, so it runs bare. Single-int
 *  -arg functions key directly; others by a string of args. */
function makeRun(
  arity: number,
  node: Node,
  memoize: boolean,
): (vals: FrameVal[]) => FrameVal | boolean {
  // A tail-recursive body (compiled by compileTail) returns the next argument frame as an array; loop on it
  // instead of recursing. A non-tail-recursive body never returns an array, so the loop runs exactly once.
  // (A tuple result is a `Tup`, not an array, so it is never mistaken for a tail-call frame.)
  const loop = (vals: FrameVal[]): FrameVal | boolean => {
    let frame = vals;
    for (;;) {
      const r: unknown = node(frame);
      if (Array.isArray(r)) {
        frame = r as FrameVal[];
        continue;
      }
      return r as FrameVal | boolean;
    }
  };
  if (!memoize) return loop;
  const memo = new Map<unknown, FrameVal | boolean>();
  // A tuple argument must be keyed by its contents, not `String(tup)` (which is "[object Object]" for every
  // tuple and so collapses distinct tuples in the same position to one (a stale memo hit). Numbers key as
  // themselves; an int and a bigint of equal value share a key, which is a correct hit (same value).
  const keyOf = (v: FrameVal): string =>
    v instanceof Tup ? "(" + v.v.map(keyOf).join(" ") + ")" : String(v);
  return (vals) => {
    const key = arity === 1 ? keyOf(vals[0]!) : vals.map(keyOf).join(",");
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = loop(vals);
    memo.set(key, v);
    return v;
  };
}

// A parameter is either a plain variable or a flat tuple-of-variables pattern `($t $i $sum)`.
type ParamPat = string | string[];

/** A single-clause `(= (f $a ($x $y) ...) body)` whose parameters are distinct variables or flat tuple
 *  patterns, or undefined. */
function singleClauseHead(
  env: MinEnv,
  functor: string,
): { params: ParamPat[]; body: Atom } | undefined {
  const eqs = env.ruleIndex.get(functor);
  if (eqs === undefined || eqs.length !== 1) return undefined;
  const [lhs, body] = eqs[0]!;
  if (lhs.kind !== "expr" || lhs.items.length === 0 || lhs.items[0]!.kind !== "sym")
    return undefined;
  const params: ParamPat[] = [];
  const seen = new Set<string>();
  const take = (name: string): boolean => (seen.has(name) ? false : (seen.add(name), true));
  for (let i = 1; i < lhs.items.length; i++) {
    const it = lhs.items[i]!;
    if (it.kind === "var") {
      if (!take(it.name)) return undefined;
      params.push(it.name);
    } else if (
      it.kind === "expr" &&
      it.items.length > 0 &&
      it.items.every((e) => e.kind === "var")
    ) {
      const elems = it.items.map((e) => (e as { name: string }).name);
      if (!elems.every(take)) return undefined;
      params.push(elems);
    } else return undefined;
  }
  return { params, body };
}

/** Build the lexical scope a function body compiles against, using each parameter's resolved type: a plain
 *  var reads its frame slot (its type may be a tuple, inferred from usage); a tuple pattern's elements read
 *  into the tuple sitting in that slot. */
function buildScope(params: readonly ParamPat[], paramTypes: readonly Ty[]): Scope {
  const vars = new Map<string, { acc: (f: FrameVal[]) => FrameVal; type: Ty }>();
  params.forEach((p, i) => {
    if (typeof p === "string") vars.set(p, { acc: (f) => f[i]!, type: paramTypes[i]! });
    else p.forEach((e, j) => vars.set(e, { acc: (f) => (f[i] as Tup).v[j]!, type: "int" }));
  });
  return { vars, len: params.length };
}

/** Map of every variable a parameter list binds to its type, for inferType (tuple elements are int). */
function varTypesOf(params: readonly ParamPat[], paramTypes: readonly Ty[]): Map<string, Ty> {
  const m = new Map<string, Ty>();
  params.forEach((p, i) => {
    if (typeof p === "string") m.set(p, paramTypes[i]!);
    else p.forEach((e) => m.set(e, "int"));
  });
  return m;
}

/** Initial parameter types before usage refinement: a plain var defaults to int, a tuple pattern is its
 *  arity. A plain var that actually holds a tuple is upgraded by inferVarType. */
const paramTypesOf = (params: readonly ParamPat[]): Ty[] =>
  params.map((p) => (typeof p === "string" ? "int" : (`tuple${p.length}` as Ty)));

/** Infer a plain-var parameter's type from its first use as an argument to a compiled function: if it is
 *  passed where that function expects a tuple, it is that tuple type. Returns undefined if only used as int. */
function inferVarType(body: Atom, name: string, holders: FunctionalFns): Ty | undefined {
  let found: Ty | undefined;
  const walk = (a: Atom): void => {
    if (found !== undefined || a.kind !== "expr" || a.items.length === 0) return;
    if (a.items[0]!.kind === "sym") {
      const h = holders.get((a.items[0] as { name: string }).name);
      if (h !== undefined)
        for (let i = 0; i + 1 < a.items.length && found === undefined; i++) {
          const arg = a.items[i + 1]!;
          if (arg.kind === "var" && arg.name === name && h.paramTypes[i] !== "int")
            found = h.paramTypes[i];
        }
    }
    for (const it of a.items) walk(it);
  };
  walk(body);
  return found;
}

type Cand = Map<string, { params: ParamPat[]; body: Atom }>;

/** Infer a body's return type, optimistically over recursion (an `if`/`unify` types from whichever
 *  branch is already known). Returns undefined when not yet determinable; the strict `compileBody`
 *  pass later rejects any function whose branches actually disagree, so optimism here is safe. */
function inferType(
  a: Atom,
  varTypes: ReadonlyMap<string, Ty>,
  holders: FunctionalFns,
): Ty | undefined {
  if (a.kind === "var") return varTypes.get(a.name);
  if (a.kind === "gnd")
    return a.value.g === "int" ? "int" : a.value.g === "bool" ? "bool" : undefined;
  if (a.kind !== "expr" || a.items.length === 0) return undefined;
  // A non-operator-headed expression is a tuple literal; its type is `tuple<n>` if every element is int.
  const hd = a.items[0]!;
  if (!(hd.kind === "sym" && (KNOWN_OPS.has(hd.name) || holders.has(hd.name))))
    return a.items.every((e) => inferType(e, varTypes, holders) === "int")
      ? `tuple${a.items.length}`
      : undefined;
  const op = (hd as { name: string }).name;
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") return "int";
  if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==") return "bool";
  if (op === "if" && a.items.length === 4) {
    const tt = inferType(a.items[2]!, varTypes, holders);
    const te = inferType(a.items[3]!, varTypes, holders);
    if (tt !== undefined && te !== undefined) return tt === te ? tt : undefined;
    return tt ?? te;
  }
  if (op === "unify" && a.items.length === 5) {
    const tt = inferType(a.items[3]!, varTypes, holders);
    const te = inferType(a.items[4]!, varTypes, holders);
    if (tt !== undefined && te !== undefined) return tt === te ? tt : undefined;
    return tt ?? te;
  }
  if (op === "let" && a.items.length === 4) return inferType(a.items[3]!, varTypes, holders); // body's type
  return holders.get(op)?.retType; // a call: its inferred return type, if known yet
}

type RewriteCellPat = { tag: "sym"; atom: SymAtom } | { tag: "var"; name: string };
type RewriteArgPat =
  | { tag: "sym"; atom: SymAtom }
  | { tag: "tuple"; items: readonly RewriteCellPat[] };
type RewriteOut = { tag: "sym"; atom: SymAtom } | { tag: "var"; name: string };
type RewriteArgVal =
  | { tag: "sym"; atom: SymAtom }
  | { tag: "tuple"; items: readonly SymAtom[] }
  | { tag: "qvar"; name: string };
interface RewriteRule {
  readonly args: readonly RewriteArgPat[];
  readonly out: readonly RewriteOut[];
  readonly vars: ReadonlyMap<string, { arg: number; cell: number }>;
}

function compileRewriteCellPat(a: Atom, seen: Set<string>): RewriteCellPat | undefined {
  if (a.kind === "sym") return { tag: "sym", atom: a };
  if (a.kind !== "var" || seen.has(a.name)) return undefined;
  seen.add(a.name);
  return { tag: "var", name: a.name };
}

function compileRewriteArgPat(a: Atom, seen: Set<string>): RewriteArgPat | undefined {
  if (a.kind === "sym") return { tag: "sym", atom: a };
  if (a.kind !== "expr" || a.items.length === 0) return undefined;
  const items = a.items.map((it) => compileRewriteCellPat(it, seen));
  if (items.some((it) => it === undefined)) return undefined;
  return { tag: "tuple", items: items as RewriteCellPat[] };
}

function compileRewriteOut(a: Atom, vars: ReadonlySet<string>): RewriteOut[] | undefined {
  if (a.kind !== "expr" || a.items.length === 0) return undefined;
  const out: RewriteOut[] = [];
  for (const it of a.items) {
    if (it.kind === "sym") out.push({ tag: "sym", atom: it });
    else if (it.kind === "var" && vars.has(it.name)) out.push({ tag: "var", name: it.name });
    else return undefined;
  }
  return out;
}

function capturePositions(
  args: readonly RewriteArgPat[],
): ReadonlyMap<string, { arg: number; cell: number }> {
  const vars = new Map<string, { arg: number; cell: number }>();
  args.forEach((arg, i) => {
    if (arg.tag === "tuple")
      arg.items.forEach((cell, j) => {
        if (cell.tag === "var") vars.set(cell.name, { arg: i, cell: j });
      });
  });
  return vars;
}

function rewriteParamTypes(args: readonly RewriteArgPat[]): Ty[] {
  return args.map((arg) => (arg.tag === "sym" ? "sym" : (`symtuple${arg.items.length}` as Ty)));
}

function sameRewriteParamType(arg: RewriteArgPat, type: Ty): boolean {
  if (type === "sym") return arg.tag === "sym";
  if (!type.startsWith("symtuple") || arg.tag !== "tuple") return false;
  return arg.items.length === Number(type.slice("symtuple".length));
}

function atomToRewriteArg(a: Atom, type: Ty): RewriteArgVal | undefined {
  if (type === "sym") {
    if (a.kind === "sym") return { tag: "sym", atom: a };
    if (a.kind === "var") return { tag: "qvar", name: a.name };
    return undefined;
  }
  if (!type.startsWith("symtuple") || a.kind !== "expr") return undefined;
  const width = Number(type.slice("symtuple".length));
  if (a.items.length !== width) return undefined;
  const items: SymAtom[] = [];
  for (const it of a.items) {
    if (it.kind !== "sym") return undefined;
    items.push(it);
  }
  return { tag: "tuple", items };
}

function bindQueryVar(b: Bindings, name: string, atom: SymAtom): Bindings | undefined {
  for (const rel of b) {
    if (rel.tag === "val" && rel.x === name) return rel.a === atom ? b : undefined;
  }
  return prependValRaw(b, name, atom);
}

function runRewriteRule(
  rule: RewriteRule,
  vals: readonly RewriteArgVal[],
): CompiledAtomResult | undefined {
  let b = emptyBindings;
  for (let i = 0; i < rule.args.length; i++) {
    const pat = rule.args[i]!;
    const actual = vals[i]!;
    if (pat.tag === "sym") {
      if (actual.tag === "sym") {
        if (actual.atom !== pat.atom) return undefined;
      } else if (actual.tag === "qvar") {
        const nb = bindQueryVar(b, actual.name, pat.atom);
        if (nb === undefined) return undefined;
        b = nb;
      } else return undefined;
      continue;
    }
    if (actual.tag !== "tuple" || actual.items.length !== pat.items.length) return undefined;
    for (let j = 0; j < pat.items.length; j++) {
      const cell = pat.items[j]!;
      if (cell.tag === "sym" && actual.items[j] !== cell.atom) return undefined;
    }
  }
  const out = rule.out.map((part) => {
    if (part.tag === "sym") return part.atom;
    const pos = rule.vars.get(part.name)!;
    return (vals[pos.arg] as { items: readonly SymAtom[] }).items[pos.cell]!;
  });
  return { atom: expr(out), bnd: b };
}

function compileRewrite(env: MinEnv, functor: string): RewriteHolder | undefined {
  const eqs = env.ruleIndex.get(functor);
  if (eqs === undefined || eqs.length === 0) return undefined;
  const rules: RewriteRule[] = [];
  let arity: number | undefined;
  let retType: Ty | undefined;
  let paramTypes: Ty[] | undefined;
  for (const [lhs, rhs] of eqs) {
    if (lhs.kind !== "expr" || lhs.items.length === 0 || lhs.items[0]!.kind !== "sym")
      return undefined;
    if (lhs.items[0]!.name !== functor) return undefined;
    arity ??= lhs.items.length - 1;
    if (lhs.items.length - 1 !== arity) return undefined;
    const seen = new Set<string>();
    const args = lhs.items.slice(1).map((arg) => compileRewriteArgPat(arg, seen));
    if (args.some((arg) => arg === undefined)) return undefined;
    const typedArgs = args as RewriteArgPat[];
    if (paramTypes === undefined) paramTypes = rewriteParamTypes(typedArgs);
    else if (
      typedArgs.length !== paramTypes.length ||
      typedArgs.some((arg, i) => !sameRewriteParamType(arg, paramTypes![i]!))
    )
      return undefined;
    const vars = capturePositions(typedArgs);
    const out = compileRewriteOut(rhs, new Set(vars.keys()));
    if (out === undefined) return undefined;
    const rt = `symtuple${out.length}` as Ty;
    if (retType === undefined) retType = rt;
    else if (retType !== rt) return undefined;
    rules.push({ args: typedArgs, out, vars });
  }
  if (arity === undefined || retType === undefined || paramTypes === undefined) return undefined;
  const run = (partAtoms: readonly Atom[]): CompiledRunResult | undefined => {
    const vals: RewriteArgVal[] = [];
    const qvars = new Set<string>();
    for (let i = 0; i < partAtoms.length; i++) {
      const v = atomToRewriteArg(partAtoms[i]!, paramTypes![i]!);
      if (v === undefined) return undefined;
      if (v.tag === "qvar") {
        if (qvars.has(v.name)) return undefined;
        qvars.add(v.name);
      }
      vals.push(v);
    }
    const results: CompiledAtomResult[] = [];
    for (const rule of rules) {
      const r = runRewriteRule(rule, vals);
      if (r !== undefined) results.push(r);
    }
    return results.length === 0 ? undefined : { results, counterDelta: rules.length };
  };
  return { kind: "rewrite", arity, retType, paramTypes, ruleCount: rules.length, run };
}

// ---------- general symbolic constructor rewrites ----------

// A compiled LHS pattern, matched positionally against a ground argument. A NEW variable takes the next
// slot (left-linear: a repeated variable bails the whole functor, since slot binding alone cannot enforce
// the equality the interpreter's matcher would).
type SymPat =
  | { readonly tag: "sym"; readonly name: string }
  | { readonly tag: "slot"; readonly slot: number }
  | { readonly tag: "lit"; readonly atom: Atom }
  | { readonly tag: "expr"; readonly items: readonly SymPat[] };

// A compiled RHS template, built directly from the matched slots. A `fresh` is an RHS-only variable that
// becomes `$name#<suffix>` exactly as `instantiate` would render an unbound suffixed variable.
type SymTpl =
  | { readonly tag: "atom"; readonly atom: Atom }
  | { readonly tag: "slot"; readonly slot: number }
  | { readonly tag: "fresh"; readonly name: string }
  | { readonly tag: "expr"; readonly items: readonly SymTpl[] };

interface SymClause {
  readonly pats: readonly SymPat[];
  readonly tpl: SymTpl;
  readonly nslots: number;
}

/** Compile an LHS pattern, assigning each new variable the next slot. Returns undefined for a repeated
 *  variable (non-left-linear) so the whole functor falls back to the interpreter. */
function compileSymPat(a: Atom, slots: Map<string, number>): SymPat | undefined {
  if (a.kind === "sym") return { tag: "sym", name: a.name };
  if (a.kind === "var") {
    if (slots.has(a.name)) return undefined;
    const slot = slots.size;
    slots.set(a.name, slot);
    return { tag: "slot", slot };
  }
  if (a.kind === "gnd") return { tag: "lit", atom: a };
  const items: SymPat[] = [];
  for (const it of a.items) {
    const p = compileSymPat(it, slots);
    if (p === undefined) return undefined;
    items.push(p);
  }
  return { tag: "expr", items };
}

/** Compile an RHS into a template. A variable bound by the LHS becomes a slot read; an RHS-only variable
 *  becomes a fresh suffixed variable at build time. Ground leaves are carried as-is. */
function compileSymTpl(a: Atom, slots: ReadonlyMap<string, number>): SymTpl {
  if (a.kind === "var") {
    const slot = slots.get(a.name);
    return slot === undefined ? { tag: "fresh", name: a.name } : { tag: "slot", slot };
  }
  if (a.kind !== "expr") return { tag: "atom", atom: a };
  return { tag: "expr", items: a.items.map((it) => compileSymTpl(it, slots)) };
}

/** Match a compiled pattern against a ground argument, filling `slots`. */
function matchSymPat(pat: SymPat, arg: Atom, slots: Atom[]): boolean {
  switch (pat.tag) {
    case "sym":
      return arg.kind === "sym" && arg.name === pat.name;
    case "slot":
      slots[pat.slot] = arg;
      return true;
    case "lit":
      return atomEq(arg, pat.atom);
    case "expr": {
      if (arg.kind !== "expr" || arg.items.length !== pat.items.length) return false;
      for (let i = 0; i < pat.items.length; i++)
        if (!matchSymPat(pat.items[i]!, arg.items[i]!, slots)) return false;
      return true;
    }
  }
}

function bindSymQueryVar(bs: readonly Bindings[], name: string, value: Atom): Bindings[] {
  const out: Bindings[] = [];
  for (const b of bs) for (const ext of addVarBinding(b, name, value)) out.push(ext);
  return out;
}

function matchSymPatQuery(
  pat: SymPat,
  arg: Atom,
  slots: Atom[],
  bs: readonly Bindings[],
): Bindings[] | undefined {
  switch (pat.tag) {
    case "sym":
      if (arg.kind === "var") return bindSymQueryVar(bs, arg.name, sym(pat.name));
      return arg.kind === "sym" && arg.name === pat.name ? [...bs] : [];
    case "slot":
      slots[pat.slot] = arg;
      return [...bs];
    case "lit":
      if (arg.kind === "var") return bindSymQueryVar(bs, arg.name, pat.atom);
      return atomEq(arg, pat.atom) ? [...bs] : [];
    case "expr": {
      if (arg.kind === "var") return undefined;
      if (arg.kind !== "expr" || arg.items.length !== pat.items.length) return [];
      let cur = [...bs];
      for (let i = 0; i < pat.items.length; i++) {
        const next = matchSymPatQuery(pat.items[i]!, arg.items[i]!, slots, cur);
        if (next === undefined) return undefined;
        if (next.length === 0) return [];
        cur = next;
      }
      return cur;
    }
  }
}

/** Build an RHS template into an atom. `expr()` recomputes the ground flag exactly as `instantiate`'s
 *  rebuild does, so a result carrying a fresh variable is correctly non-ground. */
function buildSymTpl(tpl: SymTpl, slots: readonly Atom[], suffix: string): Atom {
  switch (tpl.tag) {
    case "atom":
      return tpl.atom;
    case "slot":
      return slots[tpl.slot]!;
    case "fresh":
      return variable(tpl.name + suffix);
    case "expr":
      return expr(tpl.items.map((t) => buildSymTpl(t, slots, suffix)));
  }
}

/** Compile a pure functor whose every static clause is a left-linear constructor rewrite. Sound only when
 *  `candidatesW` for a symbol-headed call equals exactly the static clauses: no `($x ...)`-headed catch-all
 *  rules participate (varRulesVar empty), and the eval call site declines when runtime rules can affect
 *  the operator. Query variables in call arguments are handled by binding them to the compiled pattern
 *  leaves, which keeps calls like tilepuzzle's `(move $state $_)` on the compiled path. */
function compileSymbolic(env: MinEnv, functor: string): SymbolicHolder | undefined {
  if (env.varRulesVar.length !== 0) return undefined;
  const eqs = env.ruleIndex.get(functor);
  if (eqs === undefined || eqs.length === 0) return undefined;
  const clauses: SymClause[] = [];
  let arity: number | undefined;
  for (const [lhs, rhs] of eqs) {
    if (lhs.kind !== "expr" || lhs.items.length === 0) return undefined;
    if (lhs.items[0]!.kind !== "sym" || lhs.items[0]!.name !== functor) return undefined;
    const a = lhs.items.length - 1;
    if (arity === undefined) arity = a;
    else if (a !== arity) return undefined;
    const slots = new Map<string, number>();
    const pats: SymPat[] = [];
    for (let i = 1; i < lhs.items.length; i++) {
      const p = compileSymPat(lhs.items[i]!, slots);
      if (p === undefined) return undefined;
      pats.push(p);
    }
    clauses.push({ pats, tpl: compileSymTpl(rhs, slots), nslots: slots.size });
  }
  if (arity === undefined) return undefined;
  const clauseCount = clauses.length;
  const run = (partAtoms: readonly Atom[], counter: number): CompiledRunResult | undefined => {
    const results: CompiledAtomResult[] = [];
    for (let i = 0; i < clauseCount; i++) {
      const clause = clauses[i]!;
      const slots: Atom[] = new Array(clause.nslots);
      let bnds: Bindings[] = [emptyBindings];
      for (let j = 0; j < clause.pats.length; j++) {
        if (partAtoms[j]!.ground) {
          if (!matchSymPat(clause.pats[j]!, partAtoms[j]!, slots)) {
            bnds = [];
            break;
          }
          continue;
        }
        const next = matchSymPatQuery(clause.pats[j]!, partAtoms[j]!, slots, bnds);
        if (next === undefined) return undefined;
        bnds = next;
        if (bnds.length === 0) break;
      }
      if (bnds.length > 0) {
        const atom = buildSymTpl(clause.tpl, slots, "#" + (counter + i));
        for (const bnd of bnds)
          results.push({
            atom,
            bnd,
          });
      }
    }
    return results.length === 0 ? undefined : { results, counterDelta: clauseCount };
  };
  return { kind: "symbolic", arity, clauseCount, run };
}

// ---------- nondeterministic let*-chain rewrites (the backward-chainer class) ----------
//
// PeTTa compiles a multi-equation MeTTa function to Prolog clauses and lets the WAM enumerate:
// clause alternatives are choice points, a `let`/`let*` binding is a unification goal against the
// value's solution stream, and `match` is a goal against a space. This compiles the same fragment to
// a collect-all JS search (clause-major, depth-first: success pushes and continues, failure falls
// through), replacing the interpreter's per-step machinery (atomToStack/interpretLoopG frames,
// per-reduction type checks, queryVarsOf, whole-body instantiate) while reusing its meaning-bearing
// primitives unchanged: matchAtomsScoped for the freshened head unification (which also binds a
// caller's free variable to the clause's freshened skeleton), instantiate for goal arguments and
// templates, matchAtoms/merge/hasLoop for destructuring solutions, and the injected matchSolutions
// (the interpreter's own match plan) for space goals. Fresh-variable NAMES can differ from the
// interpreted path (one monotonic counter threads the search instead of the stack machine's
// interleaving); that is the impure-VM precedent: results stay deterministic and alpha-equivalent,
// the equality the oracle and LeaTTa check.

// A compiled search that exceeds this many clause dispatches bails to the interpreter, whose fuel
// budget then governs: the collect-all loop itself has no fuel, and compiled code must never turn a
// fuel-bounded divergence into a hang.
const NONDET_CALL_CAP = 4_000_000;

type NondetCall =
  | { readonly tag: "self"; readonly args: readonly Atom[] }
  | {
      readonly tag: "match";
      readonly space: Atom;
      readonly pattern: Atom;
      readonly template: Atom;
    };

interface NondetGoal {
  readonly pat: Atom;
  readonly call: NondetCall;
}

type NondetTail = { readonly tag: "tpl"; readonly atom: Atom } | NondetCall;

interface NondetClause {
  readonly lhs: Atom;
  readonly goals: readonly NondetGoal[];
  readonly tail: NondetTail;
}

/** Data under evaluation: contains no rule-defined or grounded-op head anywhere, so the type-directed
 *  argument evaluation would return it unchanged (constructors, vars, and ground leaves only). */
function nondetIsData(env: MinEnv, a: Atom): boolean {
  if (a.kind !== "expr" || a.items.length === 0) return true;
  const h = a.items[0]!;
  if (h.kind === "expr" && h.items.length > 0) return false;
  if (
    h.kind === "sym" &&
    (env.ruleIndex.has(h.name) || env.gt.has(h.name) || IMPURE_OPS.has(h.name))
  )
    return false;
  return a.items.every((x) => nondetIsData(env, x));
}

function nondetCall(env: MinEnv, functor: string, val: Atom): NondetCall | undefined {
  if (val.kind !== "expr" || val.items.length === 0 || val.items[0]!.kind !== "sym")
    return undefined;
  const op = (val.items[0] as SymAtom).name;
  if (op === "match" && val.items.length === 4) {
    if (!nondetIsData(env, val.items[2]!) || !nondetIsData(env, val.items[3]!)) return undefined;
    return {
      tag: "match",
      space: val.items[1]!,
      pattern: val.items[2]!,
      template: val.items[3]!,
    };
  }
  if (op === functor) {
    const args = val.items.slice(1);
    if (!args.every((x) => nondetIsData(env, x))) return undefined;
    return { tag: "self", args };
  }
  return undefined;
}

/** Unwrap a clause RHS into let/let* goals and a tail (a plain template or a terminal call). */
function nondetUnwrap(
  env: MinEnv,
  functor: string,
  rhs: Atom,
): { goals: NondetGoal[]; tail: NondetTail } | undefined {
  const goals: NondetGoal[] = [];
  let cur = rhs;
  for (;;) {
    if (cur.kind !== "expr" || cur.items.length === 0 || cur.items[0]!.kind !== "sym") break;
    const op = (cur.items[0] as SymAtom).name;
    if (op === "let*" && cur.items.length === 3 && cur.items[1]!.kind === "expr") {
      for (const pv of cur.items[1]!.items) {
        if (pv.kind !== "expr" || pv.items.length !== 2) return undefined;
        if (!nondetIsData(env, pv.items[0]!)) return undefined;
        const call = nondetCall(env, functor, pv.items[1]!);
        if (call === undefined) return undefined;
        goals.push({ pat: pv.items[0]!, call });
      }
      cur = cur.items[2]!;
      continue;
    }
    if (op === "let" && cur.items.length === 4) {
      if (!nondetIsData(env, cur.items[1]!)) return undefined;
      const call = nondetCall(env, functor, cur.items[2]!);
      if (call === undefined) return undefined;
      goals.push({ pat: cur.items[1]!, call });
      cur = cur.items[3]!;
      continue;
    }
    break;
  }
  const tailCall = nondetCall(env, functor, cur);
  if (tailCall !== undefined) return { goals, tail: tailCall };
  if (!nondetIsData(env, cur)) return undefined;
  return { goals, tail: { tag: "tpl", atom: cur } };
}

/** Compile a functor whose every clause is a let/let* chain of self-calls and space matches over a
 *  data template. Sound only when `candidatesW` for the call equals exactly the static clauses (the
 *  eval call site declines when runtime rules can affect the operator; variable-headed catch-alls
 *  disable compilation entirely). */
function compileNondet(env: MinEnv, functor: string): NondetHolder | undefined {
  if (env.varRulesVar.length !== 0) return undefined;
  const eqs = env.ruleIndex.get(functor);
  if (eqs === undefined || eqs.length === 0) return undefined;
  const clauses: NondetClause[] = [];
  let arity: number | undefined;
  let hasCalls = false;
  for (const [lhs, rhs] of eqs) {
    if (lhs.kind !== "expr" || lhs.items.length === 0) return undefined;
    const h = lhs.items[0]!;
    if (h.kind !== "sym" || h.name !== functor) return undefined;
    const a = lhs.items.length - 1;
    if (arity === undefined) arity = a;
    else if (a !== arity) return undefined;
    if (!lhs.items.slice(1).every((x) => nondetIsData(env, x))) return undefined;
    const un = nondetUnwrap(env, functor, rhs);
    if (un === undefined) return undefined;
    if (un.goals.length > 0 || un.tail.tag !== "tpl") hasCalls = true;
    clauses.push({ lhs, goals: un.goals, tail: un.tail });
  }
  // A functor with template-only clauses is compileSymbolic's job; this holder earns its keep only
  // when bodies actually search.
  if (arity === undefined || !hasCalls) return undefined;
  const clauseCount = clauses.length;

  const run = (
    envR: MinEnv,
    partAtoms: readonly Atom[],
    st: St,
    ops: CompiledImpureOps,
  ): CompiledRunResult | undefined => {
    const matchSolutions = ops.matchSolutions;
    if (matchSolutions === undefined) return undefined;
    const ctr = { c: st.counter };
    let dispatches = 0;
    const world = st.world;

    // Deep resolution through the accumulated bindings (miniKanren's walk*): a goal can bind a
    // variable that an earlier goal already stored INSIDE a bound value, so a shallow instantiate
    // would emit the stale intermediate variable. The interpreter never sees such chains because its
    // `chain` plumbing substitutes each concrete value structurally; here the bindings thread instead,
    // so emitted terms and goal inputs resolve through value chains to their final form.
    const walk = (b: Bindings, a: Atom): Atom => {
      let v = a;
      let hops = 0;
      while (v.kind === "var") {
        const next = lookupVal(b, v.name);
        if (next === undefined) return v;
        v = next;
        if (++hops > 10_000) throw BAIL; // a cyclic chain escaped the loop checks: not our subset
      }
      return v;
    };
    const walkStar = (b: Bindings, a: Atom): Atom => {
      const v = walk(b, a);
      if (v.ground || v.kind !== "expr") return v;
      const its = v.items;
      let items: Atom[] | null = null;
      for (let i = 0; i < its.length; i++) {
        const it = its[i]!;
        const r = walkStar(b, it);
        if (items !== null) items.push(r);
        else if (r !== it) {
          items = its.slice(0, i);
          items.push(r);
        }
      }
      return items === null ? v : expr(items);
    };
    const resolve = (b: Bindings, a: Atom, suffix: string): Atom =>
      walkStar(b, instantiate(b, a, suffix));

    const runMatch = (
      b: Bindings,
      suffix: string,
      call: { space: Atom; pattern: Atom; template: Atom },
    ): ReadonlyArray<readonly [Atom, Bindings]> => {
      const m = matchSolutions(
        envR,
        { counter: ctr.c, world },
        resolve(b, call.space, suffix),
        resolve(b, call.pattern, suffix),
        resolve(b, call.template, suffix),
      );
      if (m === undefined) throw BAIL;
      ctr.c += m.counterDelta;
      return m.pairs;
    };

    const solve = (
      clause: NondetClause,
      gi: number,
      b: Bindings,
      suffix: string,
      out: Array<readonly [Atom, Bindings]>,
    ): void => {
      if (gi === clause.goals.length) {
        if (clause.tail.tag === "tpl") {
          out.push([resolve(b, clause.tail.atom, suffix), b]);
          return;
        }
        const pairs =
          clause.tail.tag === "match"
            ? runMatch(b, suffix, clause.tail)
            : runCall(clause.tail.args.map((x) => resolve(b, x, suffix)));
        for (const [atom, vb] of pairs)
          for (const mm of merge(b, vb)) if (!hasLoop(mm)) out.push([atom, mm]);
        return;
      }
      const goal = clause.goals[gi]!;
      const pat = resolve(b, goal.pat, suffix);
      const pairs =
        goal.call.tag === "match"
          ? runMatch(b, suffix, goal.call)
          : runCall(goal.call.args.map((x) => resolve(b, x, suffix)));
      for (const [atom, vb] of pairs)
        for (const withVal of merge(b, vb)) {
          if (hasLoop(withVal)) continue;
          for (const pm of matchAtoms(pat, atom))
            for (const mm of merge(withVal, pm))
              if (!hasLoop(mm)) solve(clause, gi + 1, mm, suffix, out);
        }
    };

    const runCall = (args: readonly Atom[]): Array<readonly [Atom, Bindings]> => {
      if (++dispatches > NONDET_CALL_CAP) throw BAIL;
      const app = expr([sym(functor), ...args]);
      const out: Array<readonly [Atom, Bindings]> = [];
      for (const clause of clauses) {
        const suffix = "#" + ctr.c;
        ctr.c += 1;
        for (const b0 of matchAtomsScoped(clause.lhs, app, suffix))
          if (!hasLoop(b0)) solve(clause, 0, b0, suffix, out);
      }
      return out;
    };

    try {
      const top = runCall(partAtoms);
      const results: CompiledAtomResult[] = top.map(([atom, bnd]) => ({ atom, bnd }));
      return { results, counterDelta: ctr.c - st.counter };
    } catch (e) {
      // BAIL: outside the proven subset (or over budget); RangeError: native stack exhaustion. The
      // search mutated nothing, so re-running interpreted is sound.
      if (e === BAIL || e instanceof RangeError) return undefined;
      throw e;
    }
  };
  return { kind: "nondet", arity, clauseCount, run };
}

// ---------- deterministic impure body compiler ----------

interface ImpScope {
  readonly vars: ReadonlyMap<string, number>;
  readonly len: number;
}
interface ImpCompiled {
  readonly node: ImpNode;
  readonly directEffect: boolean;
  readonly callees: ReadonlySet<string>;
}
// `discard` (the void-context build): the caller throws the value away, so a tuple node may skip building its
// result (the cons) and run its elements only for their effects. It is forwarded to the result position
// (if/let body, tuple elements, call result), never to a value the body still needs (a let value, an if
// condition, call args). Defaults false, so omitting it leaves every node byte-identical to before.
type ImpNode = (
  slots: readonly Atom[],
  st: St,
  ops: CompiledImpureOps,
  discard?: boolean,
) => ImpEval;
type ImperativeFns = Map<string, ImperativeHolder>;

const IMP_GROUNDED = new Set(["==", "<", ">", "<=", ">=", "+", "-", "*", "%"]);
// Heads that are never inert data: the compiled language's own constructs, plus every evaluation
// op (IMPURE_OPS: match, collapse, once, superpose, metta, ...). Without the latter, a body like
// `(match &self p t)` whose head happens to have no rule and no grounding would freeze as a tuple,
// and compiled impure results skip re-reduction, so it would never run. Before the case/add-if-absent
// nodes below this was masked by `collapse` being rule-defined; it must hold on its own.
// Built lazily: the bundle's module order initializes this file before tabling.ts in the
// eval/builtins cycle, so a top-level spread of IMPURE_OPS would read it uninitialized.
let DATA_DENY_CACHE: Set<string> | undefined;
function dataDeny(): Set<string> {
  DATA_DENY_CACHE ??= new Set([...KNOWN_OPS, ...IMPURE_OPS, "let*", "add-atom"]);
  return DATA_DENY_CACHE;
}

// The value of a pruned branch: `(empty)` reduces to nothing, so a node yielding this sentinel has
// no result. It propagates through let/let* values, if conditions, and case branches (which prune
// it); any other consumer BAILs. At the holder boundary runCompiled maps it to zero results.
// Reference-compared, so no real `Empty` symbol a program builds can collide with it.
const EMPTY_VALUE: Atom = sym("Empty");

const addCounter = (st: St, n: number): St =>
  n === 0 ? st : { counter: st.counter + n, world: st.world };

const impBail = (): ImpEval => BAIL;

function impMeta(parts: readonly ImpCompiled[]): Pick<ImpCompiled, "directEffect" | "callees"> {
  const callees = new Set<string>();
  let directEffect = false;
  for (const part of parts) {
    if (part.directEffect) directEffect = true;
    for (const c of part.callees) callees.add(c);
  }
  return { directEffect, callees };
}

function impConst(atom: Atom): ImpCompiled {
  return { node: (_slots, st) => ({ value: atom, st }), directEffect: false, callees: new Set() };
}

/** Assemble an expression from part nodes, threading state (the shared shape of the static-data and
 *  match-pattern builders; neither can yield an Empty part). */
function impAssembleExpr(parts: readonly ImpCompiled[]): ImpCompiled {
  return {
    node: (slots, st, ops) => {
      const out: Atom[] = [];
      let cur = st;
      for (const part of parts) {
        const r = part.node(slots, cur, ops);
        if (r === BAIL) return BAIL;
        out.push(r.value);
        cur = r.st;
      }
      return { value: expr(out), st: cur };
    },
    ...impMeta(parts),
  };
}

/** Evaluate argument nodes left to right, threading state. Every argument runs (its effects count)
 *  even when an earlier one came back Empty; an Empty anywhere makes the whole application empty. */
function impEvalArgs(
  parts: readonly ImpCompiled[],
  slots: readonly Atom[],
  st: St,
  ops: CompiledImpureOps,
): { vals: Atom[]; st: St; empty: boolean } | typeof BAIL {
  const vals: Atom[] = [];
  let cur = st;
  let empty = false;
  for (const part of parts) {
    const r = part.node(slots, cur, ops);
    if (r === BAIL) return BAIL;
    if (r.value === EMPTY_VALUE) empty = true;
    vals.push(r.value);
    cur = r.st;
  }
  return { vals, st: cur, empty };
}

function isDataSymbol(env: MinEnv, name: string): boolean {
  return !dataDeny().has(name) && !env.ruleIndex.has(name) && !env.gt.has(name);
}

function compileImpStaticAtom(env: MinEnv, a: Atom, scope: ImpScope): ImpCompiled | undefined {
  if (a.kind === "var") {
    const slot = scope.vars.get(a.name);
    if (slot === undefined) return undefined;
    return {
      node: (slots, st) => ({ value: slots[slot]!, st }),
      directEffect: false,
      callees: new Set(),
    };
  }
  if (a.kind === "sym") return isDataSymbol(env, a.name) ? impConst(a) : undefined;
  if (a.kind === "gnd") return impConst(a);
  if (a.items.length === 0) return impConst(a);
  const head = a.items[0]!;
  // A variable head may bind to a function symbol, so the term is a reducible application, not inert data
  // (same hazard as compileImpAtom; keeps the re-reduce-skip invariant that compiled impure results are
  // already normal form).
  if (head.kind === "var") return undefined;
  if (head.kind === "sym" && !isDataSymbol(env, head.name)) return undefined;
  const items = a.items.map((it) => compileImpStaticAtom(env, it, scope));
  if (items.some((it) => it === undefined)) return undefined;
  return impAssembleExpr(items as ImpCompiled[]);
}

function compileImpGrounded(
  env: MinEnv,
  op: string,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (env.ruleIndex.has(op)) return undefined;
  const parts = args.map((arg) => compileImpAtom(env, arg, scope, holders));
  if (parts.some((part) => part === undefined)) return undefined;
  const compiled = parts as ImpCompiled[];
  return {
    node: (slots, st, ops) => {
      const r = impEvalArgs(compiled, slots, st, ops);
      if (r === BAIL) return BAIL;
      // An Empty argument makes the whole application empty; the remaining args still ran (effects).
      if (r.empty) return { value: EMPTY_VALUE, st: r.st };
      const gr = callGrounded(env.gt, op, r.vals);
      return gr.tag === "ok" && gr.results.length === 1
        ? { value: gr.results[0]!, st: r.st }
        : BAIL;
    },
    ...impMeta(compiled),
  };
}

// Structural pieces of the add-if-absent idiom, matched over the RULE's atoms (variables in place):
// `(if (== () (collapse (once (match S A A)))) (add-atom S A) (empty))`. The same shape the
// interpreter's tryFastNamedAddIfAbsent recognises at runtime; compiled it becomes one ops call.
function impMatchInsideOnce(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || a.items.length !== 2) return undefined;
  const h = a.items[0]!;
  if (h.kind !== "sym" || h.name !== "once") return undefined;
  const inner = a.items[1]!;
  if (inner.kind !== "expr" || inner.items.length !== 4) return undefined;
  const ih = inner.items[0]!;
  return ih.kind === "sym" && ih.name === "match" ? inner : undefined;
}

function impEmptyCollapseMatch(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || a.items.length !== 3) return undefined;
  const h = a.items[0]!;
  if (h.kind !== "sym" || h.name !== "==") return undefined;
  const fromCollapse = (x: Atom): ExprAtom | undefined => {
    if (x.kind !== "expr" || x.items.length !== 2) return undefined;
    const ch = x.items[0]!;
    return ch.kind === "sym" && ch.name === "collapse"
      ? impMatchInsideOnce(x.items[1]!)
      : undefined;
  };
  if (atomEq(a.items[1]!, emptyExpr)) return fromCollapse(a.items[2]!);
  if (atomEq(a.items[2]!, emptyExpr)) return fromCollapse(a.items[1]!);
  return undefined;
}

function compileImpAddIfAbsent(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
): ImpCompiled | undefined {
  const match = impEmptyCollapseMatch(args[0]!);
  if (match === undefined) return undefined;
  const add = args[1]!;
  const otherwise = args[2]!;
  if (add.kind !== "expr" || add.items.length !== 3) return undefined;
  const addHead = add.items[0]!;
  if (addHead.kind !== "sym" || addHead.name !== "add-atom") return undefined;
  if (otherwise.kind !== "expr" || otherwise.items.length !== 1) return undefined;
  const oh = otherwise.items[0]!;
  if (oh.kind !== "sym" || oh.name !== "empty") return undefined;
  if (
    !atomEq(match.items[1]!, add.items[1]!) ||
    !atomEq(match.items[2]!, match.items[3]!) ||
    !atomEq(match.items[2]!, add.items[2]!)
  )
    return undefined;
  const space = compileImpStaticAtom(env, add.items[1]!, scope);
  const atom = compileImpStaticAtom(env, add.items[2]!, scope);
  if (space === undefined || atom === undefined) return undefined;
  return {
    node: (slots, st, ops) => {
      const addIfAbsent = ops.addIfAbsent;
      if (addIfAbsent === undefined) return BAIL;
      const s = space.node(slots, st, ops);
      if (s === BAIL) return BAIL;
      const a = atom.node(slots, s.st, ops);
      if (a === BAIL) return BAIL;
      const r = addIfAbsent(env, a.st, s.value, a.value);
      if (r === undefined) return BAIL;
      return { value: r.added ? emptyExpr : EMPTY_VALUE, st: r.state };
    },
    directEffect: true,
    callees: new Set(),
  };
}

function compileImpIf(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (args.length !== 3 || (env.ruleIndex.get("if")?.length ?? 0) !== 2) return undefined;
  const addIfAbsent = compileImpAddIfAbsent(env, args, scope);
  if (addIfAbsent !== undefined) return addIfAbsent;
  const cond = compileImpAtom(env, args[0]!, scope, holders);
  const then_ = compileImpAtom(env, args[1]!, scope, holders);
  const els = compileImpAtom(env, args[2]!, scope, holders);
  if (cond === undefined || then_ === undefined || els === undefined) return undefined;
  return {
    node: (slots, st, ops, discard) => {
      const c = cond.node(slots, st, ops); // the condition is needed, never discarded
      if (c === BAIL) return BAIL;
      if (c.value === EMPTY_VALUE) return { value: EMPTY_VALUE, st: c.st };
      const stIf = addCounter(c.st, 2);
      if (c.value.kind !== "gnd" || c.value.value.g !== "bool") return BAIL;
      return (c.value.value.b ? then_ : els).node(slots, stIf, ops, discard);
    },
    ...impMeta([cond, then_, els]),
  };
}

function compileImpLet(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (args.length !== 3 || args[0]!.kind !== "var" || (env.ruleIndex.get("let")?.length ?? 0) !== 1)
    return undefined;
  const value = compileImpAtom(env, args[1]!, scope, holders);
  if (value === undefined) return undefined;
  const slot = scope.len;
  const nextScope: ImpScope = {
    vars: new Map(scope.vars).set(args[0]!.name, slot),
    len: slot + 1,
  };
  const body = compileImpAtom(env, args[2]!, nextScope, holders);
  if (body === undefined) return undefined;
  return {
    node: (slots, st, ops, discard) => {
      const v = value.node(slots, st, ops); // the bound value is read by the body, never discarded
      if (v === BAIL) return BAIL;
      // An Empty value has no results, so the let yields nothing: skip the body.
      if (v.value === EMPTY_VALUE) return { value: EMPTY_VALUE, st: v.st };
      const local = slots.slice();
      local[slot] = v.value;
      return body.node(local, addCounter(v.st, 1), ops, discard);
    },
    ...impMeta([value, body]),
  };
}

function compileImpLetStar(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (
    args.length !== 2 ||
    args[0]!.kind !== "expr" ||
    (env.ruleIndex.get("let*")?.length ?? 0) !== 1 ||
    (env.ruleIndex.get("let")?.length ?? 0) !== 1
  )
    return undefined;
  let curScope = scope;
  const bindings: Array<{ readonly slot: number; readonly value: ImpCompiled }> = [];
  for (const pair of args[0]!.items) {
    if (pair.kind !== "expr" || pair.items.length !== 2 || pair.items[0]!.kind !== "var")
      return undefined;
    const value = compileImpAtom(env, pair.items[1]!, curScope, holders);
    if (value === undefined) return undefined;
    const slot = curScope.len;
    bindings.push({ slot, value });
    curScope = {
      vars: new Map(curScope.vars).set(pair.items[0]!.name, slot),
      len: slot + 1,
    };
  }
  const body = compileImpAtom(env, args[1]!, curScope, holders);
  if (body === undefined) return undefined;
  const parts = [...bindings.map((b) => b.value), body];
  return {
    node: (slots, st, ops, discard) => {
      const local = slots.slice();
      let cur = addCounter(st, 1);
      for (const binding of bindings) {
        const v = binding.value.node(local, cur, ops); // each bound value is read later, never discarded
        if (v === BAIL) return BAIL;
        // An Empty value has no results, so the whole let* yields nothing.
        if (v.value === EMPTY_VALUE) return { value: EMPTY_VALUE, st: v.st };
        local[binding.slot] = v.value;
        cur = addCounter(addCounter(v.st, 1), 1);
      }
      return body.node(local, cur, ops, discard);
    },
    ...impMeta(parts),
  };
}

function compileImpAddAtom(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
): ImpCompiled | undefined {
  if (args.length !== 2 || args[0]!.kind !== "sym") return undefined;
  const added = args[1]!;
  if (
    added.kind !== "expr" ||
    added.items.length === 0 ||
    added.items[0]!.kind !== "sym" ||
    added.items[0]!.name === "="
  )
    return undefined;
  const space = compileImpStaticAtom(env, args[0]!, scope);
  const atom = compileImpStaticAtom(env, added, scope);
  if (space === undefined || atom === undefined) return undefined;
  return {
    node: (slots, st, ops) => {
      const s = space.node(slots, st, ops);
      if (s === BAIL) return BAIL;
      const a = atom.node(slots, s.st, ops);
      if (a === BAIL) return BAIL;
      const st2 = ops.addAtom(env, a.st, s.value, a.value);
      return st2 === undefined ? BAIL : { value: emptyExpr, st: st2 };
    },
    directEffect: true,
    callees: new Set(),
  };
}

/** Build a match pattern/template with in-scope variables substituted from slots and everything else
 *  (including free match variables like the `$t` in `(num $t)`) carried literally. Patterns are
 *  structural data by definition, so no head is denied and this always compiles. */
function compileImpPatternAtom(a: Atom, scope: ImpScope): ImpCompiled {
  if (a.kind === "var") {
    const slot = scope.vars.get(a.name);
    if (slot === undefined) return impConst(a);
    return {
      node: (slots, st) => ({ value: slots[slot]!, st }),
      directEffect: false,
      callees: new Set(),
    };
  }
  if (a.kind !== "expr" || a.items.length === 0) return impConst(a);
  return impAssembleExpr(a.items.map((it) => compileImpPatternAtom(it, scope)));
}

// `(case (match SP PAT TPL) ((V BODY)))` with a single bare-variable branch: the saturation step
// (peano's expand-once). The match solutions are a snapshot of the space at entry; each branch runs
// BODY with V bound to one solution, threading effects into the next branch, exactly the streamed
// case's order. A branch whose value is Empty is pruned; the imperative contract is single-valued,
// so more than one surviving branch BAILs (sound: worlds are immutable, so the interpreter re-runs
// from the untouched input state).
function compileImpCaseMatch(
  env: MinEnv,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (args.length !== 2 || (env.ruleIndex.get("case")?.length ?? 0) !== 1) return undefined;
  const scrut = args[0]!;
  if (scrut.kind !== "expr" || scrut.items.length !== 4) return undefined;
  const sh = scrut.items[0]!;
  if (sh.kind !== "sym" || sh.name !== "match") return undefined;
  const pairs = args[1]!;
  if (pairs.kind !== "expr" || pairs.items.length !== 1) return undefined;
  const branch = pairs.items[0]!;
  if (branch.kind !== "expr" || branch.items.length !== 2 || branch.items[0]!.kind !== "var")
    return undefined;
  const space = compileImpStaticAtom(env, scrut.items[1]!, scope);
  if (space === undefined) return undefined;
  const pattern = compileImpPatternAtom(scrut.items[2]!, scope);
  const template = compileImpPatternAtom(scrut.items[3]!, scope);
  const slot = scope.len;
  const branchScope: ImpScope = {
    vars: new Map(scope.vars).set(branch.items[0]!.name, slot),
    len: slot + 1,
  };
  const body = compileImpAtom(env, branch.items[1]!, branchScope, holders);
  if (body === undefined) return undefined;
  return {
    node: (slots, st, ops, discard) => {
      const matchSolutions = ops.matchSolutions;
      if (matchSolutions === undefined) return BAIL;
      const s = space.node(slots, st, ops);
      if (s === BAIL) return BAIL;
      const p = pattern.node(slots, s.st, ops);
      if (p === BAIL) return BAIL;
      const t = template.node(slots, p.st, ops);
      if (t === BAIL) return BAIL;
      const m = matchSolutions(env, t.st, s.value, p.value, t.value);
      if (m === undefined) return BAIL;
      let cur = addCounter(t.st, m.counterDelta);
      const local = slots.slice();
      let survived: Atom | undefined;
      for (const [value] of m.pairs) {
        local[slot] = value;
        const r = body.node(local, cur, ops, discard);
        if (r === BAIL) return BAIL;
        cur = r.st;
        if (r.value !== EMPTY_VALUE) {
          if (survived !== undefined) return BAIL;
          survived = r.value;
        }
      }
      return { value: survived ?? EMPTY_VALUE, st: cur };
    },
    directEffect: true,
    callees: body.callees,
  };
}

function compileImpCall(
  env: MinEnv,
  op: string,
  args: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  const h = holders.get(op);
  if (h === undefined || args.length !== h.arity) return undefined;
  const compiledArgs = args.map((arg) => compileImpAtom(env, arg, scope, holders));
  if (compiledArgs.some((arg) => arg === undefined)) return undefined;
  const parts = compiledArgs as ImpCompiled[];
  const meta = impMeta(parts);
  return {
    node: (slots, st, ops, discard) => {
      const r = impEvalArgs(parts, slots, st, ops); // call args are needed, never discarded
      if (r === BAIL) return BAIL;
      // An Empty argument makes the call empty without invoking it (args already ran for effects).
      if (r.empty) return { value: EMPTY_VALUE, st: r.st };
      return h.run(r.vals, r.st, ops, discard);
    },
    directEffect: meta.directEffect,
    callees: new Set([...meta.callees, op]),
  };
}

function compileImpTuple(
  env: MinEnv,
  items: readonly Atom[],
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  const parts = items.map((it) => compileImpAtom(env, it, scope, holders));
  if (parts.some((part) => part === undefined)) return undefined;
  const compiled = parts as ImpCompiled[];
  return {
    node: (slots, st, ops, discard) => {
      let cur = st;
      if (discard === true) {
        // The result is thrown away (a dead let binding the build never reads). Run each element for its
        // effects, forwarding discard, so a deeply recursive tuple build (matespace's rewriteK) runs all its
        // add-atoms without ever allocating the result tree, then return a shared sentinel. Skipping the cons
        // does not allocate or advance the gensym, so the side effects and the counter are unchanged.
        for (const part of compiled) {
          const r = part.node(slots, cur, ops, true);
          if (r === BAIL) return BAIL;
          cur = r.st;
        }
        return { value: emptyExpr, st: cur };
      }
      const out: Atom[] = [];
      let empty = false;
      for (const part of compiled) {
        const r = part.node(slots, cur, ops);
        if (r === BAIL) return BAIL;
        if (r.value === EMPTY_VALUE) empty = true;
        out.push(r.value);
        cur = r.st;
      }
      // An Empty element makes the whole tuple empty (the cross-product with nothing); the other
      // elements still ran for their effects.
      if (empty) return { value: EMPTY_VALUE, st: cur };
      return { value: expr(out), st: cur };
    },
    ...impMeta(compiled),
  };
}

function compileImpAtom(
  env: MinEnv,
  a: Atom,
  scope: ImpScope,
  holders: ImperativeFns,
): ImpCompiled | undefined {
  if (a.kind !== "expr" || a.items.length === 0) return compileImpStaticAtom(env, a, scope);
  const head = a.items[0]!;
  if (head.kind !== "sym") {
    // A variable head can bind at runtime to a function symbol, so `($f $x)` is a reducible higher-order
    // application, not inert data. The imperative VM would freeze it as a tuple and the dispatch skips
    // re-reducing a compiled impure result, so it would never reduce (e.g. `(doit foo 3)` -> `(foo 3)`
    // instead of `(R 3)`). PeTTa emits a runtime dispatch for a var head (translator.pl: "Unknown head
    // (var/compound) => runtime dispatch"); we bail so the interpreter dispatches it. A compound (expr) head
    // is a tuple whose head is itself an evaluated call to a data-returning function (matespace's rewriteK),
    // which stays compilable.
    if (head.kind === "var") return undefined;
    return compileImpTuple(env, a.items, scope, holders);
  }
  const op = head.name;
  const args = a.items.slice(1);
  if (op === "if") return compileImpIf(env, args, scope, holders);
  if (op === "let") return compileImpLet(env, args, scope, holders);
  if (op === "let*") return compileImpLetStar(env, args, scope, holders);
  if (op === "add-atom") return compileImpAddAtom(env, args, scope);
  if (op === "case") return compileImpCaseMatch(env, args, scope, holders);
  if (IMP_GROUNDED.has(op)) return compileImpGrounded(env, op, args, scope, holders);
  const call = compileImpCall(env, op, args, scope, holders);
  if (call !== undefined) return call;
  return compileImpStaticAtom(env, a, scope);
}

function buildImpScope(params: readonly ParamPat[]): ImpScope | undefined {
  const vars = new Map<string, number>();
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (typeof p !== "string") return undefined;
    vars.set(p, i);
  }
  return { vars, len: params.length };
}

function compileImperative(env: MinEnv, compiled: CompiledFns): void {
  if (env.varRulesVar.length !== 0) return;
  const cand: Cand = new Map();
  for (const f of env.ruleIndex.keys()) {
    if (compiled.has(f)) continue;
    const h = singleClauseHead(env, f);
    if (h !== undefined && h.params.every((p) => typeof p === "string")) cand.set(f, h);
  }
  const holders: ImperativeFns = new Map();
  for (const [f, { params }] of cand)
    holders.set(f, { kind: "imperative", arity: params.length, clauseCount: 1, run: impBail });

  for (;;) {
    let removed = false;
    const bodies = new Map<string, ImpCompiled>();
    for (const [f, h] of [...holders]) {
      const cd = cand.get(f)!;
      const scope = buildImpScope(cd.params);
      const body = scope === undefined ? undefined : compileImpAtom(env, cd.body, scope, holders);
      if (body === undefined) {
        holders.delete(f);
        removed = true;
      } else {
        bodies.set(f, body);
        h.arity = cd.params.length;
      }
    }
    if (removed) continue;

    const effectful = new Set<string>();
    for (const [f, body] of bodies) if (body.directEffect) effectful.add(f);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [f, body] of bodies) {
        if (effectful.has(f)) continue;
        for (const callee of body.callees)
          if (effectful.has(callee)) {
            effectful.add(f);
            changed = true;
            break;
          }
      }
    }
    for (const f of [...holders.keys()])
      if (!effectful.has(f)) {
        holders.delete(f);
        removed = true;
      }
    if (removed) continue;

    for (const [f, body] of bodies) {
      const arity = cand.get(f)!.params.length;
      holders.get(f)!.run = (partAtoms, st, ops, discard) => {
        if (partAtoms.length !== arity || partAtoms.some((a) => !a.ground)) return BAIL;
        // A self-call recurses natively (compileImpCall -> h.run -> body.node), so deep recursion grows the
        // host stack exactly as the interpreter's does. A native stack overflow must PROPAGATE to the
        // top-level `mettaEval` catch, which turns it into `(Error <query> StackOverflow)` — byte-identical
        // to the interpreter overflowing on the same call. Returning BAIL on a RangeError instead would fall
        // back to the interpreter, which re-reduces one level and re-enters the compiled function for the
        // rest, overflowing again: O(depth^2) bail+overflow that lets a StackOverflow escape. So catch only a
        // thrown BAIL sentinel and let everything else (RangeError included) unwind.
        try {
          return body.node(partAtoms, addCounter(st, 1), ops, discard);
        } catch (e) {
          if (e === BAIL) return BAIL;
          throw e;
        }
      };
    }
    for (const [f, h] of holders) compiled.set(f, h);
    return;
  }
}

/** Compile every compilable pure single-clause function in `env` to a memoised native closure.
 *  Phase 1 infers return types (fixpoint, optimistic over recursion). Phase 2 compiles bodies with
 *  those types and drops any that fail end-to-end (a call to an uncompilable function fails too). */
export function compileEnv(env: MinEnv): CompiledFns {
  const pure = env.pureFunctors ?? new Set<string>();
  const cand: Cand = new Map();
  for (const f of pure) {
    const h = singleClauseHead(env, f);
    if (h !== undefined) cand.set(f, h);
  }

  // A holder per candidate, types refined below. retType starts undefined (a sentinel that inferType reads
  // back as "not yet known"); the fixpoint refines both each plain-var parameter's type (from how it is used
  // as a tuple argument) and the return type, since either may depend on the other and on callees.
  const holders: FunctionalFns = new Map();
  for (const [f, { params }] of cand)
    holders.set(f, {
      kind: "functional",
      arity: params.length,
      retType: undefined as unknown as Ty,
      paramTypes: paramTypesOf(params),
      run: bailRun,
    });
  for (let changed = true; changed; ) {
    changed = false;
    for (const [f, { params, body }] of cand) {
      const h = holders.get(f)!;
      params.forEach((p, i) => {
        if (typeof p === "string" && h.paramTypes[i] === "int") {
          const t = inferVarType(body, p, holders);
          if (t !== undefined && t !== "int") {
            h.paramTypes[i] = t;
            changed = true;
          }
        }
      });
      if ((h.retType as Ty | undefined) === undefined) {
        const rt = inferType(body, varTypesOf(params, h.paramTypes), holders);
        if (rt !== undefined) {
          h.retType = rt;
          changed = true;
        }
      }
    }
  }
  for (const [f, h] of [...holders])
    if ((h.retType as Ty | undefined) === undefined) holders.delete(f);

  for (;;) {
    let removed = false;
    const result = new Map<string, { node: Node; arity: number }>();
    for (const [f] of [...holders]) {
      const cd = cand.get(f)!;
      const c = compileTail(cd.body, buildScope(cd.params, holders.get(f)!.paramTypes), holders, f);
      if (c === undefined) {
        holders.delete(f);
        removed = true;
      } else {
        result.set(f, { node: c.node, arity: cd.params.length });
      }
    }
    if (!removed) {
      for (const [f, { node, arity }] of result)
        holders.get(f)!.run = makeRun(arity, node, selfCallCount(cand.get(f)!.body, f) >= 2);
      const compiled: CompiledFns = new Map(holders);
      for (const f of pure) {
        if (compiled.has(f)) continue;
        const rewrite = compileRewrite(env, f);
        if (rewrite !== undefined) {
          compiled.set(f, rewrite);
          continue;
        }
        const symbolic = compileSymbolic(env, f);
        if (symbolic !== undefined) compiled.set(f, symbolic);
      }
      compileImperative(env, compiled);
      // Nondeterministic let*-chain functors (impure via `match`, so outside the pure set).
      for (const f of env.ruleIndex.keys()) {
        if (compiled.has(f)) continue;
        const nondet = compileNondet(env, f);
        if (nondet !== undefined) compiled.set(f, nondet);
      }
      return compiled;
    }
  }
}

/** Run a compiled function, returning an ordered result bag, or `undefined` to fall back to the interpreter
 *  when the call falls outside the proven subset. */
export function runCompiled(
  env: MinEnv,
  op: string,
  partAtoms: readonly Atom[],
  st: St,
  ops?: CompiledImpureOps,
  discard?: boolean,
): CompiledRunResult | undefined {
  const h = env.compiled?.get(op);
  if (h === undefined || partAtoms.length !== h.arity) return undefined;
  if (h.kind === "rewrite") return h.run(partAtoms);
  if (h.kind === "symbolic") return h.run(partAtoms, st.counter);
  if (h.kind === "nondet") {
    if (ops === undefined) return undefined;
    return h.run(env, partAtoms, st, ops);
  }
  if (h.kind === "imperative") {
    if (ops === undefined) return undefined;
    const r = h.run(partAtoms, st, ops, discard);
    if (r === BAIL) return undefined;
    // An Empty value is a pruned computation: the call vanishes (zero results), effects kept.
    if (r.value === EMPTY_VALUE) return { results: [], counterDelta: 0, state: r.st };
    return { results: [{ atom: r.value, bnd: emptyBindings }], counterDelta: 0, state: r.st };
  }
  // An argument is a ground int, or a flat tuple of ground ints `(i1 i2 ...)` (the iterate/quad-step state).
  const vals: FrameVal[] = [];
  for (const a of partAtoms) {
    if (a.kind === "gnd" && a.value.g === "int") vals.push(a.value.n);
    else if (
      a.kind === "expr" &&
      a.items.length > 0 &&
      a.items.every((x) => x.kind === "gnd" && x.value.g === "int")
    )
      vals.push(new Tup(a.items.map((x) => (x as { value: { n: IntVal } }).value.n)));
    else return undefined;
  }
  try {
    const r = h.run(vals);
    const atom =
      typeof r === "boolean"
        ? gbool(r)
        : r instanceof Tup
          ? expr(r.v.map((n) => gint(n)))
          : gint(r);
    return { results: [{ atom, bnd: emptyBindings }], counterDelta: 0 };
  } catch (e) {
    if (e === BAIL || e instanceof RangeError) return undefined;
    throw e;
  }
}
