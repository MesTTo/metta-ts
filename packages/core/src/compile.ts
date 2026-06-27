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
import { type Atom, expr, gint, gbool } from "./atom";
import { type IntVal, addInt, subInt, mulInt, intDiv, intMod, isZero, cmpIntVal } from "./number";
import { type MinEnv } from "./eval";

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
type Ty = "int" | "bool" | `tuple${number}`;
type Node = (frame: FrameVal[]) => FrameVal | boolean;
interface Compiled {
  readonly node: Node;
  readonly type: Ty;
}

/** A compiled function. `run` is filled after the whole dependency group is compiled, so mutual
 *  recursion resolves through the holder object. */
export interface CompiledHolder {
  arity: number;
  retType: Ty;
  paramTypes: Ty[];
  run: (vals: FrameVal[]) => FrameVal | boolean;
}
export type CompiledFns = Map<string, CompiledHolder>;

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
  holders: CompiledFns,
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
  holders: CompiledFns,
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
function compileBody(a: Atom, scope: Scope, holders: CompiledFns): Compiled | undefined {
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
  holders: CompiledFns,
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

const bailRun = (): IntVal | boolean => {
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
function inferVarType(body: Atom, name: string, holders: CompiledFns): Ty | undefined {
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
  holders: CompiledFns,
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
  const holders: CompiledFns = new Map();
  for (const [f, { params }] of cand)
    holders.set(f, {
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
      return holders;
    }
  }
}

/** Run a compiled function for a ground-int call, returning the result atom, or `undefined` to fall
 *  back to the interpreter (not compiled, non-int args, or a runtime bail). */
export function runCompiled(env: MinEnv, op: string, partAtoms: readonly Atom[]): Atom | undefined {
  const h = env.compiled?.get(op);
  if (h === undefined || partAtoms.length !== h.arity) return undefined;
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
    if (typeof r === "boolean") return gbool(r);
    if (r instanceof Tup) return expr(r.v.map((n) => gint(n)));
    return gint(r);
  } catch (e) {
    if (e === BAIL || e instanceof RangeError) return undefined;
    throw e;
  }
}
