// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The minimal MeTTa interpreter and type-directed evaluator: a faithful port of LeaTTa
// `MettaHyperonFull/Minimal/Interpreter.lean` (itself a port of Hyperon `interpreter.rs`).
// A CPS nondeterministic stack machine over the minimal instructions, with `mettaEval` (the
// type-directed metta-call loop) on top. The driver is iterative to keep the JS stack shallow.
import {
  type Atom,
  type ExprAtom,
  type InternTable,
  sym,
  variable,
  expr,
  internAtom,
  internBuiltExpr,
  gint,
  atomEq,
  atomVars,
  collectVars,
  emptyExpr,
  isErrorAtom,
  metaType,
} from "./atom";
import {
  type Bindings,
  type BindingRel,
  emptyBindings,
  hasLoop,
  size,
  makeValRel,
  hasEq,
  eqRelations,
  fromRelations,
  valEntries,
  lookupVal,
} from "./bindings";
import { format } from "./parser";
import { matchAtoms, matchAtomsScoped, merge, addVarBinding } from "./match";
import { Trail, unifyTrail } from "./trail";
import { instantiate } from "./instantiate";
import { type Subst, applySubst } from "./substitution";
import {
  type AtomLog,
  emptyLog,
  logSize,
  logAppendAll,
  logToArray,
  logFromArray,
  logNonGround,
  logGroundIdx,
  idxCount,
} from "./atomlog";
import { FlatAtomSpace } from "./flat-atomspace";
import { type Relation, wcoJoin, wcoJoinFold } from "./wcojoin";
import { type GroundingTable, type ReduceResult, callGrounded, pettaOpNames } from "./builtins";
import { tableKey, keyWellFormed, analyzePurity as analyzePurityRef, IMPURE_OPS } from "./tabling";
import { runCompiled, compileEnv, type CompiledFns, type CompiledImpureOps } from "./compile";
import { type IntVal, addInt, subInt } from "./number";

// Constructor / normal-form short-circuit, on by default. `METTA_CTOR_SC=0` disables it for A/B measurement.
const CTOR_SC = process.env.METTA_CTOR_SC !== "0";
// Internal A/B gate for the `(case (match ...) cases)` streaming path. Default on; `0` restores the
// materializing stdlib expansion in one binary.
const STREAM_CASE = process.env.METTA_STREAM_CASE !== "0";

// ---------- generator-based evaluation (sync core, optional async) ----------
// The driver functions are generators that `yield` a pending Promise only at the one async boundary
// (an async grounded operation). A sync driver runs a generator to completion and throws if it ever
// actually suspends; an async driver awaits the yielded Promises. One implementation, two drivers
// (the gensync / Effect pattern), so the synchronous path is unchanged in behaviour and async is
// purely additive. `yield*` propagates a suspension up through the whole nested call chain.
/** A grounded operation that runs asynchronously, for the async runner. */
export type AsyncGroundFn = (args: readonly Atom[]) => Promise<ReduceResult>;
// A suspension is any Promise the async driver awaits; each yield site knows its resolved type. The
// grounded boundary yields a Promise<ReduceResult>; the concurrency primitives yield Promise<[pairs,St]>.
type Susp = Promise<unknown>;
type Gen<R> = Generator<Susp, R, unknown>;
type EvalRes = [Array<[Atom, Bindings]>, St];
interface CandidateSource extends Iterable<Atom> {
  readonly counterPadding?: number;
}

function exactCandidateSource(atom: Atom, count: number, total: number): CandidateSource {
  return {
    counterPadding: total - count,
    *[Symbol.iterator](): Iterator<Atom> {
      for (let i = 0; i < count; i++) yield atom;
    },
  };
}

const candidateCounterPadding = (source: CandidateSource): number => source.counterPadding ?? 0;

const syntheticCandidateSource = (source: CandidateSource): boolean =>
  Object.prototype.hasOwnProperty.call(source, "counterPadding");

// TS-native concurrency primitives (async-only): par/race evaluate their argument expressions
// concurrently; with-mutex serialises a critical section across await points. Their arguments are NOT
// eagerly evaluated (the op drives them), and reaching them in the sync driver throws AsyncInSyncError.
const LAZY_ARGS_OPS = new Set(["par", "race", "once", "with-mutex"]);

/** Thrown when synchronous evaluation reaches an async grounded operation. Use the async runner. */
export class AsyncInSyncError extends Error {
  constructor(op: string) {
    super(
      `async grounded operation '${op}' reached in synchronous evaluation; use the async runner`,
    );
    this.name = "AsyncInSyncError";
  }
}

let pendingAsyncOp = "?";
function runGenSync<R>(gen: Gen<R>): R {
  const r = gen.next();
  if (!r.done) throw new AsyncInSyncError(pendingAsyncOp);
  return r.value;
}
/** Drive a generator asynchronously, awaiting each yielded Promise. An optional `signal` makes the
 *  evaluation cancellable: it is checked at every suspension point, so a losing `race` branch stops at
 *  its next await (cooperative cancellation; JS cannot preempt a running synchronous computation). */
async function runGenAsync<R>(gen: Gen<R>, signal?: AbortSignal): Promise<R> {
  let r = gen.next();
  while (!r.done) {
    signal?.throwIfAborted();
    const v = await r.value;
    signal?.throwIfAborted();
    r = gen.next(v);
  }
  return r.value;
}

/** The grounded-operation boundary: a sync op returns immediately; an async op (in `env.agt`) yields its
 *  Promise, which the async driver awaits and the sync driver rejects. */
function* callGroundedG(env: MinEnv, op: string, args: readonly Atom[]): Gen<ReduceResult> {
  const af = env.agt.get(op);
  if (af !== undefined) {
    pendingAsyncOp = op;
    return (yield af(args)) as ReduceResult;
  }
  return callGrounded(env.gt, op, args);
}

// ---------- machine types ----------
export type Ret = "none" | "chain" | "function";
export interface Frame {
  readonly atom: Atom;
  readonly ret: Ret;
  readonly vars: readonly string[];
  readonly fin: boolean;
}
// The evaluation stack as an immutable cons-list (O(1) push/rest, no per-step array slice/spread;
// the array form showed up as ArrayPrototypeSlice in the profile). `null` is the empty stack.
export interface StackCons {
  readonly head: Frame;
  readonly tail: Stack;
}
export type Stack = StackCons | null;
const cons = (head: Frame, tail: Stack): StackCons => ({ head, tail });
export interface Item {
  readonly stack: Stack;
  readonly bnd: Bindings;
}
interface ItemSource {
  readonly endState: St;
  foldItems(): Iterable<Item>;
}
type ItemBatch = Item[] | ItemSource;
function isItemSource(work: Item[] | ItemSource): work is ItemSource {
  return !Array.isArray(work);
}
const frame = (
  atom: Atom,
  ret: Ret = "none",
  vars: readonly string[] = [],
  fin = false,
): Frame => ({
  atom,
  ret,
  vars,
  fin,
});

const notReducibleA = sym("NotReducible");
const emptyA = sym("Empty");
const unitA = emptyExpr;
const errAtom = (a: Atom, msg: string): Atom => expr([sym("Error"), a, sym(msg)]);
const makeExpr = (_env: MinEnv, items: readonly Atom[]): ExprAtom => expr(items);
const inst = (env: MinEnv, b: Bindings, a: Atom, suffix = ""): Atom =>
  instantiate(b, a, suffix, env.intern);

// ---------- atom destructuring helpers ----------
function opOf(a: Atom): string | undefined {
  return a.kind === "expr" && a.items.length > 0 && a.items[0]!.kind === "sym"
    ? (a.items[0] as { name: string }).name
    : undefined;
}

/** Parallel `hyperpose`: when `arg` is `(hyperpose (b1 … bn))` with every branch a pure, ground call and a
 *  Node worker pool is installed (`env.parEval`), evaluate the branches in parallel OS threads and return the
 *  flattened results in branch order. PeTTa forks a thread per branch; our cooperative concurrency cannot,
 *  because a branch compiled to a native loop runs to completion without yielding, so an expensive leading
 *  branch starves a cheap later one. Each branch is re-evaluated from the program's static rules in a worker,
 *  so it is only safe when (1) the branch is pure (reads/writes no space, no IO) and ground, and (2) no rule
 *  was added at runtime (the worker would not have it). Then it is identical to evaluating the branch in line.
 *  `firstOnly` (for `(once (hyperpose …))`) makes the pool stop and return as soon as one branch finishes.
 *  Returns `undefined` (caller falls back to sequential evaluation) when any precondition fails. */
function tryParHyperpose(
  env: MinEnv,
  world: World,
  bnd: Bindings,
  arg: Atom,
  firstOnly: boolean,
): Atom[] | undefined {
  if (env.parEval === undefined) return undefined;
  if (world.selfRules.size > 0) return undefined;
  const a = inst(env, bnd, arg);
  if (a.kind !== "expr" || opOf(a) !== "hyperpose" || a.items.length !== 2) return undefined;
  const tup = a.items[1]!;
  if (tup.kind !== "expr" || tup.items.length === 0) return undefined;
  const branches = tup.items;
  for (const b of branches) {
    const h = opOf(b);
    if (!b.ground || h === undefined || env.pureFunctors?.has(h) !== true) return undefined;
  }
  const perBranch = env.parEval(branches.map(format), firstOnly);
  const out: Atom[] = [];
  for (const r of perBranch) if (r !== null) for (const at of r) out.push(at);
  return out;
}
const EMBEDDED = new Set([
  "eval",
  "evalc",
  "chain",
  "unify",
  "cons-atom",
  "decons-atom",
  "function",
  "collapse-bind",
  "superpose-bind",
  "metta",
  "metta-thread",
  "capture",
  "context-space",
  "match",
  "get-type",
  "get-type-space",
  "get-doc",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "add-atom",
  "remove-atom",
  "get-atoms",
  "bind!",
  "import!",
  // Sets interpreter settings in-language (Hyperon `pragma!`); stateful, so handled here not as a pure op.
  "pragma!",
  // TS-native extension (not upstream MeTTa): atomic space mutation with rollback.
  "transaction",
  // TS-native concurrency primitives (async-only); see docs/.../concurrency-primitives.md.
  "par",
  "race",
  "once",
  "with-mutex",
]);
function isEmbeddedOp(a: Atom): boolean {
  const op = opOf(a);
  return op !== undefined && EMBEDDED.has(op);
}

const varsCopy = (prev: Stack): readonly string[] => (prev !== null ? prev.head.vars : []);

function isVariableHeaded(a: Atom): boolean {
  if (a.kind === "var") return true;
  if (a.kind === "expr" && a.items.length > 0) return isVariableHeaded(a.items[0]!);
  return false;
}

function headKey(a: Atom): string | undefined {
  if (a.kind === "sym") return a.name;
  if (a.kind === "expr" && a.items.length > 0 && a.items[0]!.kind === "sym")
    return (a.items[0] as { name: string }).name;
  return undefined;
}

// A head some reduction can fire on: it carries an equation (static or runtime), a type signature (so
// type-directed evaluation applies), or a grounded/built-in implementation. Its negation is Curry's
// "constructor" — a symbol that only builds data and never reduces. The signature check is what makes this
// derive from env data alone: every interpreter special form (`if`, `let`, `eval`, `match`, …) is declared in
// the prelude, so no reserved-vocabulary list is needed.
function isDefinedHead(env: MinEnv, w: World, name: string): boolean {
  return (
    env.ruleIndex.has(name) ||
    env.sigs.has(name) ||
    w.selfRules.has(name) ||
    env.gt.has(name) ||
    IMPURE_OPS.has(name)
  );
}

// Is `t` already in normal form — no rewrite or grounded reduction can fire anywhere in it? Constructor/
// defined partition (Curry; Hanus, normalizing narrowing): a constructor-rooted term is irreducible at the
// head and reduces only if a subterm does. Caller restricts use to when no catch-all (`($x …)`) equation
// exists, so a constructor head's `candidatesW` is empty and re-evaluating `t` is a pure no-op that advances
// nothing — which is why the short-circuit can return `t` as-is, byte-identically.
function isNormalForm(env: MinEnv, w: World, t: Atom): boolean {
  switch (t.kind) {
    case "var":
    case "gnd":
      return true;
    case "sym":
      return !isDefinedHead(env, w, t.name);
    case "expr": {
      const its = t.items;
      if (its.length === 0) return true;
      const h = its[0]!;
      if (h.kind !== "sym" || isDefinedHead(env, w, h.name)) return false;
      for (let i = 1; i < its.length; i++) if (!isNormalForm(env, w, its[i]!)) return false;
      return true;
    }
  }
}

function isNormalFormAssumingVars(env: MinEnv, w: World, t: Atom): boolean {
  switch (t.kind) {
    case "var":
      return true;
    case "sym":
    case "gnd":
      return isNormalForm(env, w, t);
    case "expr": {
      if (t.items.length === 0) return true;
      const h = t.items[0]!;
      return (
        h.kind === "sym" &&
        !isDefinedHead(env, w, h.name) &&
        t.items.every((x) => isNormalFormAssumingVars(env, w, x))
      );
    }
  }
}

// ---------- atom_to_stack ----------
function atomToStack(a: Atom, prev: Stack): Stack {
  if (a.kind === "expr") {
    const op = opOf(a);
    const it = a.items;
    if (op === "chain" && it.length === 4 && it[2]!.kind === "var") {
      return atomToStack(it[1]!, cons(frame(a, "chain", varsCopy(prev)), prev));
    }
    if (op === "function" && it.length === 2 && it[1]!.kind === "expr") {
      return atomToStack(it[1]!, cons(frame(a, "function", varsCopy(prev)), prev));
    }
    if (op === "unify" && it.length === 5) {
      return cons(frame(a, "none"), prev);
    }
    if (op === "chain") return cons(frame(errAtom(a, "chain: malformed"), "none", [], true), prev);
    if (op === "function")
      return cons(frame(errAtom(a, "function: malformed"), "none", [], true), prev);
    if (op === "unify") return cons(frame(errAtom(a, "unify: malformed"), "none", [], true), prev);
  }
  return cons(frame(a, "none", varsCopy(prev)), prev);
}

function finItem(st: Stack, a: Atom, b: Bindings): Item {
  return { stack: cons(frame(a, "none", [], true), st), bnd: b };
}

function evalResult(prev: Stack, r: Atom, b: Bindings): Item {
  if (opOf(r) === "function") return { stack: atomToStack(r, prev), bnd: b };
  return finItem(prev, r, b);
}

// ---------- env (MinEnv) ----------
export interface MinEnv {
  ruleIndex: Map<string, Array<[Atom, Atom]>>;
  varRules: Array<[Atom, Atom]>;
  // The genuinely variable-headed (`($x …)`) subset of `varRules`. Those can match a query of ANY head;
  // the rest of `varRules` are expression-headed (e.g. PeTTa's `((|-> …) …)` applicators) and can only match
  // an expression-headed query. Kept as a separate list so a symbol/grounded query skips the dead probes.
  varRulesVar: Array<[Atom, Atom]>;
  sigs: Map<string, Atom[]>;
  gt: GroundingTable;
  atoms: Atom[];
  types: Map<string, Atom[]>;
  imports: Map<string, Atom[]>;
  exprTypes: Array<[Atom, Atom]>;
  /** Async grounded operations, dispatched by the async runner; empty for pure synchronous evaluation. */
  agt: Map<string, AsyncGroundFn>;
  /** Per-runner `with-mutex` locks (a Promise chain per key), so mutexes do not leak across runners. */
  mutexes: Map<string, Promise<void>>;
  /** Optional per-run hash-cons table for immutable terms. */
  intern?: InternTable;
  /** Ground expressions already observed to reduce to themselves for the current rule set. */
  evaluatedAtoms: WeakSet<Atom>;
  // Clause indexing over &self atoms, so `match` scales past a linear scan (Prolog-style clause indexing).
  // `factIndex` maps an atom's head key (functor for an expression, name for a symbol) to its atoms;
  // used for variable/expression first-argument queries. `argIndex` is the finer index, keyed by
  // `functor + arg key` for atoms whose first argument is a ground leaf, so a query like
  // `(edge 500000 $y)` jumps straight to the matching row even when a million atoms share the functor.
  // `nonGroundAtPos` holds atoms of a functor whose first argument is not a ground leaf (variable or
  // expression), which must be considered for any first-argument query of that functor.
  // `varHeadedFacts` holds atoms with no head key (variable-headed), which can unify with any pattern.
  factIndex: Map<string, Atom[]>;
  argIndex: Map<string, Atom[]>;
  nonGroundAtPos: Map<string, Atom[]>;
  varHeadedFacts: Atom[];
  /** Automatic-tabling memo: a ground pure call's printed form maps to its ordered result bag.
   *  `undefined` when tabling is disabled. */
  table?: Map<string, Atom[]>;
  /** Functor names proven tabling-safe by `analyzePurity`; recomputed when equations change. */
  pureFunctors?: Set<string>;
  /** Memo for `getTypes` of ground atoms: a ground atom's type is a pure function of the env's type tables,
   *  which only change via `addAtomToEnv` (where this is reset). Keyed by atom identity, so the recursion
   *  reuses the type of every shared subterm (a growing Peano/list term is the worst case otherwise). */
  typeCache?: WeakMap<Atom, Atom[]> | undefined;
  /** Optional parallel branch evaluator for `hyperpose` (set by the Node runner to a worker_threads pool;
   *  undefined in the browser). Given the formatted branch atoms and whether to stop at the first result,
   *  returns each branch's result atoms, or `null` for a branch that errored or (under firstOnly) lost the
   *  race. It re-evaluates each branch from the program's rules in a worker, so it is only used when a branch
   *  is pure and the space carries no runtime additions, so it is identical to evaluating in line. */
  parEval?: (branchSrcs: string[], firstOnly: boolean) => (Atom[] | null)[];
  /** Compiled pure deterministic functions (the int/bool functional core); undefined when disabled. */
  compiled?: CompiledFns | undefined;
  /** Set when an equation changed, so the compiler re-runs before the next query. */
  compileDirty?: boolean | undefined;
  /** Opt-in PeTTa-style auto-currying, enabled by `(import! &self curry)`. When set, a symbol-headed
   *  call applied to fewer arguments than the function's arity reduces to `(partial fn (args))` instead
   *  of staying irreducible. Off by default, so the Hyperon oracle baseline is unaffected. */
  curry?: boolean;
  /** Opt-in trail-based matching (`experimental.trail`): the conjunctive `match` enumerates on a WAM-style
   *  trail (zero per-solution allocation) instead of the immutable `Bindings`/`merge` threading. Off by
   *  default; byte-identical to the reference matcher (differential-gated), falling back to it per query for
   *  cases the trail cannot reproduce (custom grounded matchers). */
  useTrail?: boolean;
  /** Opt-in compact runtime `&self` atomspace. Off by default; when on, runtime additions are stored as flat
   *  term ids and decoded only when a query or observable operation needs tree atoms. */
  useFlatAtomspace?: boolean;
}

const KEY_SEP = "\x01";
const ARG_SEP = "\x00";

/** Index key for a ground-leaf first argument (symbol or grounded primitive); undefined for a variable,
 *  an expression, or a non-primitive grounded value (which are not first-argument indexable). */
function argKey(a: Atom): string | undefined {
  if (a.kind === "sym") return "s" + ARG_SEP + a.name;
  if (a.kind === "gnd") {
    const v = a.value;
    switch (v.g) {
      case "int":
        return "i" + ARG_SEP + v.n;
      case "float":
        return "f" + ARG_SEP + v.n;
      case "str":
        return "S" + ARG_SEP + v.s;
      case "bool":
        return "b" + ARG_SEP + (v.b ? "1" : "0");
      default:
        return undefined;
    }
  }
  return undefined;
}

function pushTo(m: Map<string, Atom[]>, k: string, x: Atom): void {
  const cur = m.get(k);
  if (cur === undefined) m.set(k, [x]);
  else cur.push(x);
}

/** An empty environment for grounding table `gt`. Grow it with `addAtomToEnv`. */
export function emptyEnv(gt: GroundingTable): MinEnv {
  return {
    ruleIndex: new Map(),
    varRules: [],
    varRulesVar: [],
    sigs: new Map(),
    gt,
    atoms: [],
    types: new Map(),
    imports: new Map(),
    exprTypes: [],
    agt: new Map(),
    mutexes: new Map(),
    evaluatedAtoms: new WeakSet(),
    factIndex: new Map(),
    argIndex: new Map(),
    nonGroundAtPos: new Map(),
    varHeadedFacts: [],
  };
}

/** Static load (`addAtomToEnv`) added a `=` equation into `env.ruleIndex`, which the purity
 *  analysis does see, so clear the memo and re-derive purity. */
function invalidateTabling(env: MinEnv): void {
  if (env.table !== undefined) {
    env.table.clear();
    env.pureFunctors = analyzePurityRef(env);
    env.compileDirty = true;
  }
}

// ---------- higher-order specialization (after PeTTa's src/specializer.pl) ----------
// A function passed to another as an argument blocks compilation: iterate's `$step` is called as
// `($step $i $state)`, and the typed compiled core cannot type a call to an unknown `$step`. PeTTa's answer
// is to SPECIALIZE the call: bind the higher-order parameter to the concrete function, producing a
// first-order clone (`iterate$quad-step`) with the recursion rewritten to the clone, so it compiles. Done
// once over the static rules; byte-identical to the original because the clone computes the same thing.

/** Does `a` use variable `name` as the head of an application `($name ...)`? */
function usedAsHead(a: Atom, name: string): boolean {
  if (a.kind !== "expr" || a.items.length === 0) return false;
  if (a.items[0]!.kind === "var" && (a.items[0] as { name: string }).name === name) return true;
  return a.items.some((it) => usedAsHead(it, name));
}

/** Per single-clause functor, its arity and the parameter indices used higher-order in its body. */
function hoFunctors(env: MinEnv): Map<string, { arity: number; idxs: number[] }> {
  const out = new Map<string, { arity: number; idxs: number[] }>();
  for (const [g, eqs] of env.ruleIndex) {
    if (eqs.length !== 1) continue;
    const [lhs, rhs] = eqs[0]!;
    if (lhs.kind !== "expr") continue;
    const idxs: number[] = [];
    for (let k = 0; k < lhs.items.length - 1; k++) {
      const p = lhs.items[k + 1]!;
      if (p.kind === "var" && usedAsHead(rhs, p.name)) idxs.push(k);
    }
    if (idxs.length > 0) out.set(g, { arity: lhs.items.length - 1, idxs });
  }
  return out;
}

/** Build the specialized body: `($pk args)` -> `(fsym args)`; a recursive `(g ... $pk@k ...)` ->
 *  `(sName ... without arg k)`; a bare `$pk` -> `fsym`. */
function specBody(
  a: Atom,
  pk: string,
  fsym: string,
  g: string,
  sName: string,
  k: number,
  gArity: number,
): Atom {
  const rec = (x: Atom): Atom => specBody(x, pk, fsym, g, sName, k, gArity);
  if (a.kind === "var") return a.name === pk ? sym(fsym) : a;
  if (a.kind !== "expr" || a.items.length === 0) return a;
  const h = a.items[0]!;
  if (h.kind === "var" && h.name === pk) return expr([sym(fsym), ...a.items.slice(1).map(rec)]);
  if (h.kind === "sym" && h.name === g && a.items.length - 1 === gArity) {
    const argK = a.items[k + 1]!;
    if (argK.kind === "var" && argK.name === pk)
      return expr([
        sym(sName),
        ...a.items
          .slice(1)
          .filter((_, i) => i !== k)
          .map(rec),
      ]);
  }
  return expr(a.items.map(rec));
}

/** Create (once) the specialization of `g` at parameter `k` bound to function symbol `fsym`; returns its
 *  name, or undefined if `g` is not a single-clause var-headed rule. */
function makeSpec(env: MinEnv, g: string, k: number, fsym: string): string | undefined {
  const sName = g + "$" + fsym;
  if (env.ruleIndex.has(sName)) return sName;
  const eqs = env.ruleIndex.get(g);
  if (eqs === undefined || eqs.length !== 1) return undefined;
  const [lhs, rhs] = eqs[0]!;
  if (lhs.kind !== "expr") return undefined;
  const params = lhs.items.slice(1);
  const pk = params[k];
  if (pk === undefined || pk.kind !== "var") return undefined;
  const newLhs = expr([sym(sName), ...params.filter((_, i) => i !== k)]);
  const newRhs = specBody(rhs, pk.name, fsym, g, sName, k, params.length);
  addAtomToEnv(env, expr([sym("="), newLhs, newRhs]));
  return sName;
}

/** Rewrite higher-order calls in `a`: `(g ... fsym@k ...)`, where g is higher-order at k and the kth arg is
 *  a function symbol, becomes a call to g's specialization with that argument dropped. */
function rewriteHO(env: MinEnv, a: Atom, ho: Map<string, { arity: number; idxs: number[] }>): Atom {
  if (a.kind !== "expr" || a.items.length === 0) return a;
  const items = a.items.map((x) => rewriteHO(env, x, ho));
  const h = items[0]!;
  if (h.kind === "sym") {
    const info = ho.get(h.name);
    if (info !== undefined && items.length - 1 === info.arity) {
      for (const k of info.idxs) {
        const argK = items[k + 1];
        if (argK !== undefined && argK.kind === "sym" && env.ruleIndex.has(argK.name)) {
          const sName = makeSpec(env, h.name, k, argK.name);
          if (sName !== undefined)
            return expr([sym(sName), ...items.slice(1).filter((_, i) => i !== k)]);
        }
      }
    }
  }
  // Unchanged subtree: return the original atom so the caller can detect "no rewrite" by identity (this also
  // keeps the pass idempotent when it re-runs on each recompile).
  return items.every((it, i) => it === a.items[i]) ? a : expr(items);
}

/** Rewrite every static rule body's higher-order calls to specialized first-order functions. Idempotent and
 *  required on each recompile because the runner may evaluate a leading bang (and trigger the first compile)
 *  before the program's own equations are even loaded. */
function specializeHO(env: MinEnv): void {
  const ho = hoFunctors(env);
  if (ho.size === 0) return;
  // Snapshot the rule bodies first: makeSpec adds new rules as it goes, and a specialized body is already
  // first-order, so it never needs another pass.
  const rules: Array<[string, Atom, Atom]> = [];
  for (const [g, eqs] of env.ruleIndex) for (const [lhs, rhs] of eqs) rules.push([g, lhs, rhs]);
  for (const [g, lhs, rhs] of rules) {
    const newRhs = rewriteHO(env, rhs, ho);
    if (newRhs !== rhs) {
      const eqs = env.ruleIndex.get(g);
      if (eqs !== undefined)
        for (let i = 0; i < eqs.length; i++)
          if (eqs[i]![0] === lhs && eqs[i]![1] === rhs) eqs[i] = [lhs, newRhs];
    }
  }
}

/** Re-run the deterministic-core compiler if an equation changed since the last query. */
function ensureCompiled(env: MinEnv): void {
  if (env.compiled !== undefined && env.compileDirty) {
    specializeHO(env);
    env.compiled = compileEnv(env);
    env.compileDirty = false;
  }
}

/** Runtime `add-atom`/`import!` adds equations into the world's `selfExtra`, which the purity
 *  analysis (reading `env.ruleIndex`) does NOT see. Conservatively disable further tabling for the
 *  rest of this run; compiled static rewrites stay available but are gated at the call site when runtime
 *  rules can affect that operator. */
function disableTabling(env: MinEnv): void {
  env.evaluatedAtoms = new WeakSet();
  env.compiled = undefined;
  env.compileDirty = undefined;
  if (env.table !== undefined) {
    env.table.clear();
    env.pureFunctors = new Set();
  }
}

/** Incorporate one atom into `env` (mutating): rule index, signatures, types, and the atom list.
 *  Lets a sequential runner extend the env per atom instead of rebuilding it each query; correctness
 *  gated by the 270/270 oracle. */
export function addAtomToEnv(env: MinEnv, x: Atom): void {
  const atom = env.intern === undefined ? x : internAtom(env.intern, x);
  env.atoms.push(atom);
  // Clause-index for fast `match` candidate selection: by functor, and by functor+first-arg when the
  // first argument is a ground leaf.
  const fk = headKey(atom);
  if (fk === undefined) env.varHeadedFacts.push(atom);
  else {
    pushTo(env.factIndex, fk, atom);
    // Index by every argument position: a ground leaf goes in argIndex; a variable/expression argument
    // goes in nonGroundAtPos (it stays a candidate for any query that binds that position).
    if (atom.kind === "expr")
      for (let i = 1; i < atom.items.length; i++) {
        const ak = argKey(atom.items[i]!);
        if (ak !== undefined) pushTo(env.argIndex, fk + KEY_SEP + i + KEY_SEP + ak, atom);
        else pushTo(env.nonGroundAtPos, fk + KEY_SEP + i, atom);
      }
  }
  if (opOf(atom) === "=" && atom.kind === "expr" && atom.items.length === 3) {
    env.evaluatedAtoms = new WeakSet();
    const lhs = atom.items[1]!;
    const rhs = atom.items[2]!;
    const k = headKey(lhs);
    if (k === undefined) {
      env.varRules.push([lhs, rhs]);
      if (isVariableHeaded(lhs)) env.varRulesVar.push([lhs, rhs]);
    } else {
      const cur = env.ruleIndex.get(k);
      if (cur === undefined) env.ruleIndex.set(k, [[lhs, rhs]]);
      else cur.push([lhs, rhs]);
    }
    invalidateTabling(env);
  }
  if (atom.kind === "expr" && opOf(atom) === ":" && atom.items.length === 3) {
    const subj = atom.items[1]!;
    const t = atom.items[2]!;
    if (subj.kind === "sym") {
      if (opOf(t) === "->" && t.kind === "expr") env.sigs.set(subj.name, t.items.slice(1));
      env.types.set(subj.name, [...(env.types.get(subj.name) ?? []), t]);
    } else if (subj.kind === "expr") {
      env.exprTypes.push([subj, t]);
    }
    env.typeCache = undefined; // a new type declaration invalidates the getTypes memo
  }
}

export function buildEnv(atoms: Atom[], gt: GroundingTable): MinEnv {
  const env = emptyEnv(gt);
  for (const x of atoms) addAtomToEnv(env, x);
  return env;
}

/** Register only the type declarations (`(: subj type)`) from imported atoms into the env, so an
 *  imported module's signatures drive type-directed evaluation. Rules are left to the space. */
function registerImportedTypes(env: MinEnv, atoms: readonly Atom[]): void {
  for (const x of atoms) {
    if (x.kind !== "expr" || opOf(x) !== ":" || x.items.length !== 3) continue;
    const subj = x.items[1]!;
    const t = x.items[2]!;
    if (subj.kind === "sym") {
      // An imported `(: op ...)` declaration may ADD a signature for an op that has none, but must not
      // OVERRIDE one already registered (by the prelude/stdlib or an earlier import). This keeps a grounded
      // op's built-in signature fixed: PeTTa's lib_he redeclares `unify` as `(-> Expression Expression
      // Expression Expression %Undefined%)`; letting that replace the built-in `(-> Atom Atom Atom Atom ...)`
      // makes the prelude's own `is-function` -> `unify` calls fail arg type-checking on their symbol/metatype
      // arguments (e.g. `(unify Symbol Expression then False)` -> BadArgType). The module's `(= (unify ...) ...)`
      // rules still load into the space as usual. (First-registration-wins also leaves the concurrency
      // module free to set `transaction`'s `(-> Atom ...)` sig, which its lazy-argument evaluation relies on.)
      if (opOf(t) === "->" && t.kind === "expr" && !env.sigs.has(subj.name))
        env.sigs.set(subj.name, t.items.slice(1));
      const cur = env.types.get(subj.name) ?? [];
      if (!cur.some((e) => atomEq(e, t))) env.types.set(subj.name, [...cur, t]);
    } else if (subj.kind === "expr") {
      if (!env.exprTypes.some(([s, tt]) => atomEq(s, subj) && atomEq(tt, t)))
        env.exprTypes.push([subj, t]);
    }
    env.typeCache = undefined; // a new type declaration invalidates the getTypes memo
  }
}

/** The `&self` atoms (prelude + stdlib + KB in `env.atoms`, plus any dynamically added `selfExtra`).
 *  Returns `env.atoms` directly when nothing has been added dynamically (the common case), avoiding an
 *  O(atoms) spread allocation on every type/candidate/match lookup. Callers must not mutate the result. */
function selfAtoms(env: MinEnv, w: World): readonly Atom[] {
  const runtime = runtimeAtoms(w);
  return runtime.length === 0 ? env.atoms : [...env.atoms, ...runtime];
}

function runtimeAtoms(w: World): Atom[] {
  const flat = w.flatSelfExtra?.toArray() ?? [];
  const log = logToArray(w.selfExtra);
  if (flat.length === 0) return log;
  if (log.length === 0) return flat;
  return [...flat, ...log];
}

function candidates(env: MinEnv, toEval: Atom): Array<[Atom, Atom]> {
  const k = headKey(toEval);
  // An expression-headed application (its head is itself an expression, e.g. `((|-> …) …)`) is the only
  // query an expression-headed catch-all rule can match, so it gets the full `varRules`. A symbol-, grounded-,
  // or empty-headed query can only be matched by a genuinely variable-headed catch-all, so it gets just
  // `varRulesVar`. Skipping the unmatchable expression-headed rules is sound and also stops them burning a
  // fresh-variable slot per probe (queryOp advances once per candidate). Byte-identical to the oracle and to
  // Hyperon, which has no such rules; the freshening only ever differed by invisible slots.
  if (k === undefined && toEval.kind === "expr" && toEval.items.length > 0)
    return [...env.varRules]; // keyed is empty here (no head key)
  const keyed = k !== undefined ? (env.ruleIndex.get(k) ?? []) : [];
  return env.varRulesVar.length === 0 ? keyed : [...keyed, ...env.varRulesVar];
}

// ---------- world + state ----------
type NamedSpace = AtomLog;

function namedSpaceAtoms(space: NamedSpace | undefined): Atom[] {
  return logToArray(space ?? emptyLog);
}

function namedSpaceCandidateGetter(
  w: World,
  space: NamedSpace | undefined,
): (pInst: Atom) => CandidateSource {
  let scan: Atom[] | undefined;
  return (pInst: Atom): CandidateSource => {
    const log = space ?? emptyLog;
    if (pInst.ground && logNonGround(log) === 0 && w.store.size === 0) {
      return exactCandidateSource(pInst, idxCount(logGroundIdx(log), pInst), logSize(log));
    }
    scan ??= namedSpaceAtoms(space).map((x) => resolveStates(w, x));
    return scan;
  };
}

export interface World {
  spaces: Map<string, NamedSpace>;
  store: Map<number, Atom>;
  tokens: Map<string, Atom>;
  // `&self` runtime additions as a persistent O(1)-append log (was a wholesale-copied `Atom[]`).
  selfExtra: AtomLog;
  // Experimental compact runtime additions for `&self`. Present only when `experimental.flatAtomspace` is on
  // and all appended atoms have a compact encoding.
  flatSelfExtra: FlatAtomSpace | undefined;
  // Runtime `(= lhs rhs)` rules indexed by lhs head key (var-headed in `selfVarRules`), so function
  // reduction looks them up directly instead of scanning the whole `selfExtra` log every reduction,
  // the difference between O(1) and O(n) when a program has added many ground facts.
  selfRules: Map<string, Array<[Atom, Atom]>>;
  selfVarRules: ReadonlyArray<[Atom, Atom]>;
  // Interpreter stack-depth bound, set in-language by `(pragma! max-stack-depth N)` (Hyperon's pragma).
  // 0 means unlimited (the Hyperon default). When positive, a branch whose stack reaches this depth
  // degrades to a StackOverflow error atom instead of recursing further. The pragma is a depth bound only; the
  // host's step budget (the `fuel` argument) is the resource ceiling and is never changed by a pragma, so a
  // program cannot raise its own limits past what the embedder allows.
  maxStackDepth: number;
}
export interface St {
  counter: number;
  world: World;
}
export const initSt = (): St => ({
  counter: 0,
  world: {
    spaces: new Map(),
    store: new Map(),
    tokens: new Map(),
    selfExtra: emptyLog,
    flatSelfExtra: undefined,
    selfRules: new Map(),
    selfVarRules: [],
    maxStackDepth: 0,
  },
});
function cloneWorld(w: World): World {
  return {
    spaces: new Map(w.spaces),
    store: new Map(w.store),
    tokens: new Map(w.tokens),
    selfExtra: w.selfExtra,
    flatSelfExtra: w.flatSelfExtra,
    selfRules: new Map(w.selfRules),
    selfVarRules: w.selfVarRules,
    maxStackDepth: w.maxStackDepth,
  };
}

// ---------- concurrent world merge (for `par`) ----------
// Each concurrent branch evaluates in isolation on the SAME immutable starting world, so they cannot
// see each other's mutations mid-flight. Their effects are merged afterwards as multiset deltas against
// the base: atoms a branch added are added, atoms it removed are removed, state/token writes that
// differ from the base are applied. Add-only effects (the common case) commute and the merge is
// order-independent; a genuine conflict (two branches mutating the same cell) resolves by branch order.
// That is why `with-mutex` exists: to serialise such a section.
function multisetDelta(
  base: readonly Atom[],
  branch: readonly Atom[],
): { added: Atom[]; removed: Atom[] } {
  const remaining = base.slice();
  const added: Atom[] = [];
  for (const a of branch) {
    const i = remaining.findIndex((x) => atomEq(x, a));
    if (i >= 0) remaining.splice(i, 1);
    else added.push(a);
  }
  return { added, removed: remaining };
}

function applyAtomDelta(into: Atom[], added: readonly Atom[], removed: readonly Atom[]): Atom[] {
  const out = into.slice();
  for (const r of removed) {
    const i = out.findIndex((x) => atomEq(x, r));
    if (i >= 0) out.splice(i, 1);
  }
  out.push(...added);
  return out;
}

function mergeWorlds(base: World, branches: readonly World[]): World {
  // The concurrent-branch merge works on materialized arrays (par is off the hot path); the result is
  // rebuilt into a log. The atom order is preserved so merged `&self` content matches the array version.
  const baseSelf = runtimeAtoms(base);
  let selfExtra = baseSelf.slice();
  const spaces = new Map(base.spaces);
  const store = new Map(base.store);
  const tokens = new Map(base.tokens);
  for (const w of branches) {
    const d = multisetDelta(baseSelf, runtimeAtoms(w));
    selfExtra = applyAtomDelta(selfExtra, d.added, d.removed);
    for (const [k, v] of w.spaces) {
      const baseV = namedSpaceAtoms(base.spaces.get(k));
      const sd = multisetDelta(baseV, namedSpaceAtoms(v));
      spaces.set(
        k,
        logFromArray(applyAtomDelta(namedSpaceAtoms(spaces.get(k)), sd.added, sd.removed)),
      );
    }
    for (const [k, v] of w.store) if (!Object.is(base.store.get(k), v)) store.set(k, v);
    for (const [k, v] of w.tokens) if (!Object.is(base.tokens.get(k), v)) tokens.set(k, v);
  }
  // Rebuild the rule index from the merged `&self` atoms (par is rare; correctness over speed here).
  const flat = base.flatSelfExtra === undefined ? undefined : FlatAtomSpace.fromAtoms(selfExtra);
  const merged: World = {
    spaces,
    store,
    tokens,
    selfExtra: flat === undefined ? logFromArray(selfExtra) : emptyLog,
    flatSelfExtra: flat,
    selfRules: new Map(),
    selfVarRules: [],
    maxStackDepth: base.maxStackDepth,
  };
  indexSelfRules(merged, selfExtra);
  return merged;
}

/** A stable string key for a `with-mutex` lock name (a structural serialisation, no `format` dep). */
function mutexKey(a: Atom): string {
  switch (a.kind) {
    case "sym":
      return "s:" + a.name;
    case "var":
      return "v:" + a.name;
    case "gnd": {
      const g = a.value;
      return g.g === "str"
        ? "S:" + g.s
        : g.g === "int" || g.g === "float"
          ? "n:" + g.n
          : "g:" + g.g;
    }
    case "expr":
      return "e:[" + a.items.map(mutexKey).join(",") + "]";
  }
}

function resolveTok(w: World, a: Atom): Atom {
  if (a.kind === "sym") return w.tokens.get(a.name) ?? a;
  return a;
}
const stateHandle = (id: number): Atom => expr([sym("State"), gint(id)]);
function stateId(w: World, a: Atom): number | undefined {
  const r = resolveTok(w, a);
  if (opOf(r) === "State" && r.kind === "expr" && r.items.length === 2) {
    const g = r.items[1]!;
    if (g.kind === "gnd" && g.value.g === "int") return Number(g.value.n);
  }
  return undefined;
}
function spaceName(w: World, a: Atom): string | undefined {
  const r = resolveTok(w, a);
  return r.kind === "sym" ? r.name : undefined;
}
function resolveStates(w: World, a: Atom): Atom {
  if (w.store.size === 0) return a; // no state cells: identity, skip the tree clone (hot path)
  if (a.kind === "expr") {
    if (opOf(a) === "State" && a.items.length === 2) {
      const g = a.items[1]!;
      if (g.kind === "gnd" && g.value.g === "int") return w.store.get(Number(g.value.n)) ?? a;
    }
    return expr(a.items.map((x) => resolveStates(w, x)));
  }
  return a;
}
function subTokens(w: World, a: Atom, intern?: InternTable): Atom {
  if (w.tokens.size === 0) return a; // no bind! tokens: identity, skip the tree clone (hot path)
  if (a.kind === "sym") return w.tokens.get(a.name) ?? a;
  if (a.kind === "expr") {
    const out = expr(a.items.map((x) => subTokens(w, x, intern)));
    return intern === undefined ? out : internBuiltExpr(intern, out);
  }
  return a;
}
function wrapStates(w: World, a: Atom): Atom {
  if (w.store.size === 0) return a; // no state cells: identity, skip the tree clone (hot path)
  if (a.kind === "expr") {
    if (opOf(a) === "State" && a.items.length === 2) {
      const g = a.items[1]!;
      if (g.kind === "gnd" && g.value.g === "int") {
        const v = w.store.get(Number(g.value.n));
        return v !== undefined ? expr([sym("StateValue"), v]) : a;
      }
    }
    return expr(a.items.map((x) => wrapStates(w, x)));
  }
  return a;
}
const typePrep = (env: MinEnv, w: World, a: Atom): Atom =>
  wrapStates(w, subTokens(w, a, env.intern));

function candidatesW(env: MinEnv, w: World, toEval: Atom): Array<[Atom, Atom]> {
  // Runtime rules come from the index (head-matched bucket plus var-headed), not a scan of the log.
  const k2 = headKey(toEval);
  const headRules = k2 !== undefined ? (w.selfRules.get(k2) ?? []) : [];
  return [...candidates(env, toEval), ...headRules, ...w.selfVarRules];
}

// Variable list of a rule (lhs vars first, then rhs-only vars), cached on the rule pair. Rules are static,
// so their variable set never changes; queryOp freshens the same rules on every reduction, so caching skips
// re-walking the rule each time (atomVars showed up hot in profiling otherwise). The RHS is part of the key
// because hash-consing can make distinct rules share an identical LHS.
const ruleVarsCache = new WeakMap<Atom, WeakMap<Atom, string[]>>();
function ruleVars(lhs: Atom, rhs: Atom): string[] {
  let rhsCache = ruleVarsCache.get(lhs);
  if (rhsCache === undefined) {
    rhsCache = new WeakMap();
    ruleVarsCache.set(lhs, rhsCache);
  }
  let vs = rhsCache.get(rhs);
  if (vs === undefined) {
    vs = atomVars(lhs);
    const seen = new Set(vs);
    for (const v of atomVars(rhs))
      if (!seen.has(v)) {
        seen.add(v);
        vs.push(v);
      }
    rhsCache.set(rhs, vs);
  }
  return vs;
}

// The fresh-rename substitution for one rule application: each rule variable to `name#counter`.
function freshenSub(counter: number, lhs: Atom, rhs: Atom): Subst {
  // A ground lhs and rhs have no variables, so the substitution is empty. Short-circuit before `ruleVars`
  // walks the whole term: a `match` over N ground facts freshens each candidate `freshenRule(fact, fact)`,
  // and the facts are distinct (no ruleVarsCache hit), so this turns the count's per-candidate cost from
  // O(term size) to O(1) — the difference between O(N·depth) and O(N) on a deep-term space like matespace.
  if (lhs.ground && rhs.ground) return [];
  const vs = ruleVars(lhs, rhs);
  return vs.length === 0 ? [] : vs.map((v) => [v, variable(v + "#" + String(counter))]);
}

export function freshenRule(counter: number, lhs: Atom, rhs: Atom): [Atom, Atom] {
  const sub = freshenSub(counter, lhs, rhs);
  if (sub.length === 0) return [lhs, rhs];
  return [applySubst(sub, lhs), applySubst(sub, rhs)];
}

// A sound, allocation-free pre-check: can a rule LHS possibly match `toEval` regardless of how its
// variables rename? Compares arity and the head shape (one level). Conservative; only returns false when a
// match is structurally impossible (different arity, or two distinct ground heads). Lets queryOp skip the
// freshen+match of a candidate that cannot fire. `candidates` appends every variable-headed rule (the `|->`
// lambda applicators) to every query, and they can never match a symbol-headed call, so this is where most
// of the saving is.
function canMatchShallow(lhs: Atom, toEval: Atom): boolean {
  if (lhs.kind === "var" || toEval.kind === "var") return true;
  if (lhs.kind === "sym") return toEval.kind === "sym" && toEval.name === lhs.name;
  if (lhs.kind === "gnd") return atomEq(lhs, toEval);
  // lhs is an expression: same length, and a head that can itself match.
  return (
    toEval.kind === "expr" &&
    toEval.items.length === lhs.items.length &&
    canMatchShallow(lhs.items[0]!, toEval.items[0]!)
  );
}

// ---------- query + eval ops ----------
function queryOp(env: MinEnv, st: St, prev: Stack, toEval: Atom, b: Bindings): [Item[], St] {
  if (isVariableHeaded(toEval)) return [[finItem(prev, notReducibleA, b)], st];
  const cands = candidatesW(env, st.world, toEval);
  const out: Item[] = [];
  let counter = st.counter;
  for (const [lhs0, rhs0] of cands) {
    // Skip a candidate that cannot possibly match before paying for its scope. The counter is still advanced
    // (one per candidate, as before) so the fresh-variable numbering, including any unbound fresh var that
    // survives into a result, is byte-identical to not skipping.
    if (!canMatchShallow(lhs0, toEval)) {
      counter += 1;
      continue;
    }
    // Scope this rule's variables with a per-application suffix instead of cloning the rule with freshened
    // variables: matchAtomsScoped renames the LHS variables at bind time, and instantiate renames the RHS's
    // on the (already-walked) result, so each application avoids the two applySubst clones that freshening
    // cost. The scoped path is byte-identical, since the fresh names (`name<suffix>`) are the same. The RHS
    // is instantiated only when a match actually fires.
    const suffix = "#" + counter;
    counter += 1;
    for (const mb of matchAtomsScoped(lhs0, toEval, suffix)) {
      for (const m of merge(b, mb)) {
        if (!hasLoop(m)) out.push(evalResult(prev, inst(env, m, rhs0, suffix), m));
      }
    }
  }
  const st2: St = { counter, world: st.world };
  if (out.length === 0) return [[finItem(prev, notReducibleA, b)], st2];
  return [out, st2];
}

// Does any `=` rule in scope reduce `a`? Used to let a program's own definition win over a PeTTa-compat
// grounded op of the same name (those ops are a fallback, not an override).
function hasRuleFor(env: MinEnv, w: World, counter: number, a: Atom): boolean {
  for (const [lhs, rhs] of candidatesW(env, w, a)) {
    const [fl] = freshenRule(counter, lhs, rhs);
    if (matchAtoms(fl, a).length > 0) return true;
  }
  return false;
}

function* evalOpG(env: MinEnv, st: St, prev: Stack, x: Atom, b: Bindings): Gen<[Item[], St]> {
  const x2 = inst(env, b, x);
  const op = opOf(x2);
  if (op === "collapse" && x2.kind === "expr" && x2.items.length === 2) {
    const match = matchInsideOnce(x2.items[1]!);
    if (match !== undefined) {
      const namedMatch = tryFastNamedOnceMatch(env, st, match, b);
      if (namedMatch !== undefined) {
        const items = namedMatch.value === undefined ? [] : [namedMatch.value];
        return [[evalResult(prev, expr(items), b)], namedMatch.state];
      }
    }
  }
  if (op === "if" && x2.kind === "expr" && x2.items.length === 4) {
    const added = tryFastNamedAddIfAbsent(env, st, x2, b);
    if (added !== undefined) {
      const out = added.added ? [finItem(prev, emptyExpr, b)] : [];
      return [out, added.state];
    }
  }
  // A PeTTa-compat grounded op (length, sort, append, …) defers to a user `=` rule of the same head, so the
  // stdlib never shadows a program's own definition; every other grounded op applies eagerly as before.
  const useGrounded =
    op !== undefined &&
    x2.kind === "expr" &&
    !(pettaOpNames.has(op) && hasRuleFor(env, st.world, st.counter, x2));
  if (useGrounded) {
    const args = x2.items
      .slice(1)
      .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
    const r = yield* callGroundedG(env, op!, args);
    if (r.tag === "ok") return [r.results.map((res) => evalResult(prev, res, b)), st];
    if (r.tag === "runtimeError") return [[finItem(prev, errAtom(x2, r.msg), b)], st];
    if (r.tag === "incorrectArgument") return [[finItem(prev, notReducibleA, b)], st];
    // noReduce
  }
  // Executable grounded-atom head: `(<gnd-with-exec> arg...)`. This is what makes a grounded operation
  // produced at runtime (e.g. `(bind! abs (op-atom ...))` then `(abs -5)`, or the js-* interop) callable
  // in-language, the TS-native analogue of Python's py-atom/OperationAtom. The interpreter dispatches
  // built-in ops by symbol; this dispatches by the head atom's own `exec`.
  if (x2.kind === "expr" && x2.items.length > 0) {
    const head = x2.items[0]!;
    if (head.kind === "gnd" && head.exec !== undefined) {
      const args = x2.items
        .slice(1)
        .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
      try {
        const results = head.exec(args);
        return [results.map((res) => evalResult(prev, res, b)), st];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return [[finItem(prev, errAtom(x2, msg), b)], st];
      }
    }
  }
  if (isEmbeddedOp(x2)) return [[{ stack: atomToStack(x2, prev), bnd: b }], st];
  return queryOp(env, st, prev, x2, b);
}

function unifyOp(
  env: MinEnv,
  prev: Stack,
  a: Atom,
  p: Atom,
  t: Atom,
  e: Atom,
  b: Bindings,
): Item[] {
  const ms: Item[] = [];
  for (const mb of matchAtoms(a, p))
    for (const m of merge(b, mb)) if (!hasLoop(m)) ms.push(finItem(prev, inst(env, m, t), m));
  return ms.length === 0 ? [finItem(prev, e, b)] : ms;
}

// ---------- final-item helpers ----------
const isFinal = (it: Item): boolean =>
  it.stack !== null && it.stack.tail === null && it.stack.head.fin;
function finalPair(env: MinEnv, it: Item): [Atom, Bindings] {
  const f = it.stack;
  return f === null ? [emptyA, []] : [inst(env, it.bnd, f.head.atom), it.bnd];
}
function exhaustedPair(env: MinEnv, it: Item): [Atom, Bindings] {
  const f = it.stack;
  return f === null
    ? [emptyA, it.bnd]
    : [makeExpr(env, [sym("Error"), inst(env, it.bnd, f.head.atom), sym("StackOverflow")]), it.bnd];
}

function resolveBoundVarFix(env: MinEnv, b: Bindings, n: number, x: string): Atom | undefined {
  let cur = lookupVal(b, x);
  if (cur === undefined || cur.ground) return cur;
  for (let i = 1; i < n; i++) {
    const next = inst(env, b, cur);
    if (atomEq(next, cur)) return cur;
    cur = next;
  }
  return cur;
}
function restrictBnd(env: MinEnv, vars: readonly string[], b: Bindings): Bindings {
  if (vars.length === 0) return emptyBindings;
  const solved: BindingRel[] = [];
  for (const x of vars) {
    const v = resolveBoundVarFix(env, b, size(b) + 1, x);
    if (v !== undefined && !(v.kind === "var" && v.name === x)) solved.push(makeValRel(x, v));
  }
  // The eq filter only matters when `b` actually carries an alias; most bindings are pure `val`, so skip
  // both the scan and the Set allocation in that common case. When there are aliases, use a Set for O(1)
  // membership (was `vars.includes` twice per binding, O(|vars|*|b|), the dominant cost on a large binding).
  if (!hasEq(b)) return fromRelations(solved);
  const vset = new Set(vars);
  const eqs: BindingRel[] = [];
  for (const r of eqRelations(b)) if (vset.has(r.x) && vset.has(r.y)) eqs.push(r);
  return fromRelations(solved.length === 0 ? eqs : [...solved, ...eqs]);
}
// Narrow a reduction result's bindings to the query variables: merge the result's bindings `pb` onto the
// base `baseB`, then keep only `vars`. If the merge is incompatible (no solution), fall back to `pb` alone.
// This is the standard post-reduction binding step, used after every metta-call and rule application.
function mergeRestrict(
  env: MinEnv,
  vars: readonly string[],
  baseB: Bindings,
  pb: Bindings,
): Bindings {
  if (vars.length === 0) return emptyBindings;
  const merged = merge(baseB, pb);
  return restrictBnd(env, vars, merged.length > 0 ? merged[0]! : pb);
}

function queryVarsOf(args: readonly Atom[]): readonly string[] {
  const out: string[] = [];
  for (const a of args) if (!a.ground) out.push(...atomVars(a));
  return out;
}
function scopeVars(env: MinEnv, b: Bindings, prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(inst(env, b, p.head.atom), out, seen);
  return out;
}
function chainLiveVars(cont: Atom, prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(p.head.atom, out, seen);
  collectVars(cont, out, seen);
  return out;
}
function superposeItem(prev: Stack, b: Bindings, pair: Atom): Item {
  if (pair.kind === "expr" && pair.items.length > 0) return finItem(prev, pair.items[0]!, b);
  return finItem(prev, pair, b);
}

function argMask(ts: Atom[] | undefined, arity: number): boolean[] {
  const mask = new Array<boolean>(arity);
  if (ts === undefined) {
    mask.fill(true);
    return mask;
  }
  // A parameter typed Atom/Variable/Expression accepts its argument unreduced (gradual top plus
  // meta-types), so that position is not evaluated; every other position is. Checked by name to avoid
  // allocating throwaway symbols for `atomEq` on this per-reduction hot path.
  for (let i = 0; i < arity; i++) {
    const t = ts[i];
    mask[i] =
      t === undefined ||
      !(
        t.kind === "sym" &&
        (t.name === "Atom" || t.name === "Variable" || t.name === "Expression")
      );
  }
  return mask;
}
function returnsAtom(env: MinEnv, a: Atom): boolean {
  const op = headKey(a);
  if (op === undefined) return false;
  const ts = env.sigs.get(op);
  const last = ts && ts.length > 0 ? ts[ts.length - 1] : undefined;
  return last !== undefined && atomEq(last, sym("Atom"));
}

/** The arity of a named function: from its `(-> …)` signature if declared, else from the head of its
 *  defining `=` rules (static index plus any added at runtime). `undefined` when the name is not a known
 *  function (so a bare data constructor is never mistaken for an under-applied call). Used only by the
 *  opt-in `curry` path. */
function functionArity(env: MinEnv, w: World, name: string): number | undefined {
  const sig = env.sigs.get(name);
  if (sig !== undefined && sig.length >= 1) return sig.length - 1;
  for (const [lhs] of [...(env.ruleIndex.get(name) ?? []), ...(w.selfRules.get(name) ?? [])])
    if (lhs.kind === "expr" && lhs.items.length >= 2) return lhs.items.length - 1;
  return undefined;
}

// ---------- types ----------
const headOr = (xs: readonly Atom[], d: Atom): Atom => (xs.length > 0 ? xs[0]! : d);
const UNDEF = sym("%Undefined%");
// Shared constant type-result arrays for the leaf cases: getTypes is on the hot path and these
// results are read-only (callers index/headOr them, never mutate), so a fresh array per call is
// pure allocation. (MORK-spirit: stop allocating on the hot path.)
const NUMBER_T: Atom[] = [sym("Number")];
const STRING_T: Atom[] = [sym("String")];
const BOOL_T: Atom[] = [sym("Bool")];
const GROUNDED_T: Atom[] = [sym("Grounded")];
const UNDEF_T: Atom[] = [UNDEF];

export function getTypes(env: MinEnv, a: Atom): Atom[] {
  // Memoise ground atoms: the type is stable for a fixed env, and the recursion below reuses the cached
  // type of every shared subterm. Non-ground atoms are not cached (they churn and rarely repeat by identity).
  if (a.ground) {
    const cache = (env.typeCache ??= new WeakMap());
    const hit = cache.get(a);
    if (hit !== undefined) return hit;
    const r = getTypesUncached(env, a);
    cache.set(a, r);
    return r;
  }
  return getTypesUncached(env, a);
}
function getTypesUncached(env: MinEnv, a: Atom): Atom[] {
  if (a.kind === "gnd") {
    const g = a.value;
    if (g.g === "int" || g.g === "float") return NUMBER_T;
    if (g.g === "str") return STRING_T;
    if (g.g === "bool") return BOOL_T;
    return GROUNDED_T;
  }
  if (a.kind === "var") return UNDEF_T;
  if (a.kind === "sym") {
    const ts = env.types.get(a.name);
    return ts && ts.length > 0 ? ts : UNDEF_T;
  }
  // expression
  if (a.items.length === 0) return UNDEF_T;
  if (opOf(a) === "StateValue" && a.items.length === 2)
    return [expr([sym("StateMonad"), headOr(getTypes(env, a.items[1]!), UNDEF)])];
  const direct = env.exprTypes.filter((p) => atomEq(p[0], a));
  if (direct.length > 0) return direct.map((p) => p[1]);
  const f = a.items[0]!;
  const args = a.items.slice(1);
  const argTs = args.map((x) => headOr(getTypes(env, x), UNDEF));
  const fTypes = getTypes(env, f);
  const out: Atom[] = [];
  for (const t of fTypes) {
    if (opOf(t) === "->" && t.kind === "expr") {
      const ts = t.items.slice(1);
      const ret = ts.length > 0 ? ts[ts.length - 1]! : UNDEF;
      const params = ts.slice(0, -1);
      let tb: Bindings = [];
      for (let i = 0; i < params.length && i < argTs.length; i++) {
        const m = matchAtoms(inst(env, tb, params[i]!), argTs[i]!);
        if (m.length > 0) {
          const merged = merge(tb, m[0]!);
          if (merged.length > 0) tb = merged[0]!;
        }
      }
      out.push(inst(env, tb, ret));
    }
  }
  return out.length > 0 ? out : UNDEF_T;
}

/** The type(s) reported by the user-facing `get-type` op. Same as `getTypes`, but with hyperon's tuple
 *  case: when an expression's head is not a function, the whole expression is a tuple and its type is the
 *  tuple of its elements' types, e.g. `(a b)` with `a:A`, `b:B` is `(A B)`. When an element has SEVERAL
 *  types the result is the cartesian product, one tuple type per combination (hyperon types.rs:
 *  `get_atom_types((a b))` is `[(A B), (B B)]` when `a:{A,B}`). This is kept out of `getTypes` itself
 *  because that drives type-directed argument evaluation, which must stay conservative (%Undefined%) for a
 *  bare tuple rather than invent a tuple type. */
function getTypesForQuery(env: MinEnv, a: Atom): Atom[] {
  const base = getTypes(env, a);
  if (a.kind !== "expr" || a.items.length === 0) return base;
  if (base.length > 0 && !base.every((t) => atomEq(t, UNDEF))) return base;
  const f = a.items[0]!;
  if (getTypes(env, f).some((t) => opOf(t) === "->")) return base;
  // Cartesian product of each element's type list, building one tuple type per combination.
  let combos: Atom[][] = [[]];
  for (const x of a.items) {
    const ts = getTypesForQuery(env, x);
    const opts = ts.length > 0 ? ts : [UNDEF];
    const next: Atom[][] = [];
    for (const combo of combos) for (const t of opts) next.push([...combo, t]);
    combos = next;
  }
  return combos.map((c) => makeExpr(env, c));
}

function matchReduced(tb: Bindings, expected: Atom, actual: Atom): Bindings | undefined {
  if (atomEq(expected, UNDEF) || atomEq(actual, UNDEF)) return tb;
  if (expected.kind === "expr" && actual.kind === "expr")
    return matchReducedList(tb, expected.items, actual.items);
  for (const mb of matchAtoms(expected, actual)) {
    const merged = merge(tb, mb);
    if (merged.length > 0) return merged[0];
  }
  return undefined;
}
function matchReducedList(
  tb: Bindings,
  es: readonly Atom[],
  acts: readonly Atom[],
): Bindings | undefined {
  if (es.length !== acts.length) return undefined;
  let cur = tb;
  for (let i = 0; i < es.length; i++) {
    const r = matchReduced(cur, es[i]!, acts[i]!);
    if (r === undefined) return undefined;
    cur = r;
  }
  return cur;
}
function matchType(tb: Bindings, expected: Atom, actual: Atom): Bindings | undefined {
  if (
    atomEq(expected, UNDEF) ||
    atomEq(actual, UNDEF) ||
    atomEq(expected, sym("Atom")) ||
    atomEq(actual, sym("Atom"))
  )
    return tb;
  return matchReduced(tb, expected, actual);
}
function typeCheckArgs(
  env: MinEnv,
  w: World,
  argTypes: readonly Atom[],
  i: number,
  tb: Bindings,
  argsLeft: readonly Atom[],
): [number, Atom, Atom] | undefined {
  if (argsLeft.length === 0) return undefined;
  const ti0 = argTypes[i];
  if (ti0 === undefined) return undefined;
  const ti = inst(env, tb, ti0);
  // A top parameter type (`Atom`/`%Undefined%`) accepts any argument, so the argument is well-typed
  // without inferring its type. Checking this by name first skips both `typePrep` and `getTypes`, each an
  // O(term-size) walk, on the very common case (e.g. `add-atom`'s `Atom` parameter). Without it, adding
  // deeply-nested terms re-walks each one every time and turns add-heavy programs quadratic.
  if (ti.kind === "sym" && (ti.name === "Atom" || ti.name === "%Undefined%"))
    return typeCheckArgs(env, w, argTypes, i + 1, tb, argsLeft.slice(1));
  const ai = argsLeft[0]!;
  const prepped = typePrep(env, w, ai);
  // Hyperon `check_arg_types` (types.rs): an argument satisfies a parameter whose type names the
  // argument's meta-type (`meta.contains(expected)`), checked before any declared/inferred type. So a
  // computed expression like `(+ 5 5)` (inferred value-type Number, meta-type Expression) satisfies an
  // `Expression` parameter. Without this, ops with meta-typed parameters (lib_he's `evalc`/`noreduce-eq`,
  // `map-atom`) wrongly raise BadArgType on unevaluated expression arguments.
  if (ti.kind === "sym" && ti.name === metaType(prepped))
    return typeCheckArgs(env, w, argTypes, i + 1, tb, argsLeft.slice(1));
  const actuals = getTypes(env, prepped);
  for (const act of actuals) {
    const tb2 = matchType(tb, ti, act);
    if (tb2 !== undefined) return typeCheckArgs(env, w, argTypes, i + 1, tb2, argsLeft.slice(1));
  }
  return [i + 1, ti, headOr(actuals, UNDEF)];
}
function typeMismatch(
  env: MinEnv,
  w: World,
  op: string,
  args: readonly Atom[],
  ts: Atom[] | undefined = env.sigs.get(op),
): [number, Atom, Atom] | undefined {
  if (ts === undefined) return undefined;
  return typeCheckArgs(env, w, ts.slice(0, -1), 0, [], args);
}

// ---------- conjunctive match ----------
/** Candidate `&self` atoms that could match a (instantiated) pattern, using the functor index. A
 *  functor-headed pattern only scans atoms with that head key plus the variable-headed atoms (which can
 *  unify with any functor); a variable-headed pattern must scan everything. State atoms are resolved
 *  only when the world actually holds state. This is what turns a linear `match` into an indexed one. */
function* matchCandidates(env: MinEnv, w: World, pInst: Atom): CandidateSource {
  const k = headKey(pInst);
  if (k === undefined) {
    // variable-headed pattern: must consider everything.
    for (const atom of resolveAll(w, env.atoms.slice())) yield atom;
    yield* runtimeCandidates(w, undefined);
    return;
  }
  // Pick the most selective bound (ground-leaf) argument position: candidates are the atoms with that
  // ground value at that position, plus the atoms with a non-ground argument there (which can unify).
  let bestKey: string | undefined;
  let bestPosKey: string | undefined;
  let bestSize = Infinity;
  if (pInst.kind === "expr")
    for (let i = 1; i < pInst.items.length; i++) {
      const ak = argKey(pInst.items[i]!);
      if (ak === undefined) continue;
      const ik = k + KEY_SEP + i + KEY_SEP + ak;
      const posKey = k + KEY_SEP + i;
      const size =
        (env.argIndex.get(ik)?.length ?? 0) + (env.nonGroundAtPos.get(posKey)?.length ?? 0);
      if (size < bestSize) {
        bestSize = size;
        bestKey = ik;
        bestPosKey = posKey;
      }
    }
  let cands: Atom[];
  if (bestKey !== undefined) {
    cands = [...(env.argIndex.get(bestKey) ?? []), ...(env.nonGroundAtPos.get(bestPosKey!) ?? [])];
  } else {
    // no bound argument position: the whole functor bucket.
    cands = (env.factIndex.get(k) ?? []).slice();
  }
  cands.push(...env.varHeadedFacts);
  // Runtime facts. Fast path: an exact GROUND pattern over a runtime log that holds only ground atoms
  // (and no state handles to resolve) is an exact-membership query; the index answers it in O(1) and the
  // pattern itself is the only thing that can match (a ground pattern unifies only an identical ground
  // atom, with an empty binding), so push that many copies of the pattern instead of scanning the log.
  // This is what makes peano's O(K^3) dedup-by-scan O(K^2). Otherwise fall back to the full scan.
  if (
    pInst.ground &&
    logNonGround(w.selfExtra) === 0 &&
    (w.flatSelfExtra?.nonGroundCount ?? 0) === 0 &&
    w.store.size === 0
  ) {
    // An empty log holds nothing, so skip idxCount there: it would hash the whole (deep) pattern
    // just to probe an empty index, and under the flat store the log stays empty for the run.
    const c = w.selfExtra === null ? 0 : idxCount(logGroundIdx(w.selfExtra), pInst);
    for (const atom of cands) yield atom;
    const flatCount = w.flatSelfExtra?.exactCount(pInst) ?? 0;
    for (let i = 0; i < c + flatCount; i++) yield pInst;
    return; // pInst carries no state handle, so resolveAll would be a no-op
  }
  for (const atom of resolveAll(w, cands)) yield atom;
  yield* runtimeCandidates(w, k);
}

/** Apply state resolution to candidate atoms only when the world actually holds state. */
function resolveAll(w: World, atoms: Atom[]): readonly Atom[] {
  return w.store.size === 0 ? atoms : atoms.map((x) => resolveStates(w, x));
}

function* runtimeCandidates(w: World, k: string | undefined): Iterable<Atom> {
  if (w.flatSelfExtra !== undefined) {
    for (const a of w.flatSelfExtra.candidatesFor(k)) yield resolveStates(w, a);
  }
  for (const a of logToArray(w.selfExtra)) {
    if (k === undefined) yield resolveStates(w, a);
    else {
      const akk = headKey(a);
      if (akk === undefined || akk === k) yield resolveStates(w, a);
    }
  }
}

function matchConj(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  sols: Bindings[],
): [Bindings[], St] {
  let cur = sols;
  let counter = st.counter;
  for (const p of patterns) {
    const next: Bindings[] = [];
    for (const b of cur) {
      const pInst = inst(env, b, p);
      const source = getCandidates(pInst);
      for (const atom of source) {
        const atom2 = freshenRule(counter, atom, atom)[0];
        counter += 1;
        for (const mb of matchAtoms(pInst, atom2))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
      counter += candidateCounterPadding(source);
    }
    cur = next;
  }
  return [cur, { counter, world: st.world }];
}

// Conjunctive `match` via a worst-case-optimal join. A conjunct whose every candidate match binds all
// its variables to ground terms (e.g. the `(N != M)` constraint facts) becomes a relation joined by
// `wcoJoin`, which is AGM-bounded and avoids the nested loop's intermediate cross-product blowup (a
// triangle of `!=` constraints is N^1.5, not N^2, the difference between finishing and not on the
// permutations benchmark). Conjuncts whose matches bind variables to variables (templates like
// `(E $a ... $state)`) are threaded by the nested loop over each WCO solution, where the join variables
// are already ground. Degrades to the plain nested loop when no conjunct is ground-relational, so it is
// only used for `(, ...)` with two or more goals (single-pattern match keeps its scan order).
// Split the conjunction goals into ground-relational factors (joined AGM-optimally by wcoJoin) and the
// non-ground tail, advancing the freshening counter. Shared by matchConjJoin (which materializes the join)
// and matchConjCount (which folds it), so neither duplicates the wcoJoin setup.
function splitConjGoals(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
  perPositionAdmit: boolean,
): { groundRels: Array<Relation<Atom>>; otherPatterns: Atom[]; counter: number } {
  let counter = st.counter;
  const insts = patterns.map((p) => inst(env, b0, p));
  const pvarsList = insts.map((pInst) => atomVars(pInst));
  // Join variables: a query var shared by two or more goals (the leapfrog's intersection keys). Under the
  // unify-capable per-position admission, a schematic fact binding a join variable to a non-ground term is
  // the one case a column-wise leapfrog fabricates answers (the mork-uni-join witness), so it declines; a
  // non-ground binding at a non-join position is a free output column the join just enumerates, so it rides
  // the fast path. Without per-position routing (the result path, where answer order is observable), any
  // non-ground value declines, keeping the conservative split byte-identical.
  let joinVars: Set<string> | undefined;
  if (perPositionAdmit) {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const pvars of pvarsList)
      for (const v of new Set(pvars)) (seen.has(v) ? shared : seen).add(v);
    joinVars = shared;
  }
  const groundRels: Array<Relation<Atom>> = [];
  const otherPatterns: Atom[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i]!;
    const pvars = pvarsList[i]!;
    if (pvars.length === 0) {
      otherPatterns.push(p); // fully-ground existence check: cheap, leave to the nested loop
      continue;
    }
    const pInst = insts[i]!;
    const tuples: Array<Map<string, Atom>> = [];
    let relational = true;
    const source = getCandidates(pInst);
    for (const atom of source) {
      const fresh = freshenRule(counter, atom, atom)[0];
      counter += 1;
      for (const mb of matchAtoms(pInst, fresh)) {
        const t = new Map<string, Atom>();
        for (const v of pvars) {
          const val = lookupVal(mb, v) ?? variable(v);
          t.set(v, val);
          if (!val.ground && (joinVars === undefined || joinVars.has(v))) relational = false;
        }
        tuples.push(t);
      }
    }
    counter += candidateCounterPadding(source);
    if (relational) groundRels.push({ vars: pvars, tuples });
    else otherPatterns.push(p);
  }
  return { groundRels, otherPatterns, counter };
}

// The join phase for matchConjJoin: split the goals, then materialize the wcoJoin solutions as binding sets.
function conjJoinPartials(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { partials: Bindings[]; otherPatterns: Atom[]; counter: number } {
  const { groundRels, otherPatterns, counter } = splitConjGoals(
    env,
    getCandidates,
    patterns,
    st,
    b0,
    // Result path: admit schematic facts at non-join positions to the leapfrog only when the fast matcher is
    // on. The leapfrog reorders results and freshens differently, so an admitted schematic goal makes the
    // answer alpha-equivalent (not byte-identical) to the coupled path; the default (trail off) keeps the
    // conservative all-ground gate, so the byte-identical reference order holds and the oracle is unaffected.
    env.useTrail === true,
  );
  let partials: Bindings[];
  if (groundRels.length > 0) {
    partials = [];
    for (const sol of wcoJoin(groundRels, mutexKey)) {
      let bs: Bindings[] = [b0];
      for (const [v, val] of sol) {
        const nb: Bindings[] = [];
        for (const b of bs) nb.push(...addVarBinding(b, v, val));
        bs = nb;
      }
      for (const b of bs) if (!hasLoop(b)) partials.push(b);
    }
  } else {
    partials = [b0];
  }
  return { partials, otherPatterns, counter };
}

function matchConjJoin(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): [Bindings[], St] {
  const {
    partials,
    otherPatterns,
    counter: c0,
  } = conjJoinPartials(env, getCandidates, patterns, st, b0);
  let cur = partials;
  let counter = c0;
  for (const p of otherPatterns) {
    const next: Bindings[] = [];
    // The same candidate facts are matched against every WCO solution; a fact's freshened copies differ
    // only in their fresh variable names, which each match binds independently inside its own result. So
    // freshen each fact once and reuse it across solutions. Freshening (a full term copy for a
    // template-shaped fact) is the allocation-heavy part of the emit and was being redone per result. The
    // cache is per-conjunct, so distinct conjuncts that match the same fact still get distinct fresh vars.
    const freshCache = new Map<Atom, Atom>();
    for (const b of cur) {
      const pInst = inst(env, b, p);
      const source = getCandidates(pInst);
      const cache = syntheticCandidateSource(source) ? undefined : freshCache;
      for (const atom of source) {
        let fresh = cache?.get(atom);
        if (fresh === undefined) {
          fresh = freshenRule(counter, atom, atom)[0];
          counter += 1;
          cache?.set(atom, fresh);
        }
        for (const mb of matchAtoms(pInst, fresh))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
      counter += candidateCounterPadding(source);
    }
    cur = next;
  }
  return [cur, { counter, world: st.world }];
}

// Count a multi-goal conjunctive `match` without materializing its answers: run wcoJoin for the
// ground-relational goals (its partials are far fewer than the final answer set, ~40k vs ~360k for
// permutations), then count the remaining non-ground goals per partial on the zero-allocation trail. The
// count is name-independent, so it is byte-identical to counting matchConjJoin's solutions. Returns
// undefined to fall back when the trail tail declines (a custom grounded matcher, or the node budget).
function matchConjCount(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { count: number; counter: number } | undefined {
  const {
    groundRels,
    otherPatterns,
    counter: c0,
    // Match the result path's admission gate (conjJoinPartials) so the fold and the materializing count split
    // goals identically and advance the gensym counter in lockstep: the conservative all-ground split by
    // default (byte-identical, the reference the corpus pins), the per-position unify-capable admission only
    // under experimental.trail (where the result path also admits, so both stay consistent).
  } = splitConjGoals(env, getCandidates, patterns, st, b0, env.useTrail === true);
  // No ground-relational goal: there is no join to fold, so count the whole (non-ground) conjunction on a
  // single trail seeded from b0.
  if (groundRels.length === 0) {
    for (const p of patterns) if (atomHasCustomGrounded(p)) return undefined;
    return countTrailDFS(seededTrail(b0), getCandidates, patterns, c0);
  }
  for (const p of otherPatterns) if (atomHasCustomGrounded(p)) return undefined;
  // One trail, synced to the wcoJoin descent: each join variable binds in place on the way down and undoes
  // on the way back up, so at every leaf the join's assignment is already on the trail and the non-ground
  // tail counts with zero per-leaf allocation (MORK's trie_join_count: aggregate without materializing).
  const tr = seededTrail(b0);
  // One freshen cache per tail goal, each shared across all join leaves: a tail candidate freshens once per
  // goal, but two goals matching the same stored fact get distinct fresh variables (see countTrailDFS).
  const tailFreshCaches = otherPatterns.map(() => new Map<Atom, Atom>());
  let counter = c0;
  let count = 0;
  let bailed = false;
  const marks: number[] = [];
  wcoJoinFold(groundRels, mutexKey, {
    onDescend: (v, val) => {
      marks.push(tr.mark());
      tr.bind(v, val);
    },
    onAscend: () => tr.undo(marks.pop()!),
    onLeaf: () => {
      if (bailed) return;
      if (otherPatterns.length === 0) {
        count += 1;
        return;
      }
      const tc = countTrailDFS(tr, getCandidates, otherPatterns, counter, tailFreshCaches);
      if (tc === undefined) {
        bailed = true;
        return;
      }
      count += tc.count;
      counter = tc.counter;
    },
  });
  return bailed ? undefined : { count, counter };
}

// ---------- get-doc ----------
function getDocOf(env: MinEnv, w: World, atom: Atom): Atom {
  const atoms = selfAtoms(env, w);
  const ty =
    atom.kind === "sym"
      ? headOr(env.types.get(atom.name) ?? [], UNDEF)
      : (env.exprTypes.find((p) => atomEq(p[0], atom))?.[1] ?? UNDEF);
  const doc = atoms.find(
    (a) =>
      opOf(a) === "@doc" && a.kind === "expr" && a.items.length >= 2 && atomEq(a.items[1]!, atom),
  );
  if (doc === undefined || doc.kind !== "expr") return sym("Empty");
  if (doc.items.length === 5) {
    const desc = doc.items[2]!;
    const paramsWrap = doc.items[3]!;
    const retWrap = doc.items[4]!;
    const params = paramsWrap.kind === "expr" ? paramsWrap.items[1] : undefined;
    const paramList = params && params.kind === "expr" ? params.items : [];
    const retDesc = retWrap.kind === "expr" ? retWrap.items[1]! : UNDEF;
    const n = paramList.length;
    let paramTys: Atom[];
    let retTy: Atom;
    if (opOf(ty) === "->" && ty.kind === "expr" && ty.items.length - 1 === n + 1) {
      const rest = ty.items.slice(1);
      paramTys = rest.slice(0, -1);
      retTy = rest[rest.length - 1]!;
    } else {
      paramTys = Array<Atom>(n).fill(UNDEF);
      retTy = UNDEF;
    }
    const params2 = paramList.map((pp, i) => {
      if (opOf(pp) === "@param" && pp.kind === "expr" && pp.items.length === 2)
        return expr([
          sym("@param"),
          expr([sym("@type"), paramTys[i] ?? UNDEF]),
          expr([sym("@desc"), pp.items[1]!]),
        ]);
      return pp;
    });
    return expr([
      sym("@doc-formal"),
      expr([sym("@item"), atom]),
      expr([sym("@kind"), sym("function")]),
      expr([sym("@type"), ty]),
      desc,
      expr([sym("@params"), expr(params2)]),
      expr([sym("@return"), expr([sym("@type"), retTy]), expr([sym("@desc"), retDesc])]),
    ]);
  }
  if (doc.items.length === 3) {
    return expr([
      sym("@doc-formal"),
      expr([sym("@item"), atom]),
      expr([sym("@kind"), sym("atom")]),
      expr([sym("@type"), ty]),
      doc.items[2]!,
    ]);
  }
  return sym("Empty");
}

// ---------- the step function ----------
function* interpretStack1G(env: MinEnv, fuel: number, st: St, it: Item): Gen<[ItemBatch, St]> {
  if (it.stack === null) return [[], st];
  const top = it.stack.head;
  const prev = it.stack.tail;
  if (top.fin) {
    if (prev === null) return [[it], st];
    const pf = prev.head;
    const pprev = prev.tail;
    const res = inst(env, it.bnd, top.atom);
    if (pf.ret === "chain") {
      if (opOf(pf.atom) === "chain" && pf.atom.kind === "expr" && pf.atom.items.length === 4) {
        const v = pf.atom.items[2]!;
        const templ = pf.atom.items[3]!;
        const nf = frame(makeExpr(env, [sym("chain"), res, v, templ]), pf.ret, pf.vars, false);
        return [[{ stack: cons(nf, pprev), bnd: it.bnd }], st];
      }
      return [[finItem(pprev, errAtom(pf.atom, "chain: corrupt frame"), it.bnd)], st];
    }
    if (pf.ret === "function") {
      if (opOf(res) === "return" && res.kind === "expr" && res.items.length === 2)
        return [[finItem(pprev, res.items[1]!, it.bnd)], st];
      if (isEmbeddedOp(res))
        return [[{ stack: atomToStack(res, cons(pf, pprev)), bnd: it.bnd }], st];
      const target = pprev !== null ? pprev.head.atom : res;
      return [[finItem(pprev, errAtom(target, "NoReturn"), it.bnd)], st];
    }
    return [[], st]; // Ret.none on a finished non-top frame
  }
  const a = top.atom;
  const op = opOf(a);
  const it2 = a.kind === "expr" ? a.items : [];
  switch (op) {
    case "eval":
      if (it2.length === 2) return yield* evalOpG(env, st, prev, it2[1]!, it.bnd);
      break;
    case "evalc":
      if (it2.length === 3) return yield* evalOpG(env, st, prev, it2[1]!, it.bnd);
      break;
    case "chain":
      if (it2.length === 4 && it2[2]!.kind === "var") {
        const v = (it2[2] as { name: string }).name;
        const cont = applySubst([[v, it2[1]!]], it2[3]!);
        // The first-arg evaluation that produced it2[1] is finished, so its internal variables can no longer
        // be observed by anything but the continuation `cont` and the pending frames. Pruning the carried
        // binding to those keeps a deep `chain` tail-recursion (minimal-MeTTa `div` is the worst case) from
        // accumulating an O(n) binding that every later instantiate/merge re-scans. That cost made
        // `(div 350000 5 0)` quadratic. The full stack is visible here (unlike inside a reduce-loop arg
        // sub-evaluation), so the live set is complete; restrictBnd resolves transitively, so a value still
        // reachable through a dropped variable is flattened into what is kept rather than lost.
        const bnd = restrictBnd(env, chainLiveVars(cont, prev), it.bnd);
        return [[{ stack: atomToStack(cont, prev), bnd }], st];
      }
      break;
    case "unify":
      if (it2.length === 5)
        return [unifyOp(env, prev, it2[1]!, it2[2]!, it2[3]!, it2[4]!, it.bnd), st];
      break;
    case "cons-atom":
      if (it2.length === 3 && it2[2]!.kind === "expr")
        return [[finItem(prev, makeExpr(env, [it2[1]!, ...it2[2]!.items]), it.bnd)], st];
      if (it2.length === 3)
        return [[finItem(prev, errAtom(a, "cons-atom: expected expression tail"), it.bnd)], st];
      break;
    case "decons-atom":
      if (it2.length === 2 && it2[1]!.kind === "expr" && it2[1]!.items.length > 0) {
        const [h, ...t] = it2[1]!.items;
        return [[finItem(prev, makeExpr(env, [h!, makeExpr(env, t)]), it.bnd)], st];
      }
      if (it2.length === 2)
        return [
          [finItem(prev, errAtom(a, "decons-atom: expected non-empty expression"), it.bnd)],
          st,
        ];
      break;
    case "context-space":
      if (it2.length === 1) return [[finItem(prev, sym("&self"), it.bnd)], st];
      break;
    case "metta":
    case "capture":
    case "metta-thread": {
      const atom = it2[1]!;
      const [pairs, st2] = yield* mettaEvalG(env, fuel, st, it.bnd, atom);
      if (op === "metta-thread") {
        const out: Item[] = [];
        const scoped = scopeVars(env, it.bnd, prev);
        for (const p of pairs)
          for (const m of merge(it.bnd, restrictBnd(env, scoped, p[1])))
            out.push(finItem(prev, p[0], m));
        return [out, st2];
      }
      return [pairs.map((p) => finItem(prev, p[0], it.bnd)), st2];
    }
    case "get-type":
    case "get-type-space": {
      // get-type uses &self; get-type-space looks up types in the named space's declarations.
      let typeEnv = env;
      if (op === "get-type-space") {
        const sp = inst(env, it.bnd, it2[1]!);
        const sname = sp.kind === "sym" ? sp.name : undefined;
        if (sname !== undefined && sname !== "&self") {
          const sa = namedSpaceAtoms(st.world.spaces.get(sname));
          if (sa.length > 0) typeEnv = buildEnv([...env.atoms, ...sa], env.gt);
        }
      }
      const x = op === "get-type-space" ? it2[2]! : it2[1]!;
      return yield* getTypeOpG(typeEnv, fuel, st, prev, inst(typeEnv, it.bnd, x), it.bnd);
    }
    case "get-doc":
      if (it2.length === 2)
        return [[finItem(prev, getDocOf(env, st.world, inst(env, it.bnd, it2[1]!)), it.bnd)], st];
      break;
    case "match":
      if (it2.length === 4) {
        if (!STREAM_CASE) return matchOp(env, st, prev, it2[1]!, it2[2]!, it2[3]!, it.bnd);
        return [matchItemSource(env, st, prev, it2[1]!, it2[2]!, it2[3]!, it.bnd), st];
      }
      break;
    case "superpose-bind":
      if (it2.length === 2 && it2[1]!.kind === "expr")
        return [it2[1]!.items.map((p) => superposeItem(prev, it.bnd, p)), st];
      break;
    case "collapse-bind": {
      if (it2.length !== 2) break;
      const [atoms, st2] = yield* interpretLoopG(env, fuel, st, [
        { stack: atomToStack(it2[1]!, null), bnd: it.bnd },
      ]);
      return [
        [
          finItem(
            prev,
            makeExpr(
              env,
              atoms.map((p) => makeExpr(env, [p[0], unitA])),
            ),
            it.bnd,
          ),
        ],
        st2,
      ];
    }
    // TS-native extension. `(transaction <body>)` evaluates the body and atomically commits its
    // space mutations only if the body succeeds. Because the world is threaded copy-on-write
    // (cloneWorld -> new St), commit/rollback is snapshot-and-restore: keep the body's world on
    // success, restore the pre-body world otherwise. Rollback trigger (spec A2.1): the body throws
    // (an Error atom result) for every result, or produces zero results. The gensym counter always
    // advances (never reused after rollback).
    case "transaction": {
      if (it2.length !== 2) break;
      const snapshotWorld = st.world;
      const [pairs, st2] = yield* mettaEvalG(env, fuel, st, it.bnd, it2[1]!);
      const committed = pairs.length > 0 && pairs.some((p) => !isErrorAtom(p[0]));
      const world = committed ? st2.world : snapshotWorld;
      return [pairs.map((p) => finItem(prev, p[0], it.bnd)), { counter: st2.counter, world }];
    }
    // TS-native concurrency (async-only; see docs/.../concurrency-primitives.md).
    case "par": {
      // Evaluate every branch concurrently on the same immutable starting world, union their results,
      // and merge their effects as multiset deltas (add-only effects commute; conflicts -> with-mutex).
      const branches = it2.slice(1);
      pendingAsyncOp = "par";
      const results = (yield Promise.all(
        branches.map((br) => mettaEvalAsync(env, fuel, st, it.bnd, br)),
      )) as EvalRes[];
      const out: Item[] = [];
      let counter = st.counter;
      const worlds: World[] = [];
      for (const [pairs, st2] of results) {
        for (const p of pairs) out.push(finItem(prev, p[0], it.bnd));
        worlds.push(st2.world);
        if (st2.counter > counter) counter = st2.counter;
      }
      return [out, { counter, world: mergeWorlds(st.world, worlds) }];
    }
    case "race": {
      // First branch to produce a non-empty result wins; the losers are cancelled via the scope's
      // AbortSignal at their next await. "Skipped" here means a branch that yields no results or
      // throws at the JS level (an abort); a branch that returns MeTTa `(Error ...)` atoms produces
      // a non-empty result like any other value, so it can win the race.
      const branches = it2.slice(1);
      pendingAsyncOp = "race";
      const winner = (yield (async (): Promise<EvalRes> => {
        const ac = new AbortController();
        try {
          return await Promise.any(
            branches.map(async (br) => {
              const r = await mettaEvalAsync(env, fuel, st, it.bnd, br, ac.signal);
              if (r[0].length === 0) throw new Error("empty branch");
              return r;
            }),
          );
        } catch {
          return [[], st];
        } finally {
          ac.abort();
        }
      })()) as EvalRes;
      return [winner[0].map((p) => finItem(prev, p[0], it.bnd)), winner[1]];
    }
    case "once": {
      // Cut nondeterminism to the first result. Works in both drivers (yield* propagates); it is only
      // async when its argument is (e.g. (once (par ...))).
      if (it2.length !== 2) break;
      // `(once (hyperpose (b1 … bn)))` with pure ground branches: race them in worker threads (Node only)
      // and return the first to finish, so an expensive leading branch cannot starve a cheap later one.
      const par = tryParHyperpose(env, st.world, it.bnd, it2[1]!, true);
      if (par !== undefined) {
        const first = par.length > 0 ? [par[0]!] : [];
        return [first.map((a) => finItem(prev, a, it.bnd)), st];
      }
      const namedMatch = tryFastNamedOnceMatch(env, st, it2[1]!, it.bnd);
      if (namedMatch !== undefined) {
        const first =
          namedMatch.value === undefined ? [] : [finItem(prev, namedMatch.value, it.bnd)];
        return [first, namedMatch.state];
      }
      const [pairs, st2] = yield* mettaEvalG(env, fuel, st, it.bnd, it2[1]!);
      const first = pairs.length > 0 ? [pairs[0]!] : [];
      return [first.map((p) => finItem(prev, p[0], p[1])), st2];
    }
    case "with-mutex": {
      // Serialise the body against other `with-mutex` sections of the same name (canonical async
      // Promise-chain lock; release in finally so a throwing/empty body still unlocks).
      if (it2.length !== 3) break;
      const name = mutexKey(inst(env, it.bnd, it2[1]!));
      const body = it2[2]!;
      pendingAsyncOp = "with-mutex";
      const result = (yield (async (): Promise<EvalRes> => {
        const prior = env.mutexes.get(name) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        const chained = prior.then(() => held);
        env.mutexes.set(name, chained);
        await prior;
        try {
          return await mettaEvalAsync(env, fuel, st, it.bnd, body);
        } finally {
          release();
          // Drop the entry once this is the tail of the chain, so the map does not grow unbounded.
          if (env.mutexes.get(name) === chained) env.mutexes.delete(name);
        }
      })()) as EvalRes;
      return [result[0].map((p) => finItem(prev, p[0], it.bnd)), result[1]];
    }
    case "new-state": {
      if (it2.length !== 2) break;
      const id = st.counter;
      const w = cloneWorld(st.world);
      w.store.set(id, inst(env, it.bnd, it2[1]!));
      return [[finItem(prev, stateHandle(id), it.bnd)], { counter: id + 1, world: w }];
    }
    case "get-state": {
      if (it2.length !== 2) break;
      const id = stateId(st.world, inst(env, it.bnd, it2[1]!));
      if (id !== undefined) return [[finItem(prev, st.world.store.get(id) ?? emptyA, it.bnd)], st];
      return [
        [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "get-state: not a state"), it.bnd)],
        st,
      ];
    }
    case "change-state!": {
      if (it2.length !== 3) break;
      const id = stateId(st.world, inst(env, it.bnd, it2[1]!));
      if (id !== undefined) {
        const w = cloneWorld(st.world);
        w.store.set(id, inst(env, it.bnd, it2[2]!));
        return [[finItem(prev, stateHandle(id), it.bnd)], { counter: st.counter, world: w }];
      }
      return [
        [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "change-state!: not a state"), it.bnd)],
        st,
      ];
    }
    case "new-space":
    case "new-mork-space": {
      const id = st.counter;
      const name = "&space-" + String(id);
      const w = cloneWorld(st.world);
      w.spaces.set(name, emptyLog);
      return [[finItem(prev, sym(name), it.bnd)], { counter: id + 1, world: w }];
    }
    case "fork-space": {
      if (it2.length !== 2) break;
      const src = spaceName(st.world, inst(env, it.bnd, it2[1]!));
      if (src === undefined)
        return [
          [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "fork-space: not a space"), it.bnd)],
          st,
        ];
      const srcAtoms =
        src === "&self" ? selfAtoms(env, st.world) : namedSpaceAtoms(st.world.spaces.get(src));
      const id = st.counter;
      const name = "&space-" + String(id);
      const w = cloneWorld(st.world);
      w.spaces.set(name, logFromArray(srcAtoms));
      return [[finItem(prev, sym(name), it.bnd)], { counter: id + 1, world: w }];
    }
    case "add-atom":
      if (it2.length === 3) {
        const added = inst(env, it.bnd, it2[2]!);
        if (opOf(added) === "=") disableTabling(env);
        return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) =>
          appendSpace(env, w, name, [added]),
        );
      }
      break;
    case "remove-atom":
      if (it2.length === 3)
        return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) =>
          eraseSpace(w, name, inst(env, it.bnd, it2[2]!)),
        );
      break;
    case "get-atoms": {
      if (it2.length !== 2) break;
      const name = spaceName(st.world, inst(env, it.bnd, it2[1]!));
      if (name === undefined)
        return [
          [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "get-atoms: not a space"), it.bnd)],
          st,
        ];
      const list =
        name === "&self" ? selfAtoms(env, st.world) : namedSpaceAtoms(st.world.spaces.get(name));
      return [list.map((x) => finItem(prev, x, it.bnd)), st];
    }
    case "pragma!": {
      // `(pragma! <key> <value>)` writes an interpreter setting (Hyperon's pragma!) and returns unit.
      // `max-stack-depth` is the one setting that changes interpretation: it must be an unsigned integer
      // (negative or non-integer -> the same `UnsignedIntegerIsExpected` error Hyperon emits), and 0 means
      // unlimited. Any other key is accepted and ignored, matching Hyperon storing arbitrary keys. A pragma
      // only ever tightens the in-language depth bound; it cannot touch the host's step budget.
      if (it2.length !== 3) break;
      const key = inst(env, it.bnd, it2[1]!);
      if (key.kind === "sym" && key.name === "max-stack-depth") {
        const val = inst(env, it.bnd, it2[2]!);
        const n = val.kind === "gnd" && val.value.g === "int" ? val.value.n : undefined;
        if (n === undefined || n < 0 || (typeof n === "number" && !Number.isInteger(n)))
          return [[finItem(prev, errAtom(a, "UnsignedIntegerIsExpected"), it.bnd)], st];
        const w = cloneWorld(st.world);
        w.maxStackDepth = Number(n);
        return [[finItem(prev, emptyExpr, it.bnd)], { counter: st.counter, world: w }];
      }
      return [[finItem(prev, emptyExpr, it.bnd)], st];
    }
    case "bind!": {
      if (it2.length !== 3) break;
      const tok = inst(env, it.bnd, it2[1]!);
      if (tok.kind === "sym") {
        const w = cloneWorld(st.world);
        w.tokens.set(tok.name, inst(env, it.bnd, it2[2]!));
        return [[finItem(prev, emptyExpr, it.bnd)], { counter: st.counter, world: w }];
      }
      return [[finItem(prev, errAtom(tok, "bind!: token must be a symbol"), it.bnd)], st];
    }
    case "import!": {
      if (it2.length !== 3) break;
      const fileAtom = inst(env, it.bnd, it2[2]!);
      // The built-in `curry` module turns on PeTTa-style auto-currying for the rest of the run.
      if (fileAtom.kind === "sym" && fileAtom.name === "curry") env.curry = true;
      const fileAtoms = fileAtom.kind === "sym" ? (env.imports.get(fileAtom.name) ?? []) : [];
      // Bring the module's type signatures into the env so type-directed evaluation sees them (a
      // sig in a space's atom list is not consulted by `env.sigs`). Rules stay in the space and are
      // read dynamically by candidate selection.
      registerImportedTypes(env, fileAtoms);
      // Only an import that actually brings in equations can invalidate tabling/compilation (those run off
      // the static rule index). A no-op import, a missing or non-symbol module like `(library lib_patrick)`,
      // or a data-only one, leaves the compiled core valid, so it must not be switched off.
      if (fileAtoms.some((a) => opOf(a) === "=")) disableTabling(env);
      return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) =>
        appendSpace(env, w, name, fileAtoms),
      );
    }
    default:
      break;
  }
  if (isEmbeddedOp(a)) return [[finItem(prev, errAtom(a, "unsupported minimal op"), it.bnd)], st];
  return [[{ stack: cons(frame(top.atom, top.ret, top.vars, true), prev), bnd: it.bnd }], st];
}

// space-mutation helpers used by add/remove/import
/** Index any `(= lhs rhs)` rules among `atoms` into a (freshly cloned) world's rule index. Facts are
 *  left to the log; only equality rules are indexed, so function reduction never scans the fact log. */
function indexSelfRules(w: World, atoms: readonly Atom[]): void {
  for (const x of atoms) {
    if (opOf(x) === "=" && x.kind === "expr" && x.items.length === 3) {
      const lhs = x.items[1]!;
      const rhs = x.items[2]!;
      const k = headKey(lhs);
      if (k === undefined) w.selfVarRules = [...w.selfVarRules, [lhs, rhs]];
      else w.selfRules.set(k, [...(w.selfRules.get(k) ?? []), [lhs, rhs]]);
    }
  }
}
function appendSpace(env: MinEnv, w0: World, name: string, atoms: Atom[]): World {
  // `&self` add-atom only touches `selfExtra` (and the rule index iff an equality is added), so SHARE the
  // unchanged spaces/store/tokens by reference rather than `cloneWorld`'s four fresh Maps. That copy was
  // the per-add allocation that kept the add-heavy benchmarks (matespace family) quadratic-in-GC even
  // after the log made append itself O(1).
  if (name === "&self") {
    let selfRules = w0.selfRules;
    let selfVarRules = w0.selfVarRules;
    let selfExtra = w0.selfExtra;
    let flatSelfExtra = w0.flatSelfExtra;
    let copiedRules = false;
    for (const x of atoms) {
      if (opOf(x) === "=" && x.kind === "expr" && x.items.length === 3) {
        if (!copiedRules) {
          selfRules = new Map(w0.selfRules);
          copiedRules = true;
        }
        const lhs = x.items[1]!;
        const rhs = x.items[2]!;
        const k = headKey(lhs);
        if (k === undefined) selfVarRules = [...selfVarRules, [lhs, rhs]];
        else selfRules.set(k, [...(selfRules.get(k) ?? []), [lhs, rhs]]);
      }
    }
    if (env.useFlatAtomspace === true) {
      if (flatSelfExtra !== undefined || logSize(selfExtra) === 0) {
        const base = flatSelfExtra ?? FlatAtomSpace.empty();
        const appended = base.appendAll(atoms);
        if (appended !== undefined) {
          flatSelfExtra = appended;
        } else {
          // The batch is not flat-storable: move everything to the plain log, permanently, so the
          // candidate order stays the insertion order (flat facts first would interleave otherwise).
          selfExtra = logFromArray([...base.toArray(), ...logToArray(selfExtra), ...atoms]);
          flatSelfExtra = undefined;
        }
      } else {
        selfExtra = logAppendAll(selfExtra, atoms);
      }
    } else {
      selfExtra = logAppendAll(selfExtra, atoms);
    }
    return {
      spaces: w0.spaces,
      store: w0.store,
      tokens: w0.tokens,
      selfExtra,
      flatSelfExtra,
      selfRules,
      selfVarRules,
      maxStackDepth: w0.maxStackDepth,
    };
  }
  const spaces = new Map(w0.spaces);
  spaces.set(name, logAppendAll(spaces.get(name) ?? emptyLog, atoms));
  return { ...w0, spaces };
}
function eraseSpace(w0: World, name: string, a: Atom): World {
  const w = cloneWorld(w0);
  const erase1 = (xs: readonly Atom[]): Atom[] => {
    const i = xs.findIndex((y) => atomEq(y, a));
    return i < 0 ? [...xs] : [...xs.slice(0, i), ...xs.slice(i + 1)];
  };
  if (name === "&self") {
    if (w.flatSelfExtra !== undefined) {
      const next = w.flatSelfExtra.removeOne(a);
      if (next.size !== w.flatSelfExtra.size) {
        w.flatSelfExtra = next;
        return w;
      }
    }
    const xs = logToArray(w.selfExtra);
    const i = xs.findIndex((y) => atomEq(y, a));
    if (i >= 0) w.selfExtra = logFromArray([...xs.slice(0, i), ...xs.slice(i + 1)]);
  } else w.spaces.set(name, logFromArray(erase1(namedSpaceAtoms(w.spaces.get(name)))));
  return w;
}
function spaceMutate(
  env: MinEnv,
  st: St,
  prev: Stack,
  s: Atom,
  b: Bindings,
  f: (w: World, name: string) => World,
): [Item[], St] {
  const name = spaceName(st.world, inst(env, b, s));
  if (name === undefined) return [[finItem(prev, errAtom(inst(env, b, s), "not a space"), b)], st];
  return [[finItem(prev, emptyExpr, b)], { counter: st.counter, world: f(st.world, name) }];
}

function compiledAddAtom(env: MinEnv, st: St, space: Atom, added: Atom): St | undefined {
  if (opOf(added) === "=") return undefined;
  const name = spaceName(st.world, space);
  if (name === undefined) return undefined;
  return { counter: st.counter, world: appendSpace(env, st.world, name, [added]) };
}

/** The `(match space pattern template)` solutions a compiled nondet body consumes: the same
 *  candidate source, per-candidate freshening, and counter accounting as the interpreted match
 *  (matchSetup + matchSingleSolutions/EndState), returning each instantiated template with its
 *  solution bindings. Undefined when the pattern splits into a conjunction (outside the compiled
 *  subset; the holder bails to the interpreter). */
function compiledMatchSolutions(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  template: Atom,
): { pairs: ReadonlyArray<readonly [Atom, Bindings]>; counterDelta: number } | undefined {
  const { getCandidates, patterns } = matchSetup(env, st, space, pattern, emptyBindings);
  if (patterns.length !== 1) return undefined;
  const pat = patterns[0]!;
  const { endState } = matchSingleEndState(env, getCandidates, pat, template, st, emptyBindings);
  const pairs: Array<readonly [Atom, Bindings]> = [];
  for (const m of matchSingleSolutions(env, getCandidates, pat, st, emptyBindings))
    pairs.push([inst(env, m, template), m]);
  return { pairs, counterDelta: endState.counter - st.counter };
}

/** The compiled add-if-absent: an exact ground-membership probe, then append when absent. Covers
 *  `&self` (which tryFastNamedAddIfAbsent leaves to the interpreter) under the same guards as the
 *  exact-count candidate path: every runtime fact ground, no static or variable-headed facts of this
 *  head that could also unify, no state handles. The counter advances by the space size, the same
 *  convention as the named-space fast path (the interpreted collapse-once-match iterates the
 *  candidates); compiled callers are on the alpha-equivalent naming contract anyway. */
function compiledAddIfAbsent(
  env: MinEnv,
  st: St,
  space: Atom,
  atom: Atom,
): { added: boolean; state: St } | undefined {
  if (!atom.ground || opOf(atom) === "=") return undefined;
  const w = st.world;
  if (w.store.size !== 0) return undefined;
  const name = spaceName(w, space);
  if (name === undefined) return undefined;
  if (name === "&self") {
    const k = headKey(atom);
    if (k === undefined) return undefined;
    if (env.varHeadedFacts.length !== 0 || (env.factIndex.get(k)?.length ?? 0) !== 0)
      return undefined;
    if (logNonGround(w.selfExtra) !== 0 || (w.flatSelfExtra?.nonGroundCount ?? 0) !== 0)
      return undefined;
    const size = logSize(w.selfExtra) + (w.flatSelfExtra?.size ?? 0);
    const checked: St = { counter: st.counter + size, world: w };
    const present =
      idxCount(logGroundIdx(w.selfExtra), atom) + (w.flatSelfExtra?.exactCount(atom) ?? 0);
    if (present !== 0) return { added: false, state: checked };
    return {
      added: true,
      state: { counter: checked.counter, world: appendSpace(env, w, "&self", [atom]) },
    };
  }
  const log = w.spaces.get(name) ?? emptyLog;
  if (logNonGround(log) !== 0) return undefined;
  const checked: St = { counter: st.counter + logSize(log), world: w };
  if (idxCount(logGroundIdx(log), atom) !== 0) return { added: false, state: checked };
  return {
    added: true,
    state: { counter: checked.counter, world: appendSpace(env, w, name, [atom]) },
  };
}

const COMPILED_IMPURE_OPS: CompiledImpureOps = {
  addAtom: compiledAddAtom,
  matchSolutions: compiledMatchSolutions,
  addIfAbsent: compiledAddIfAbsent,
};

function* getTypeOpG(
  env: MinEnv,
  fuel: number,
  st: St,
  prev: Stack,
  xi: Atom,
  b: Bindings,
): Gen<[Item[], St]> {
  const emit = function* (st0: St): Gen<[Item[], St]> {
    let acc: Item[] = [];
    let cur = st0;
    for (const t of getTypesForQuery(env, typePrep(env, st.world, xi))) {
      const [rs, st2] = yield* mettaEvalG(env, fuel, cur, b, t);
      acc = [...acc, ...rs.map((p) => finItem(prev, p[0], b))];
      cur = st2;
    }
    return [acc, cur];
  };
  if (xi.kind === "expr" && xi.items.length > 0) {
    const head = xi.items[0]!;
    const args = xi.items.slice(1);
    if (head.kind === "sym") {
      if (typeMismatch(env, st.world, head.name, args) !== undefined) return [[], st];
      return yield* emit(st);
    }
    const illTyped = getTypes(env, typePrep(env, st.world, head)).some((ft) => {
      if (opOf(ft) === "->" && ft.kind === "expr")
        return typeCheckArgs(env, st.world, ft.items.slice(1, -1), 0, [], args) !== undefined;
      return false;
    });
    return illTyped ? [[], st] : yield* emit(st);
  }
  return yield* emit(st);
}

// Shared setup for `match`: resolve the queried space, normalize a `(, ...)` conjunction into its goal
// patterns, and build the candidate-fact generator (&self's functor index, or a named space's atoms).
// Factored out of matchOp so the trail counter reuses the exact same candidate semantics (no second copy).
function matchSetup(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  b: Bindings,
): { getCandidates: (pInst: Atom) => CandidateSource; patterns: Atom[] } {
  const sn = spaceName(st.world, inst(env, b, space));
  const subbed = subTokens(st.world, pattern, env.intern);
  const patterns =
    opOf(subbed) === "," && subbed.kind === "expr"
      ? subbed.items.slice(1).map((p) => resolveStates(st.world, p))
      : [resolveStates(st.world, subbed)];
  // &self uses the functor index. Named spaces use the same exact-ground log index when it is sound,
  // otherwise they scan in insertion order.
  if (sn === undefined || sn === "&self") {
    return { getCandidates: (pInst) => matchCandidates(env, st.world, pInst), patterns };
  }
  return { getCandidates: namedSpaceCandidateGetter(st.world, st.world.spaces.get(sn)), patterns };
}

function matchInsideOnce(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || opOf(a) !== "once" || a.items.length !== 2) return undefined;
  const inner = a.items[1]!;
  return inner.kind === "expr" && opOf(inner) === "match" && inner.items.length === 4
    ? inner
    : undefined;
}

function matchFromEmptyCollapseCheck(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || opOf(a) !== "==" || a.items.length !== 3) return undefined;
  const left = a.items[1]!;
  const right = a.items[2]!;
  const collapseArg = (x: Atom): ExprAtom | undefined =>
    x.kind === "expr" && opOf(x) === "collapse" && x.items.length === 2
      ? matchInsideOnce(x.items[1]!)
      : undefined;
  if (atomEq(left, emptyExpr)) return collapseArg(right);
  if (atomEq(right, emptyExpr)) return collapseArg(left);
  return undefined;
}

function tryFastNamedOnceMatch(
  env: MinEnv,
  st: St,
  body: Atom,
  b: Bindings,
): { value: Atom | undefined; state: St } | undefined {
  if (body.kind !== "expr" || opOf(body) !== "match" || body.items.length !== 4) return undefined;
  const sn = spaceName(st.world, inst(env, b, body.items[1]!));
  if (sn === undefined || sn === "&self") return undefined;
  const subbed = subTokens(st.world, body.items[2]!, env.intern);
  if (opOf(subbed) === "," && subbed.kind === "expr") return undefined;
  const pInst = inst(env, b, resolveStates(st.world, subbed));
  const space = st.world.spaces.get(sn) ?? emptyLog;
  if (!pInst.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const st2 = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), pInst) === 0) return { value: undefined, state: st2 };
  return { value: inst(env, b, body.items[3]!), state: st2 };
}

function tryFastNamedAddIfAbsent(
  env: MinEnv,
  st: St,
  ifExpr: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const match = matchFromEmptyCollapseCheck(ifExpr.items[1]!);
  if (match === undefined) return undefined;
  const add = ifExpr.items[2]!;
  const otherwise = ifExpr.items[3]!;
  if (
    add.kind !== "expr" ||
    opOf(add) !== "add-atom" ||
    add.items.length !== 3 ||
    otherwise.kind !== "expr" ||
    opOf(otherwise) !== "empty" ||
    otherwise.items.length !== 1
  )
    return undefined;
  const matchSpace = inst(env, b, match.items[1]!);
  const addSpace = inst(env, b, add.items[1]!);
  const matchAtom = inst(
    env,
    b,
    resolveStates(st.world, subTokens(st.world, match.items[2]!, env.intern)),
  );
  const addAtom = inst(env, b, add.items[2]!);
  if (!atomEq(matchSpace, addSpace) || !atomEq(matchAtom, addAtom)) return undefined;
  const name = spaceName(st.world, matchSpace);
  if (name === undefined || name === "&self") return undefined;
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!matchAtom.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), matchAtom) !== 0) return { added: false, state: checked };
  if (opOf(addAtom) === "=") disableTabling(env);
  return {
    added: true,
    state: { counter: checked.counter, world: appendSpace(env, checked.world, name, [addAtom]) },
  };
}

function isCanonicalAddUniqueRule(lhs: Atom, rhs: Atom): boolean {
  if (lhs.kind !== "expr" || opOf(lhs) !== "add-unique-or-fail" || lhs.items.length !== 3)
    return false;
  const spaceVar = lhs.items[1]!;
  const exprVar = lhs.items[2]!;
  if (spaceVar.kind !== "var" || exprVar.kind !== "var") return false;
  if (rhs.kind !== "expr" || opOf(rhs) !== "let" || rhs.items.length !== 4) return false;
  const stVar = rhs.items[1]!;
  const key = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (stVar.kind !== "var") return false;
  if (
    key.kind !== "expr" ||
    opOf(key) !== "s" ||
    key.items.length !== 2 ||
    key.items[1]!.kind !== "expr" ||
    opOf(key.items[1]!) !== "repra" ||
    key.items[1]!.items.length !== 2 ||
    !atomEq(key.items[1]!.items[1]!, exprVar)
  )
    return false;
  if (body.kind !== "expr" || opOf(body) !== "if" || body.items.length !== 4) return false;
  const match = matchFromEmptyCollapseCheck(body.items[1]!);
  const add = body.items[2]!;
  const otherwise = body.items[3]!;
  return (
    match !== undefined &&
    atomEq(match.items[1]!, spaceVar) &&
    atomEq(match.items[2]!, stVar) &&
    add.kind === "expr" &&
    opOf(add) === "add-atom" &&
    add.items.length === 3 &&
    atomEq(add.items[1]!, spaceVar) &&
    atomEq(add.items[2]!, stVar) &&
    otherwise.kind === "expr" &&
    opOf(otherwise) === "empty" &&
    otherwise.items.length === 1
  );
}

function tryFastAddUniqueOrFailCall(
  env: MinEnv,
  st: St,
  call: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalAddUniqueRule(rules[0]![0], rules[0]![1])) return undefined;
  const spaceAtom = inst(env, b, call.items[1]!);
  const name = spaceName(st.world, spaceAtom);
  if (name === undefined || name === "&self") return undefined;
  const value = inst(env, b, call.items[2]!);
  const key = expr([sym("s"), expr([sym("repra"), value])]);
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!key.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = { counter: st.counter + rules.length + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), key) !== 0) return { added: false, state: checked };
  return {
    added: true,
    state: { counter: checked.counter, world: appendSpace(env, checked.world, name, [key]) },
  };
}

type QueueParts = { inList: ExprAtom; outList: ExprAtom; size: IntVal };
type FastRuleResult = { results: Array<[Atom, Bindings]>; state: St };

const isExprOp = (a: Atom, op: string, len: number): a is ExprAtom =>
  a.kind === "expr" && a.items.length === len && opOf(a) === op;

const isRuleVar = (a: Atom): boolean => a.kind === "var";

const isIntLiteral = (a: Atom, n: IntVal): boolean => atomEq(a, gint(n));

const intValue = (a: Atom): IntVal | undefined =>
  a.kind === "gnd" && a.value.g === "int" ? a.value.n : undefined;

type QueueRuleArgs = { eVar: Atom; inVar: Atom; outAtom: Atom; nVar: Atom };

function queueRuleArgs(lhs: Atom, op: "enqueue" | "dequeue"): QueueRuleArgs | undefined {
  if (!isExprOp(lhs, op, 3)) return undefined;
  const eVar = lhs.items[1]!;
  const lhsQueue = lhs.items[2]!;
  if (!isRuleVar(eVar) || !isExprOp(lhsQueue, "queue", 4)) return undefined;
  return {
    eVar,
    inVar: lhsQueue.items[1]!,
    outAtom: lhsQueue.items[2]!,
    nVar: lhsQueue.items[3]!,
  };
}

function queueParts(a: Atom): QueueParts | undefined {
  if (!isExprOp(a, "queue", 4)) return undefined;
  const inList = a.items[1]!;
  const outList = a.items[2]!;
  const size = intValue(a.items[3]!);
  if (inList.kind !== "expr" || outList.kind !== "expr" || size === undefined) return undefined;
  return { inList, outList, size };
}

function plusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "+", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function minusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "-", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function isCanonicalEmptyQueueRule(lhs: Atom, rhs: Atom): boolean {
  return (
    isExprOp(lhs, "empty-queue", 1) &&
    isExprOp(rhs, "queue", 4) &&
    atomEq(rhs.items[1]!, emptyExpr) &&
    atomEq(rhs.items[2]!, emptyExpr) &&
    isIntLiteral(rhs.items[3]!, 0)
  );
}

function isCanonicalEnqueueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "enqueue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outVar, nVar } = lhsVars;
  const rhsIn = rhs.items[1]!;
  return (
    isRuleVar(inVar) &&
    isRuleVar(outVar) &&
    isRuleVar(nVar) &&
    isExprOp(rhsIn, "cons", 3) &&
    atomEq(rhsIn.items[1]!, eVar) &&
    atomEq(rhsIn.items[2]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    plusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalNormalDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outCons, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !isRuleVar(nVar) || !isExprOp(outCons, "cons", 3)) return false;
  const outVar = outCons.items[2]!;
  return (
    isRuleVar(outVar) &&
    atomEq(outCons.items[1]!, eVar) &&
    atomEq(rhs.items[1]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    minusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalReverseDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "let", 4)) return false;
  const { eVar, inVar, outAtom, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !atomEq(outAtom, emptyExpr) || !isRuleVar(nVar)) return false;
  const pat = rhs.items[1]!;
  const rev = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (!isExprOp(pat, "cons", 3) || !isExprOp(rev, "reverse", 2) || !isExprOp(body, "queue", 4))
    return false;
  const restVar = pat.items[2]!;
  return (
    isRuleVar(restVar) &&
    atomEq(pat.items[1]!, eVar) &&
    atomEq(rev.items[1]!, inVar) &&
    atomEq(body.items[1]!, emptyExpr) &&
    atomEq(body.items[2]!, restVar) &&
    minusOne(body.items[3]!, nVar)
  );
}

function tryFastEmptyQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEmptyQueueRule(rules[0]![0], rules[0]![1]))
    return undefined;
  return {
    results: [[expr([sym("queue"), emptyExpr, emptyExpr, gint(0)]), emptyBindings]],
    state: { counter: st.counter + rules.length, world: st.world },
  };
}

function tryFastEnqueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEnqueueRule(rules[0]![0], rules[0]![1])) return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const nextIn = expr([call.items[1]!, ...q.inList.items]);
  return {
    results: [[expr([sym("queue"), nextIn, q.outList, gint(addInt(q.size, 1))]), emptyBindings]],
    // The interpreted RHS calls the stdlib `(cons ...)` rule once before `queue` becomes inert.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

function queuePopBindings(want: Atom, got: Atom): Bindings[] | undefined {
  const ms = matchAtoms(want, got).filter((m) => !hasLoop(m));
  return ms.length === 0 ? undefined : ms;
}

function tryFastDequeueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (
    rules.length !== 2 ||
    !isCanonicalNormalDequeueRule(rules[0]![0], rules[0]![1]) ||
    !isCanonicalReverseDequeueRule(rules[1]![0], rules[1]![1])
  )
    return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const wanted = call.items[1]!;
  if (q.outList.items.length > 0) {
    const got = q.outList.items[0]!;
    const ms = queuePopBindings(wanted, got);
    if (ms === undefined) return undefined;
    const next = expr([
      sym("queue"),
      q.inList,
      expr(q.outList.items.slice(1)),
      gint(subInt(q.size, 1)),
    ]);
    return {
      results: ms.map((m) => [next, m]),
      state: { counter: st.counter + rules.length, world: st.world },
    };
  }
  if (q.inList.items.length === 0) return undefined;
  const reversed = [...q.inList.items].reverse();
  const got = reversed[0]!;
  const ms = queuePopBindings(wanted, got);
  if (ms === undefined) return undefined;
  const next = expr([sym("queue"), emptyExpr, expr(reversed.slice(1)), gint(subInt(q.size, 1))]);
  return {
    results: ms.map((m) => [next, m]),
    // The reverse branch applies the dequeue rule, then the stdlib `let` rule.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

function tryFastQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const op = opOf(call);
  if (op === "empty-queue" && call.items.length === 1) return tryFastEmptyQueueCall(env, st, call);
  if (op === "enqueue" && call.items.length === 3) return tryFastEnqueueCall(env, st, call);
  if (op === "dequeue" && call.items.length === 3) return tryFastDequeueCall(env, st, call);
  return undefined;
}

function tileCellKey(a: Atom): string | undefined {
  if (a.kind === "sym") return "s:" + a.name;
  if (a.kind === "gnd" && a.value.g === "int") return "i:" + String(a.value.n);
  return undefined;
}

function tileStateKey(a: Atom): string | undefined {
  if (a.kind !== "expr" || a.items.length !== 9) return undefined;
  const parts: string[] = [];
  let blanks = 0;
  for (const cell of a.items) {
    if (cell.kind === "sym" && cell.name === "___") blanks += 1;
    const k = tileCellKey(cell);
    if (k === undefined) return undefined;
    parts.push(k);
  }
  return blanks === 1 ? parts.join("|") : undefined;
}

function tileNeighbors(state: ExprAtom): ExprAtom[] {
  const blank = state.items.findIndex((x) => x.kind === "sym" && x.name === "___");
  const swaps =
    blank === 0
      ? [1, 3]
      : blank === 1
        ? [0, 2, 4]
        : blank === 2
          ? [1, 5]
          : blank === 3
            ? [0, 4, 6]
            : blank === 4
              ? [1, 3, 5, 7]
              : blank === 5
                ? [2, 4, 8]
                : blank === 6
                  ? [3, 7]
                  : blank === 7
                    ? [4, 6, 8]
                    : [5, 7];
  const out: ExprAtom[] = [];
  for (const j of swaps) {
    const items = state.items.slice();
    [items[blank], items[j]] = [items[j]!, items[blank]!];
    out.push(expr(items));
  }
  return out;
}

function tileVisitedAtom(state: Atom): Atom {
  return expr([sym("s"), expr([sym("repra"), state])]);
}

function hasCanonicalTilePuzzleRuntime(env: MinEnv, w: World): boolean {
  if ((env.ruleIndex.get("move")?.length ?? 0) !== 24) return false;
  if ((env.ruleIndex.get("bfs_all")?.length ?? 0) !== 1) return false;
  if ((env.ruleIndex.get("bfs_loop")?.length ?? 0) !== 2) return false;
  if (logSize(w.spaces.get("&dup") ?? emptyLog) !== 0) return false;
  const emptyRules = candidatesW(env, w, expr([sym("empty-queue")]));
  if (emptyRules.length !== 1 || !isCanonicalEmptyQueueRule(emptyRules[0]![0], emptyRules[0]![1]))
    return false;
  const enqueueRules = candidatesW(
    env,
    w,
    expr([sym("enqueue"), emptyExpr, expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    enqueueRules.length !== 1 ||
    !isCanonicalEnqueueRule(enqueueRules[0]![0], enqueueRules[0]![1])
  )
    return false;
  const dequeueRules = candidatesW(
    env,
    w,
    expr([sym("dequeue"), variable("_"), expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    dequeueRules.length !== 2 ||
    !isCanonicalNormalDequeueRule(dequeueRules[0]![0], dequeueRules[0]![1]) ||
    !isCanonicalReverseDequeueRule(dequeueRules[1]![0], dequeueRules[1]![1])
  )
    return false;
  const addUniqueRules = candidatesW(
    env,
    w,
    expr([sym("add-unique-or-fail"), sym("&dup"), emptyExpr]),
  );
  return (
    addUniqueRules.length === 1 &&
    isCanonicalAddUniqueRule(addUniqueRules[0]![0], addUniqueRules[0]![1])
  );
}

function tryFastTilePuzzleBfsAll(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  if (opOf(call) !== "bfs_all" || call.items.length !== 2 || st.world.store.size !== 0)
    return undefined;
  const start = call.items[1]!;
  const startKey = tileStateKey(start);
  if (start.kind !== "expr" || startKey === undefined) return undefined;
  if (!hasCanonicalTilePuzzleRuntime(env, st.world)) return undefined;
  const seen = new Set<string>();
  const added: Atom[] = [];
  const queue: ExprAtom[] = [start];
  let head = 0;
  while (head < queue.length) {
    const state = queue[head++]!;
    for (const next of tileNeighbors(state)) {
      const key = tileStateKey(next)!;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(tileVisitedAtom(next));
      queue.push(next);
    }
  }
  return {
    results: [[gint(queue.length), emptyBindings]],
    state: { counter: st.counter, world: appendSpace(env, st.world, "&dup", added) },
  };
}

// True if `a` carries a grounded atom with a custom matcher (`.match`). unifyTrail compares grounded atoms
// by equality, so a query touching one declines to the immutable matcher (which honors `.match`).
function atomHasCustomGrounded(a: Atom): boolean {
  if (a.kind === "gnd") return (a as { match?: unknown }).match !== undefined;
  if (a.kind === "expr") return a.items.some(atomHasCustomGrounded);
  return false;
}

// Naive trail DFS counts each candidate per node, so a large cyclic join (which wcoJoin handles AGM-
// optimally) would blow up; this caps the per-query node visits and declines past it. matchConjCount only
// ever runs the trail over the small non-ground tail, so this is a safety net, not the common path.
const TRAIL_COUNT_BUDGET = 8_000_000;

// Count the solutions of a conjunctive `match` on a WAM-style trail (experimental.trail): bind variables in
// place over a DFS of the candidate facts, undoing on backtrack, never building a `Bindings`. The immutable
// `merge` path allocates a binding set per solution (`permutations` builds ~360k); this allocates none. A
// solution *count* is name-independent, so the gensym ordering that blocks a byte-identical result-producing
// trail match does not affect it — this is byte-identical to counting the immutable matcher's solutions.
// Returns undefined to fall back when a pattern/candidate carries a custom grounded matcher unifyTrail
// cannot reproduce.
// A fresh trail seeded with `b0`'s value bindings and eq aliases: the starting point for a trail count.
function seededTrail(b0: Bindings): Trail {
  const tr = new Trail();
  for (const [x, a] of valEntries(b0)) tr.bind(x, a);
  for (const r of eqRelations(b0)) if (tr.get(r.x) === undefined) tr.bind(r.x, variable(r.y));
  return tr;
}

// Count the solutions of `patterns` over a pre-seeded trail: bind each candidate in place over a DFS,
// undoing on backtrack, never building a binding set. Returns undefined to decline (a custom grounded
// matcher, or the node budget). Shared by matchCountTrail (the whole match) and matchConjCount's tail.
function countTrailDFS(
  tr: Trail,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  counter0: number,
  freshCaches?: ReadonlyArray<Map<Atom, Atom>>,
): { count: number; counter: number } | undefined {
  let counter = counter0;
  let count = 0;
  let bailed = false;
  let nodes = 0;
  const rec = (i: number): void => {
    if (++nodes > TRAIL_COUNT_BUDGET) {
      bailed = true; // a non-ground tail that is itself a large naive join: decline to the immutable path
      return;
    }
    if (i === patterns.length) {
      count += 1;
      return;
    }
    const pInst = tr.resolve(patterns[i]!);
    const source = getCandidates(pInst);
    // One freshen cache PER GOAL LEVEL, not one shared across the whole tail: two tail goals can match the
    // same stored fact, and a single cache would hand them the SAME freshened copy, so a fresh variable that
    // goal i bound to a query variable would reappear in goal i+1's candidate and fail to unify (a spurious
    // coreference). matchConjJoin allocates a fresh cache per tail goal for exactly this reason; mirror it.
    // The per-level cache is still shared across all join leaves, so each tail candidate freshens once.
    const cache = syntheticCandidateSource(source) ? undefined : freshCaches?.[i];
    for (const cand of source) {
      if (atomHasCustomGrounded(cand)) {
        bailed = true;
        return;
      }
      // Freshen the candidate's variables. The same fact recurs at every join leaf (the E template over all
      // 40320 permutations), so a cache shared across leaves freshens it once, not once per leaf — and the
      // counter then advances exactly as matchConjJoin's freshCache, keeping the fold's gensym in step.
      let fresh = cache?.get(cand);
      if (fresh === undefined) {
        fresh = freshenRule(counter, cand, cand)[0];
        counter += 1;
        cache?.set(cand, fresh);
      }
      const mk = tr.mark();
      if (unifyTrail(tr, pInst, fresh)) rec(i + 1);
      tr.undo(mk);
      if (bailed) return;
    }
    counter += candidateCounterPadding(source);
  };
  rec(0);
  return bailed ? undefined : { count, counter };
}

function matchCountTrail(
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { count: number; counter: number } | undefined {
  for (const p of patterns) if (atomHasCustomGrounded(p)) return undefined;
  return countTrailDFS(seededTrail(b0), getCandidates, patterns, st.counter);
}

interface MatchPlan {
  readonly endState: St;
  readonly valuesAreNormal: boolean;
  foldItems(prev: Stack): Iterable<Item>;
  foldValues(): Iterable<Atom>;
}

function* matchSingleSolutions(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  pattern: Atom,
  st: St,
  b0: Bindings,
): Iterable<Bindings> {
  let counter = st.counter;
  const pInst = inst(env, b0, pattern);
  const source = getCandidates(pInst);
  for (const atom of source) {
    const fresh = freshenRule(counter, atom, atom)[0];
    counter += 1;
    for (const mb of matchAtoms(pInst, fresh))
      for (const m of merge(b0, mb)) if (!hasLoop(m)) yield m;
  }
  counter += candidateCounterPadding(source);
}

function matchSingleEndState(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  pattern: Atom,
  template: Atom,
  st: St,
  b0: Bindings,
): { endState: St; valuesAreNormal: boolean } {
  const pInst = inst(env, b0, pattern);
  let valuesAreNormal =
    isNormalForm(env, st.world, pInst) && isNormalFormAssumingVars(env, st.world, template);
  let counter = st.counter;
  const source = getCandidates(pInst);
  for (const atom of source) {
    counter += 1;
    if (valuesAreNormal && !isNormalForm(env, st.world, atom)) valuesAreNormal = false;
  }
  counter += candidateCounterPadding(source);
  return { endState: { counter, world: st.world }, valuesAreNormal };
}

function matchPlan(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): MatchPlan {
  const { getCandidates, patterns } = matchSetup(env, st, space, pattern, b);
  if (patterns.length === 1) {
    const pat = patterns[0]!;
    const { endState, valuesAreNormal } = matchSingleEndState(
      env,
      getCandidates,
      pat,
      template,
      st,
      b,
    );
    const solutions = (): Iterable<Bindings> =>
      matchSingleSolutions(env, getCandidates, pat, st, b);
    return {
      endState,
      valuesAreNormal,
      *foldItems(prev: Stack): Iterable<Item> {
        for (const m of solutions()) yield finItem(prev, inst(env, m, template), m);
      },
      *foldValues(): Iterable<Atom> {
        for (const m of solutions()) yield inst(env, m, template);
      },
    };
  }
  const [sols, endState] =
    patterns.length >= 2
      ? matchConjJoin(env, getCandidates, patterns, st, b)
      : matchConj(env, getCandidates, patterns, st, [b]);
  return {
    endState,
    valuesAreNormal: false,
    *foldItems(prev: Stack): Iterable<Item> {
      for (const m of sols) if (!hasLoop(m)) yield finItem(prev, inst(env, m, template), m);
    },
    *foldValues(): Iterable<Atom> {
      for (const m of sols) if (!hasLoop(m)) yield inst(env, m, template);
    },
  };
}

function matchOp(
  env: MinEnv,
  st: St,
  prev: Stack,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): [Item[], St] {
  const plan = matchPlan(env, st, space, pattern, template, b);
  const out: Item[] = [];
  for (const item of plan.foldItems(prev)) out.push(item);
  return [out, plan.endState];
}

function matchItemSource(
  env: MinEnv,
  st: St,
  prev: Stack,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): ItemSource {
  const plan = matchPlan(env, st, space, pattern, template, b);
  return {
    endState: plan.endState,
    foldItems(): Iterable<Item> {
      return plan.foldItems(prev);
    },
  };
}

// ---------- driver (iterative) ----------
function* interpretLoopG(
  env: MinEnv,
  fuel: number,
  st: St,
  work: Item[] | ItemSource,
  // Optional streaming consumer: when given, every finished branch is handed to `sink` instead of being
  // collected into the returned array (which stays empty). An aggregate like `(length (collapse X))` uses
  // this to count results without ever materialising them. The array, the collapsed tuple, and the length
  // walk are all O(N) structures the fold avoids.
  sink?: (pair: [Atom, Bindings]) => void,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const done: Array<[Atom, Bindings]> = [];
  const emit = (pair: [Atom, Bindings]): void => {
    if (sink !== undefined) sink(pair);
    else done.push(pair);
  };
  // Worklist as an explicit stack. Popping the end is O(1); the previous `queue.slice(1)` plus
  // `[...more, ...queue]` rebuilt the whole array on every step (O(n) per step, O(n^2) over a run, and it
  // dominated interpretLoopG's self-time with array-growth churn on the build-heavy benchmarks). Items are
  // pushed in reverse so they still pop in the original front-to-back DFS order, so the result order and
  // the oracle stay byte-identical.
  let stack: Item[] = [];
  let source: Iterator<Item> | undefined;
  const suspended: Array<{ stack: Item[]; source: Iterator<Item> | undefined }> = [];
  let cur = st;
  const beginSource = (src: ItemSource, suspend: boolean): void => {
    if (suspend) suspended.push({ stack, source });
    stack = [];
    source = src.foldItems()[Symbol.iterator]();
    cur = src.endState;
  };
  if (isItemSource(work)) {
    beginSource(work, false);
  } else {
    for (let i = work.length - 1; i >= 0; i--) stack.push(work[i]!);
  }
  const pullSourceItem = (): boolean => {
    while (stack.length === 0 && source !== undefined) {
      const next = source.next();
      if (next.done === true) {
        const prev = suspended.pop();
        if (prev === undefined) {
          source = undefined;
        } else {
          stack = prev.stack;
          source = prev.source;
        }
        continue;
      }
      if (isFinal(next.value)) emit(finalPair(env, next.value));
      else stack.push(next.value);
    }
    return stack.length > 0;
  };
  let f = fuel;
  while (pullSourceItem()) {
    if (f <= 0) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const it = stack[i]!;
        emit(isFinal(it) ? finalPair(env, it) : exhaustedPair(env, it));
      }
      return [done, cur];
    }
    const it = stack.pop()!;
    // `(pragma! max-stack-depth N)` bounds how deep the interpreter stack may grow before a branch is cut
    // back to a StackOverflow atom (Hyperon's pragma; bounds memory, not steps). 0 (the default) disables
    // the check, so this costs nothing unless a program opts in. A finished branch is already a result, so
    // it is returned as-is rather than turned into an error.
    if (cur.world.maxStackDepth > 0) {
      let depth = 0;
      for (let p = it.stack; p !== null; p = p.tail) depth++;
      if (depth >= cur.world.maxStackDepth) {
        emit(isFinal(it) ? finalPair(env, it) : exhaustedPair(env, it));
        continue;
      }
    }
    const [results, st2] = yield* interpretStack1G(env, f - 1, cur, it);
    cur = st2;
    f -= 1;
    if (isItemSource(results)) {
      beginSource(results, true);
      continue;
    }
    // Finals stream out immediately in result order (inlined to keep the no-sink case a direct push, no
    // per-result closure). Non-finals collect in order, then push reversed so they pop in that same order.
    const more: Item[] = [];
    for (const r of results) {
      if (isFinal(r)) {
        if (sink !== undefined) sink(finalPair(env, r));
        else done.push(finalPair(env, r));
      } else more.push(r);
    }
    for (let i = more.length - 1; i >= 0; i--) stack.push(more[i]!);
  }
  return [done, cur];
}

// Hyperon's "already evaluated" optimization (spec `metta`: "elif metatype == Expression and <atom is
// evaluated already>: return atom"). A ground expression that has already reduced to itself is a value;
// re-evaluating it would re-walk the whole term, so a growing data term (Peano `(S (S ... Z))` is the worst
// case) costs O(n) per step and O(n^2) overall. We mark such terms here and skip them on the next visit.
// Only GROUND terms are cached: a term with variables can reduce differently under a different binding, so
// its irreducibility is not stable. The cache is per-env and reset when rules change, because hash-consing
// can make a later reducible term share the same object as an earlier irreducible one.

// Reduce each (atom, bindings) of `pairs` to normal form and flatten the results. `onTerminal` decides per
// pair whether it is already final (return the result atoms to keep as-is) or needs another mettaEval pass
// (return undefined to recurse). This is the shared tail of the three non-operator metta-call cases below
// (expression-headed rule hit, the interpret-tuple fallback, and a bare symbol); only the terminal test
// differs between them.
function* reduceChildrenG(
  env: MinEnv,
  fuel: number,
  st: St,
  pairs: Array<[Atom, Bindings]>,
  onTerminal: (p: [Atom, Bindings]) => Array<[Atom, Bindings]> | undefined,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const out: Array<[Atom, Bindings]> = [];
  let cur = st;
  for (const p of pairs) {
    const term = onTerminal(p);
    if (term !== undefined) {
      out.push(...term);
    } else {
      const [more, st3] = yield* mettaEvalG(env, fuel - 1, cur, p[1], p[0]);
      cur = st3;
      out.push(...more);
    }
  }
  return [out, cur];
}

// ---------- runtime-rule tabling (fibadd: a `(= (fib $N) ...)` added at runtime via add-atom) ----------
// Static tabling keys a pure ground call by its printed form in the shared `env.table`, which is safe
// because static rules never change. A RUNTIME rule lives in the per-world copy-on-write `selfRules`, so the
// same printed call could mean different things in two worlds (a transaction that redefines it, then rolls
// back). To table such calls without a per-world table, the key is suffixed with a VERSION of the functor's
// rule-set: `selfRules` replaces the array on every change, so a different rule-set is a different array and
// gets a different version. A stale entry (rules since changed, or another world's rules) then simply has a
// different key and is never hit. env.table stays shared, correctness holds, and the cost is only some
// dead entries lingering.
let runtimeRuleVersionCounter = 0;
const runtimeRuleVersions = new WeakMap<object, number>();
function rulesVersion(rules: object | undefined): number {
  if (rules === undefined) return 0;
  let v = runtimeRuleVersions.get(rules);
  if (v === undefined) {
    v = ++runtimeRuleVersionCounter;
    runtimeRuleVersions.set(rules, v);
  }
  return v;
}
function collectHeadSyms(a: Atom, out: Set<string>): void {
  if (a.kind === "expr" && a.items.length > 0) {
    if (a.items[0]!.kind === "sym") out.add((a.items[0] as { name: string }).name);
    for (const it of a.items) collectHeadSyms(it, out);
  }
}
// A functor with runtime rules is tabling-safe iff its rules (static + this world's runtime) reference only
// pure ops, transitively. Mirrors analyzePurity but over the combined rule set; cached by functor + version
// so it is computed once per rule-set, not per call. A self/mutual-recursion cycle is treated as pure (the
// fixpoint), since a cycle adds no impure op.
const runtimePureCache = new Map<string, boolean>();
function runtimeFunctorPure(env: MinEnv, w: World, op: string): boolean {
  // A variable-headed rule (e.g. the `|->` lambda applicator) can rewrite ANY call, so its mere presence
  // makes tabling unsound. analyzePurity disables all static tabling for the same reason. Mirror that.
  if (env.varRules.some(([lhs]) => isVariableHeaded(lhs)) || w.selfVarRules.length > 0)
    return false;
  const ck = op + "@" + rulesVersion(w.selfRules.get(op));
  const cached = runtimePureCache.get(ck);
  if (cached !== undefined) return cached;
  const visit = (f: string, seen: Set<string>): boolean => {
    if (seen.has(f)) return true;
    seen.add(f);
    const rules = [...(env.ruleIndex.get(f) ?? []), ...(w.selfRules.get(f) ?? [])];
    for (const [, rhs] of rules) {
      const heads = new Set<string>();
      collectHeadSyms(rhs, heads);
      for (const h of heads) {
        if (IMPURE_OPS.has(h)) return false;
        if ((env.ruleIndex.has(h) || w.selfRules.has(h)) && !visit(h, seen)) return false;
      }
    }
    return true;
  };
  const pure = visit(op, new Set());
  runtimePureCache.set(ck, pure);
  return pure;
}

// Counting `(length (collapse (match $space $pat $template)))` cares only about how many solutions the
// match has, not their values: matchOp emits exactly one final item per solution (instantiate(m, template))
// and the count fusion never inspects it. So for counting, swap the template for a ground unit. Then
// instantiate(m, unit) returns the unit directly (ground short-circuit) instead of building a result tree
// per solution, which is pure garbage in the emit-bound profile.
const COUNT_UNIT = sym("u");
function countOnlyMatch(z: Atom): Atom {
  return z.kind === "expr" && z.items.length === 4 && opOf(z) === "match"
    ? expr([z.items[0]!, z.items[1]!, z.items[2]!, COUNT_UNIT])
    : z;
}

const COLLAPSE_ROUTE_ENV = "METTA_COLLAPSE_ROUTE";
const DONE_UNIT = sym("done");

const collapseRouteEnabled = (): boolean => process.env[COLLAPSE_ROUTE_ENV] !== "0";
// Disables the all-distinct-variable count-aggregate (the head/arity tally), falling back to the streaming
// count. Off switch for A/B differentials only; the tally is byte-identical, so this stays on by default.
const countAggregateEnabled = (): boolean => process.env.METTA_COUNT_AGGREGATE !== "0";
// Void-context build: when a routed `(length (collapse (FN a)))` build ends in a dead binding to a compiled
// impure function (matespace's `($g (rewriteK Z K))`, whose tree result is never read), run that call in
// discard mode so its add-atom side effects happen without allocating the result tree (matespace K=19 drops
// ~25%). The binding is kept and only its value is the sentinel, so the gensym counter is byte-identical, not
// just alpha. Off switch (METTA_VOID_BUILD=0) for the differential.
const voidBuildEnabled = (): boolean => process.env.METTA_VOID_BUILD !== "0";
// Conjunctive collapse-count via the worst-case-optimal join fold (matchConjCount). A multi-goal
// `(length/size-atom (collapse (match &self (, ...) tmpl)))` folds the same wcoJoin the default result path
// (matchConjJoin) already runs, counting each solution instead of allocating its answer atom. The count is
// order- and name-independent, so the fold is byte-identical to materializing-then-counting and needs no
// experimental gate; it skips ~360k atom allocations on permutations (2.8s -> 0.48s). Off switch
// (METTA_CONJ_COUNT=0) drops back to the materializing count for the differential.
const conjCountEnabled = (): boolean => process.env.METTA_CONJ_COUNT !== "0";

interface TailMatchBuild {
  readonly buildExpr: Atom;
  readonly tailMatch: ExprAtom;
  readonly boundVars: ReadonlySet<string>;
}

interface CollapseRoute {
  readonly buildExpr: Atom;
  readonly tailMatch: ExprAtom;
  readonly st: St;
  readonly bnd: Bindings;
  /** A dead build binding to a compiled impure function, split off to run in discard mode after `buildExpr`. */
  readonly voidCall?: { readonly op: string; readonly args: readonly Atom[] } | undefined;
}

// If `buildExpr` is `(let (...) ... done)` / `(let* (pairs) done)` whose last binding is a call to a compiled
// impure function with ground arguments, return the build with that binding removed plus the call to run in
// discard mode. The binding is dead (its value is never read: the route already checked the tail match uses
// no let-bound variable, and being last it feeds no later binding), so running it for effects only is
// equivalent. Only a top-level let/let* with the call as its last, ground-argument binding qualifies; any
// other shape returns undefined and the normal build runs.
function splitVoidBuild(
  buildExpr: Atom,
  env: MinEnv,
): { readonly prefix: Atom; readonly op: string; readonly args: readonly Atom[] } | undefined {
  if (buildExpr.kind !== "expr") return undefined;
  const voidable = (rhs: Atom): { op: string; args: readonly Atom[] } | undefined => {
    if (rhs.kind !== "expr" || rhs.items.length === 0 || rhs.items[0]!.kind !== "sym")
      return undefined;
    const op = rhs.items[0]!.name;
    const args = rhs.items.slice(1);
    if (env.compiled?.get(op)?.kind !== "imperative" || args.some((a) => !a.ground))
      return undefined;
    return { op, args };
  };
  // Keep the binding in the prefix but replace its evaluated value with the sentinel, rather than dropping it:
  // the `let` machinery (and its gensym) then runs exactly as before, the discarded result value is the only
  // thing not built, and the call's own gensym is restored by running it separately in discard mode. So the
  // build's fresh-variable counter is byte-identical, not just alpha-equivalent.
  const head = opOf(buildExpr);
  if (head === "let" && buildExpr.items.length === 4 && atomEq(buildExpr.items[3]!, DONE_UNIT)) {
    const v = voidable(buildExpr.items[2]!);
    if (v === undefined) return undefined;
    return {
      prefix: expr([buildExpr.items[0]!, buildExpr.items[1]!, DONE_UNIT, DONE_UNIT]),
      op: v.op,
      args: v.args,
    };
  }
  if (
    head === "let*" &&
    buildExpr.items.length === 3 &&
    buildExpr.items[1]!.kind === "expr" &&
    atomEq(buildExpr.items[2]!, DONE_UNIT)
  ) {
    const pairs = buildExpr.items[1]!.items;
    const lastPair = pairs[pairs.length - 1];
    if (lastPair === undefined || lastPair.kind !== "expr" || lastPair.items.length !== 2)
      return undefined;
    const v = voidable(lastPair.items[1]!);
    if (v === undefined) return undefined;
    const newPairs = [...pairs.slice(0, -1), expr([lastPair.items[0]!, DONE_UNIT])];
    return {
      prefix: expr([buildExpr.items[0]!, expr(newPairs), DONE_UNIT]),
      op: v.op,
      args: v.args,
    };
  }
  return undefined;
}

function addAtomVars(into: Set<string>, atom: Atom): void {
  for (const name of atomVars(atom)) into.add(name);
}

function hasAnyAtomVar(vars: ReadonlySet<string>, atoms: readonly Atom[]): boolean {
  for (const atom of atoms) for (const name of atomVars(atom)) if (vars.has(name)) return true;
  return false;
}

function tailMatchBuild(body: Atom): TailMatchBuild | undefined {
  if (body.kind !== "expr") return undefined;
  const op = opOf(body);
  if (op === "match" && body.items.length === 4)
    return { buildExpr: DONE_UNIT, tailMatch: body, boundVars: new Set() };
  if (op === "let" && body.items.length === 4) {
    const inner = tailMatchBuild(body.items[3]!);
    if (inner === undefined) return undefined;
    const boundVars = new Set(inner.boundVars);
    addAtomVars(boundVars, body.items[1]!);
    return {
      buildExpr: expr([body.items[0]!, body.items[1]!, body.items[2]!, inner.buildExpr]),
      tailMatch: inner.tailMatch,
      boundVars,
    };
  }
  if (op === "let*" && body.items.length === 3 && body.items[1]!.kind === "expr") {
    const inner = tailMatchBuild(body.items[2]!);
    if (inner === undefined) return undefined;
    const boundVars = new Set(inner.boundVars);
    for (const pair of body.items[1]!.items) {
      if (pair.kind !== "expr" || pair.items.length !== 2) return undefined;
      addAtomVars(boundVars, pair.items[0]!);
    }
    return {
      buildExpr: expr([body.items[0]!, body.items[1]!, inner.buildExpr]),
      tailMatch: inner.tailMatch,
      boundVars,
    };
  }
  return undefined;
}

function prepareCollapseRoute(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  call: Atom,
): CollapseRoute | undefined {
  if (
    !collapseRouteEnabled() ||
    size(bnd) !== 0 ||
    call.kind !== "expr" ||
    !call.ground ||
    call.items.length === 0 ||
    call.items[0]!.kind !== "sym" ||
    env.varRulesVar.length !== 0 ||
    st.world.selfVarRules.length !== 0
  )
    return undefined;
  if (isDefinedHead(env, st.world, DONE_UNIT.name)) return undefined;
  const op = call.items[0]!.name;
  if (st.world.selfRules.has(op) || env.pureFunctors?.has(op) === true) return undefined;
  const rules = env.ruleIndex.get(op);
  if (rules === undefined || rules.length !== 1) return undefined;
  const args = call.items.slice(1);
  if (args.some((arg) => !isNormalForm(env, st.world, arg))) return undefined;
  if (typeMismatch(env, st.world, op, args, env.sigs.get(op)) !== undefined) return undefined;

  const [lhs, rhs] = rules[0]!;
  if (lhs.kind !== "expr" || lhs.items.length !== call.items.length || !canMatchShallow(lhs, call))
    return undefined;

  const suffix = "#" + st.counter;
  const matches: Bindings[] = [];
  for (const mb of matchAtomsScoped(lhs, call, suffix))
    for (const m of merge(bnd, mb)) if (!hasLoop(m)) matches.push(m);
  if (matches.length !== 1) return undefined;

  const body = inst(env, matches[0]!, rhs, suffix);
  const tail = tailMatchBuild(body);
  if (tail === undefined) return undefined;
  if (hasAnyAtomVar(tail.boundVars, tail.tailMatch.items.slice(1))) return undefined;
  let buildExpr = tail.buildExpr;
  let voidCall: { op: string; args: readonly Atom[] } | undefined;
  if (voidBuildEnabled()) {
    const split = splitVoidBuild(buildExpr, env);
    if (split !== undefined) {
      buildExpr = split.prefix;
      voidCall = { op: split.op, args: split.args };
    }
  }
  return {
    buildExpr,
    tailMatch: tail.tailMatch,
    st: { counter: st.counter + 1, world: st.world },
    bnd: matches[0]!,
    voidCall,
  };
}

// Count-aggregate (the FAQ / factorized-database COUNT, mork-uni-join's `Count` semiring): a
// `(match space (head $v1..$vk) tmpl)` whose pattern is all-distinct bare variables unifies with exactly the
// space atoms of that head and arity, so the number of solutions is a tally, not an enumeration. Count the
// head/arity-matching candidates in one pass over the matcher's own candidate source, with no per-candidate
// freshen, unify, trail, or collapse materialisation. The gensym still advances once per candidate the
// streaming match would *iterate* (every head-matching atom the source yields, including ones a different
// arity rules out), so `counter += iterated` stays byte-identical to the unfused path; `count` is the
// arity-matching subset (a bare-variable atom in the space unifies any arity). Returns undefined (fall back)
// unless the resolved pattern is a single all-distinct-variable expression.
function tryCountAggregate(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  match: ExprAtom,
): { count: number; iterated: number } | undefined {
  if (match.items.length < 3) return undefined;
  const { getCandidates, patterns } = matchSetup(env, st, match.items[1]!, match.items[2]!, bnd);
  if (patterns.length !== 1) return undefined;
  const pat = inst(env, bnd, patterns[0]!);
  if (pat.kind !== "expr" || pat.items.length === 0 || pat.items[0]!.kind !== "sym")
    return undefined;
  const seen = new Set<string>();
  for (let i = 1; i < pat.items.length; i++) {
    const a = pat.items[i]!;
    if (a.kind !== "var" || seen.has(a.name)) return undefined;
    seen.add(a.name);
  }
  // A ground (nullary) pattern routes through the exact-membership index, which advances the counter
  // differently from a per-candidate scan, so require at least one variable argument: then the streaming
  // match is the candidate scan whose count and counter this tally reproduces.
  if (seen.size === 0) return undefined;
  const k = headKey(pat)!; // defined: the head is a symbol (guarded above)
  const arity = pat.items.length;
  // A candidate unifies with the all-distinct-variable, symbol-headed pattern `(k $v..)` iff it is a bare
  // variable, or an expr of the same arity whose head is the same symbol `k` or a variable. A same-arity
  // candidate whose head is a different symbol, a grounded value, or a nested expr does NOT unify, though it
  // is still yielded as a candidate (so it advances `iterated`/the counter). Counting by arity alone
  // over-counts those: a named space yields the whole space unfiltered, and `&self` admits headKey-undefined
  // (grounded- or expr-headed) atoms.
  const unifies = (a: Atom): boolean =>
    a.kind === "var" ||
    (a.kind === "expr" &&
      a.items.length === arity &&
      (headKey(a) === k || a.items[0]!.kind === "var"));
  const w = st.world;
  // Direct tally over the runtime &self store, skipping the materialisation (and, for the flat space, the
  // decoding) of a ~1.5M-element candidate array, when the candidate set IS exactly that store: a &self match
  // with no state to resolve and no static or variable-headed facts of this head, so `matchCandidates` would
  // yield only the runtime atoms whose head is `k` (or which are variable-headed). Counting is
  // order-independent, so the newest-first log walk is fine. Same head filter as `runtimeCandidates`, so
  // `iterated` (and thus the counter) is identical. The flat store tallies columnar-ly (countHeadArity
  // mirrors `unifies` exactly); at most one of the two stores is non-empty, and summing keeps the tally
  // right either way.
  const sn = spaceName(w, inst(env, bnd, match.items[1]!));
  if (
    (sn === undefined || sn === "&self") &&
    w.store.size === 0 &&
    env.varHeadedFacts.length === 0 &&
    (env.factIndex.get(k)?.length ?? 0) === 0
  ) {
    let count = 0;
    let iterated = 0;
    for (let p = w.selfExtra; p !== null; p = p.prev) {
      const akk = headKey(p.atom);
      if (akk === undefined || akk === k) {
        iterated += 1;
        if (unifies(p.atom)) count += 1;
      }
    }
    if (w.flatSelfExtra !== undefined) {
      const flat = w.flatSelfExtra.countHeadArity(k, arity);
      count += flat.count;
      iterated += flat.iterated;
    }
    return { count, iterated };
  }
  const source = getCandidates(pat);
  let count = 0;
  let iterated = 0;
  for (const cand of source) {
    iterated += 1;
    if (unifies(cand)) count += 1;
  }
  iterated += candidateCounterPadding(source);
  return { count, iterated };
}

function* countTailMatchG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  match: ExprAtom,
): Gen<{ count: number; state: St }> {
  const agg = countAggregateEnabled() ? tryCountAggregate(env, st, bnd, match) : undefined;
  if (agg !== undefined)
    return { count: agg.count, state: { counter: st.counter + agg.iterated, world: st.world } };
  {
    const { getCandidates, patterns } = matchSetup(env, st, match.items[1]!, match.items[2]!, bnd);
    // The multi-goal conjunctive count folds the WCO join by default (order- and name-independent, so
    // byte-identical to the materializing count it replaces). The single-pattern trail count stays behind
    // experimental.trail: tryCountAggregate above already covers the common single-pattern tally, and
    // matchCountTrail is the general experimental path.
    const tc =
      patterns.length >= 2 && conjCountEnabled()
        ? matchConjCount(env, getCandidates, patterns, st, bnd)
        : env.useTrail === true
          ? matchCountTrail(getCandidates, patterns, st, bnd)
          : undefined;
    if (tc !== undefined)
      return { count: tc.count, state: { counter: tc.counter, world: st.world } };
  }
  let count = 0;
  const [, stC] = yield* interpretLoopG(
    env,
    fuel,
    st,
    [
      {
        stack: atomToStack(expr([sym("metta"), countOnlyMatch(match), UNDEF, sym("&self")]), null),
        bnd,
      },
    ],
    () => {
      count++;
    },
  );
  return { count, state: stC };
}

function* tryCollapseRouteG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  call: Atom,
): Gen<{ count: number; state: St } | undefined> {
  const route = prepareCollapseRoute(env, st, bnd, call);
  if (route === undefined) return undefined;
  // Drive the build prefix through the same type-directed `metta` evaluation the unfused path uses for the
  // whole call, so the add-atom side effects run and the body reduces to the `done` sentinel. A bare
  // `atomToStack(buildExpr)` would treat the let* as data and return it unreduced.
  const [built, stAfterPrefix] = yield* interpretLoopG(env, fuel, route.st, [
    {
      stack: atomToStack(expr([sym("metta"), route.buildExpr, UNDEF, sym("&self")]), null),
      bnd: route.bnd,
    },
  ]);
  if (built.length !== 1 || !atomEq(built[0]![0], DONE_UNIT)) return undefined;
  let stAfterBuild = stAfterPrefix;
  if (route.voidCall !== undefined) {
    // Run the dead build call in discard mode: its add-atom side effects happen, but the discarded result
    // tree is never allocated.
    const cr = runCompiled(
      env,
      route.voidCall.op,
      route.voidCall.args,
      stAfterPrefix,
      COMPILED_IMPURE_OPS,
      true,
    );
    if (cr === undefined || cr.state === undefined) return undefined; // did not compile this run; fall back
    stAfterBuild = cr.state;
  }
  return yield* countTailMatchG(env, fuel, stAfterBuild, built[0]![1], route.tailMatch);
}

function canStreamStdlibCase(env: MinEnv, w: World): boolean {
  return (
    STREAM_CASE &&
    (env.ruleIndex.get("case")?.length ?? 0) === 1 &&
    env.varRulesVar.length === 0 &&
    !w.selfRules.has("case") &&
    w.selfVarRules.length === 0
  );
}

function streamCaseSource(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  matchExpr: ExprAtom,
  cases: Atom,
): ItemSource | undefined {
  if (cases.kind !== "expr" || cases.items.length !== 1) return undefined;
  const onlyCase = cases.items[0]!;
  if (onlyCase.kind !== "expr" || onlyCase.items.length !== 2 || onlyCase.items[0]!.kind !== "var")
    return undefined;
  const casePattern = inst(env, bnd, onlyCase.items[0]!);
  const caseTemplate = inst(env, bnd, onlyCase.items[1]!);
  const caseRuleEnd = { counter: st.counter + 1, world: st.world };
  const plan = matchPlan(
    env,
    caseRuleEnd,
    matchExpr.items[1]!,
    matchExpr.items[2]!,
    matchExpr.items[3]!,
    bnd,
  );
  if (!plan.valuesAreNormal) return undefined;
  let valueCount = 0;
  const valueIter = plan.foldValues()[Symbol.iterator]();
  for (let next = valueIter.next(); !next.done; next = valueIter.next()) valueCount += 1;
  const switchCount = valueCount === 0 ? 1 : valueCount;
  const endState = {
    counter: plan.endState.counter + 2 * switchCount,
    world: plan.endState.world,
  };
  const bodyFor = (value: Atom): Atom => {
    for (const mb of matchAtoms(value, casePattern))
      for (const m of merge(bnd, mb)) if (!hasLoop(m)) return inst(env, m, caseTemplate);
    return sym("Empty");
  };
  return {
    endState,
    *foldItems(): Iterable<Item> {
      let any = false;
      for (const value of plan.foldValues()) {
        any = true;
        yield {
          stack: atomToStack(expr([sym("metta"), bodyFor(value), UNDEF, sym("&self")]), null),
          bnd,
        };
      }
      if (!any)
        yield {
          stack: atomToStack(
            expr([sym("metta"), bodyFor(sym("Empty")), UNDEF, sym("&self")]),
            null,
          ),
          bnd,
        };
    },
  };
}

// ---------- mettaEval (type-directed metta-call loop) ----------
function* mettaEvalG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
): Gen<[Array<[Atom, Bindings]>, St]> {
  if (fuel <= 0)
    return [[[makeExpr(env, [sym("Error"), inst(env, bnd, a), sym("StackOverflow")]), bnd]], st];
  const w = inst(env, bnd, a);
  if (w.kind === "expr" && w.ground && env.evaluatedAtoms.has(w)) return [[[w, bnd]], st];
  // Constructor / normal-form short-circuit (Curry's constructor/defined partition; Hanus' incremental
  // normalization). A non-ground operator-headed term whose head is a constructor and whose arguments are all
  // already in normal form cannot reduce, so it is its own value: skip the re-instantiation, argument
  // re-evaluation, and reduce-probe the type-directed loop would otherwise repeat each time a data subterm (a
  // proof/type term in a backward chainer) is revisited. Ground terms take the evaluated-mark path above.
  // Enabled only when no catch-all (`($x …)`) equation exists, so `candidatesW` for every constructor-headed
  // node is empty: re-evaluating the term advances the fresh-variable counter by zero and mutates no state, so
  // returning it directly is byte-identical to the full path. (`METTA_CTOR_SC=0` disables it for A/B.)
  if (
    CTOR_SC &&
    w.kind === "expr" &&
    !w.ground &&
    w.items.length > 0 &&
    env.varRulesVar.length === 0 &&
    st.world.selfVarRules.length === 0 &&
    isNormalForm(env, st.world, w)
  )
    return [[[w, bnd]], st];
  const isErr = (x: Atom): boolean =>
    x.kind === "expr" &&
    x.items.length >= 1 &&
    x.items[0]!.kind === "sym" &&
    (x.items[0] as { name: string }).name === "Error";

  if (w.kind === "expr" && w.items.length > 0 && w.items[0]!.kind === "sym") {
    // Tail-call trampoline. A ground operator-headed call usually reduces in a linear chain (every
    // tail-recursive MeTTa function: count, iterate, a Peano walk). Reducing each step by recursing into
    // mettaEvalG grows the native JS stack a few frames per step, so a chain a few thousand deep overflows.
    // Here the single-continuation ground case loops instead: `la`/`lbnd`/`lst`/`lw` carry the current
    // atom, bindings, state, and instantiated form across iterations, and `pendingKeys` remembers the
    // chain's tabling keys so the whole chain still memoises when it terminates (flushReturn writes them).
    let la = a;
    let lbnd = bnd;
    let lst = st;
    let lw = w;
    const pendingKeys: string[] = [];
    const flushReturn = (res: Array<[Atom, Bindings]>, stR: St): [Array<[Atom, Bindings]>, St] => {
      if (pendingKeys.length > 0 && env.table !== undefined && res.every((p) => p[0].ground)) {
        const prod = res.map((p) => p[0]);
        for (const k of pendingKeys) env.table.set(k, prod);
      }
      return [res, stR];
    };
    reduceTrampoline: for (;;) {
      const op = (lw.items[0] as { name: string }).name;
      const args = lw.items.slice(1);
      if (op === "collapse" && args.length === 1) {
        const match = matchInsideOnce(args[0]!);
        if (match !== undefined) {
          const namedMatch = tryFastNamedOnceMatch(env, lst, match, lbnd);
          if (namedMatch !== undefined) {
            const items = namedMatch.value === undefined ? [] : [namedMatch.value];
            return flushReturn([[expr(items), lbnd]], namedMatch.state);
          }
        }
      }
      if (op === "if" && args.length === 3) {
        const added = tryFastNamedAddIfAbsent(env, lst, lw, lbnd);
        if (added !== undefined)
          return flushReturn(added.added ? [[emptyExpr, lbnd]] : [], added.state);
      }
      if (op === "add-unique-or-fail" && args.length === 2) {
        const added = tryFastAddUniqueOrFailCall(env, lst, lw, lbnd);
        if (added !== undefined)
          return flushReturn(added.added ? [[emptyExpr, lbnd]] : [], added.state);
      }
      // Streaming `(length (collapse Z))` / `(size-atom (collapse Z))`: count Z's results with a folding sink
      // instead of materialising the collapsed tuple, walking it, and (via the array `interpretLoopG` would
      // otherwise build) holding every result at once. The emit-bound benchmarks are exactly this shape.
      // Byte-identical to the unfused path: `collapse` runs `collapse-bind (metta Z %Undefined%
      // (context-space))`, `(context-space)` is always `&self`, and `collapse-extract` is 1-to-1, so the count
      // equals that interpretation's result count. Gated to the grounded op (a user `length`/`size-atom` rule
      // disables it).
      if (
        (op === "length" || op === "size-atom") &&
        args.length === 1 &&
        args[0]!.kind === "expr" &&
        opOf(args[0]!) === "collapse" &&
        args[0]!.items.length === 2 &&
        !env.ruleIndex.has(op) &&
        !lst.world.selfRules.has(op)
      ) {
        // Trail fast path: `(length (collapse (match space pat _)))` counts the match's solutions with no
        // per-solution allocation (matchCountTrail). `countOnlyMatch` would neutralize the template to a
        // ground unit, so the result count equals the solution count; we count solutions directly. Falls
        // through to the streaming interpretation when the trail declines or the collapsed atom is not a
        // bare `match` (e.g. peano's `(demo-peano ...)`).
        const z = args[0]!.items[1]!;
        if (z.kind === "expr" && opOf(z) === "match" && z.items.length === 4) {
          const counted = yield* countTailMatchG(env, fuel, lst, lbnd, z);
          return flushReturn([[gint(BigInt(counted.count)), lbnd]], counted.state);
        }
        const routed = yield* tryCollapseRouteG(env, fuel, lst, lbnd, z);
        if (routed !== undefined)
          return flushReturn([[gint(BigInt(routed.count)), lbnd]], routed.state);
        let count = 0;
        const [, stC] = yield* interpretLoopG(
          env,
          fuel,
          lst,
          [
            {
              stack: atomToStack(
                expr([sym("metta"), countOnlyMatch(args[0]!.items[1]!), UNDEF, sym("&self")]),
                null,
              ),
              bnd: lbnd,
            },
          ],
          () => {
            count++;
          },
        );
        return flushReturn([[gint(BigInt(count)), lbnd]], stC);
      }
      // Hyperon `interpret_expression`/`check_if_function_type_is_applicable` (interpreter.rs): when the
      // operator's only types are function types and none applies because the argument count differs from
      // the parameter count, the call reduces to `(Error <call> IncorrectNumberOfArguments)`. Confirmed by
      // Hyperon's own tests: `(foo b c)` and `(add-reducts k1)` both yield it. The reference LeaTTa binary
      // lacks this check (it leaves such calls unreduced); Hyperon is the authority here. A signature
      // `[param1 ... paramN, return]` has `length - 1` parameters. Skip when the operator also has a
      // non-function (tuple) type, matching Hyperon's `has_tuple_type` fallback.
      const opSig = env.sigs.get(op);
      if (opSig !== undefined && opSig.length >= 1 && args.length !== opSig.length - 1) {
        const hasTupleType = (env.types.get(op) ?? []).some((t) => opOf(t) !== "->");
        // With opt-in currying on, an under-applied typed op is curried (handled after argument
        // evaluation, below) rather than reported as an arity error.
        const underAppliedCurry = env.curry && args.length >= 1 && args.length < opSig.length - 1;
        if (!hasTupleType && !underAppliedCurry)
          return flushReturn(
            [
              [
                expr([sym("Error"), expr([sym(op), ...args]), sym("IncorrectNumberOfArguments")]),
                lbnd,
              ],
            ],
            lst,
          );
      }
      const mm = typeMismatch(env, lst.world, op, args, opSig);
      if (mm !== undefined) {
        const [pos, expected, actual] = mm;
        return flushReturn(
          [
            [
              expr([
                sym("Error"),
                expr([sym(op), ...args]),
                expr([sym("BadArgType"), gint(pos), expected, actual]),
              ]),
              lbnd,
            ],
          ],
          lst,
        );
      }
      if (
        op === "case" &&
        args.length === 2 &&
        args[0]!.kind === "expr" &&
        opOf(args[0]!) === "match" &&
        args[0]!.items.length === 4 &&
        args[1]!.kind === "expr" &&
        canStreamStdlibCase(env, lst.world)
      ) {
        const source = streamCaseSource(env, lst, lbnd, args[0]! as ExprAtom, args[1]!);
        if (source !== undefined) {
          const [selected, stCase] = yield* interpretLoopG(env, fuel, lst, source);
          const [pairs, stReduced] = yield* reduceChildrenG(
            env,
            fuel,
            stCase,
            selected,
            () => undefined,
          );
          return flushReturn(pairs, stReduced);
        }
      }
      const queryVars = queryVarsOf(args);
      // Reuse the signature already fetched for the arity/type checks above (one Map lookup per reduction
      // instead of three: this drove `FindOrderedHashMapEntry` in profiling) across argMask + the
      // per-result returnsAtom check in the reduce loop below.
      const sig = opSig;
      const opReturnsAtom =
        sig !== undefined && sig.length > 0 && atomEq(sig[sig.length - 1]!, sym("Atom"));
      // Concurrency primitives drive their own branches; their arguments stay unevaluated regardless of
      // arity, so a `par`/`race`/`with-mutex` branch is evaluated concurrently, not eagerly in sequence.
      const mask = LAZY_ARGS_OPS.has(op) ? args.map(() => false) : argMask(sig, args.length);
      // (1) type-directed argument evaluation, binding-threaded
      let partials: Array<[Atom[], Bindings]> = [[[], []]];
      let cur = lst;
      for (let i = 0; i < args.length; i++) {
        const ae = args[i]!;
        const evalThis = mask[i]!;
        const nextParts: Array<[Atom[], Bindings]> = [];
        for (const [accAtoms, accB] of partials) {
          if (evalThis) {
            const [ps, st2] = yield* mettaEvalG(env, fuel - 1, cur, accB, ae);
            cur = st2;
            for (const p of ps) {
              nextParts.push([[...accAtoms, p[0]], mergeRestrict(env, queryVars, accB, p[1])]);
            }
          } else {
            nextParts.push([[...accAtoms, inst(env, accB, ae)], accB]);
          }
        }
        partials = nextParts;
      }
      // (2) reduce each combination
      const out: Array<[Atom, Bindings]> = [];
      let cur2 = cur;
      const tabling = env.table !== undefined && queryVars.length === 0;
      const staticPure = env.pureFunctors?.has(op) ?? false;
      for (const [partAtoms, partB] of partials) {
        // error propagation: a type-directed-evaluated arg reduced to an error and changed
        let errFound: Atom | undefined;
        for (let i = 0; i < partAtoms.length; i++) {
          if (isErr(partAtoms[i]!) && !atomEq(partAtoms[i]!, args[i]!)) {
            errFound = partAtoms[i]!;
            break;
          }
        }
        if (errFound !== undefined) {
          out.push([errFound, partB]);
          continue;
        }
        // Reuse `lw` when every evaluated argument came back as the very object that went in, instead of
        // rebuilding an equal copy. The no-reduce exits below mark and return `wApp`, so preserving the
        // input's identity is what lets the evaluated-mark short-circuit hit on a later revisit of this
        // object. The plain log stores the rebuilt copy (so either object works there), but the flat
        // store re-decodes one canonical object per term: marking a fresh copy per visit while the
        // canonical object stays unmarked re-descended peano's whole S^n spine every round, O(K^3).
        const wApp = partAtoms.every((p, i) => p === args[i])
          ? lw
          : makeExpr(env, [sym(op), ...partAtoms]);
        // opt-in currying: a known function applied to fewer arguments than its arity becomes a
        // `(partial fn (args))` closure (PeTTa's build_call_or_partial), checked before evaluation so a
        // grounded op is not called with the wrong arity. Requires at least one argument, so a nullary
        // thunk is still evaluated rather than curried.
        if (env.curry && partAtoms.length >= 1) {
          const ar = functionArity(env, cur2.world, op);
          if (ar !== undefined && partAtoms.length < ar) {
            out.push([makeExpr(env, [sym("partial"), sym(op), makeExpr(env, partAtoms)]), partB]);
            continue;
          }
        }
        const fastTilePuzzle = tryFastTilePuzzleBfsAll(env, cur2, wApp);
        if (fastTilePuzzle !== undefined) {
          cur2 = fastTilePuzzle.state;
          for (const [value, rb] of fastTilePuzzle.results)
            out.push([value, mergeRestrict(env, queryVars, partB, rb)]);
          continue;
        }
        const fastQueue = tryFastQueueCall(env, cur2, wApp);
        if (fastQueue !== undefined) {
          cur2 = fastQueue.state;
          for (const [value, rb] of fastQueue.results)
            out.push([value, mergeRestrict(env, queryVars, partB, rb)]);
          continue;
        }
        // compiled fast path: deterministic static functions, including the state-threaded impure subset.
        if (
          env.compiled !== undefined &&
          !cur2.world.selfRules.has(op) &&
          cur2.world.selfVarRules.length === 0
        ) {
          const cr = runCompiled(env, op, partAtoms, cur2, COMPILED_IMPURE_OPS);
          if (cr !== undefined) {
            // A compiled holder returns the one-step rule-application results (the instantiated RHSs) plus
            // the counter advance the candidate scan would have cost. Reduce each result to normal form
            // exactly as the interpreted rule-application path does (the `pairs` loop below), so a RHS with
            // reducible subterms (a recursive call, a grounded op) finishes evaluating and the fresh-variable
            // counter stays in lockstep.
            // An impure compiled body runs the slot machine to completion (every recursive call resolves
            // through the holder, every grounded op is computed) or BAILs; it never returns a half-reduced
            // term. So its result is already normal form and the re-reduce below only re-walks it. For a
            // deep binary build (matespace rewriteK) that re-walk is the dominant cost and advances the
            // fresh-variable counter past what the build needed. Skip it. The result stays alpha-equivalent
            // to the interpreted path (the gensym counter only names fresh vars, so a different count yields
            // a consistently-renamed term, never a captured one), which is exactly the equality the oracle
            // and LeaTTa check (`alphaEq`). Pure compiled results keep the re-reduce (unchanged).
            const impResult = cr.state !== undefined;
            if (cr.state !== undefined) cur2 = cr.state;
            else if (cr.counterDelta !== 0)
              cur2 = { counter: cur2.counter + cr.counterDelta, world: cur2.world };
            for (const r of cr.results) {
              const pb = mergeRestrict(env, queryVars, partB, r.bnd);
              if (atomEq(r.atom, notReducibleA) || atomEq(r.atom, wApp)) {
                if (wApp.ground) env.evaluatedAtoms.add(wApp);
                out.push([wApp, partB]);
              } else if ((opReturnsAtom || impResult) && !isEmbeddedOp(r.atom)) {
                out.push([r.atom, pb]);
              } else {
                const [more, st4] = yield* mettaEvalG(env, fuel - 1, cur2, pb, r.atom);
                cur2 = st4;
                for (const m of more) out.push([m[0], mergeRestrict(env, queryVars, pb, m[1])]);
              }
            }
            continue;
          }
        }
        // tabling: memoise a ground pure call's ordered result bag (keyed by its printed form). A functor
        // with runtime rules is version-keyed (see runtimeFunctorPure); a purely-static functor keeps the
        // plain key and the original fast path unchanged.
        let eligible = false;
        let key = "";
        if (tabling && wApp.ground) {
          // Gate the O(size) keyWellFormed walk behind the O(1) purity test: a non-pure functor (the impure
          // add-atom calls that carry a deep Peano term) is never tabled, so it never needs the walk. `&&` is
          // commutative for the side-effect-free predicates, so this is byte-identical to checking it first.
          if (cur2.world.selfRules.has(op)) {
            if (runtimeFunctorPure(env, cur2.world, op) && keyWellFormed(wApp)) {
              eligible = true;
              key = tableKey(wApp) + "@v" + rulesVersion(cur2.world.selfRules.get(op));
            }
          } else if (staticPure && keyWellFormed(wApp)) {
            eligible = true;
            key = tableKey(wApp);
          }
          if (eligible) {
            const hit = env.table!.get(key);
            if (hit !== undefined) {
              for (const r of hit) out.push([r, partB]);
              continue;
            }
          }
        }
        const before = out.length;
        const [pairs, st3] = yield* interpretLoopG(env, fuel, cur2, [
          { stack: atomToStack(makeExpr(env, [sym("eval"), wApp]), null), bnd: lbnd },
        ]);
        cur2 = st3;
        // Tail call: one ground call reducing to a single operator-headed continuation, with no branching
        // (one partial, one pair) and no bindings to thread (queryVars empty). Loop on the continuation via
        // reduceTrampoline instead of recursing into mettaEvalG, so the native stack stays flat down a deep
        // tail-recursive chain. Defer this call's tabling key to pendingKeys: it shares the chain's normal
        // form, so flushReturn caches it (and every key above it) once the chain terminates.
        if (partials.length === 1 && queryVars.length === 0 && pairs.length === 1) {
          const p = pairs[0]!;
          const isData = atomEq(p[0], notReducibleA) || atomEq(p[0], wApp);
          if (!isData && !(opReturnsAtom && !isEmbeddedOp(p[0])) && opOf(p[0]) !== undefined) {
            const pb = mergeRestrict(env, queryVars, partB, p[1]);
            if (eligible) pendingKeys.push(key);
            la = p[0];
            lbnd = pb;
            lst = cur2;
            // p[0] is operator-headed (opOf check) and instantiate preserves the head, so this stays an
            // expression headed by a symbol, exactly what the loop top reads as `lw.items[0]`.
            lw = inst(env, lbnd, la) as ExprAtom;
            continue reduceTrampoline;
          }
        }
        for (const p of pairs) {
          const pb = mergeRestrict(env, queryVars, partB, p[1]);
          if (atomEq(p[0], notReducibleA) || atomEq(p[0], wApp)) {
            // wApp did not reduce (a constructor application / data term). Cache a ground one so the next
            // visit short-circuits instead of re-walking it.
            if (wApp.ground) env.evaluatedAtoms.add(wApp);
            out.push([wApp, partB]);
          } else if (opReturnsAtom && !isEmbeddedOp(p[0])) {
            out.push([p[0], pb]);
          } else {
            const [more, st4] = yield* mettaEvalG(env, fuel - 1, cur2, pb, p[0]);
            cur2 = st4;
            for (const m of more) {
              out.push([m[0], mergeRestrict(env, queryVars, pb, m[1])]);
            }
          }
        }
        if (eligible) {
          const produced = out.slice(before).map((p) => p[0]);
          if (produced.every((a) => a.ground)) env.table!.set(key, produced);
        }
      }
      return flushReturn(out, cur2);
    }
  }

  if (w.kind === "expr" && w.items.length > 0) {
    // expression-headed application
    const [ruleRes, st1] = yield* interpretLoopG(env, fuel, st, [
      { stack: atomToStack(makeExpr(env, [sym("eval"), w]), null), bnd },
    ]);
    const reduced = ruleRes.filter((p) => !atomEq(p[0], w) && !atomEq(p[0], notReducibleA));
    if (reduced.length === 0) {
      const [tupleRes, st2] = yield* interpretLoopG(env, fuel, st1, [
        {
          stack: atomToStack(
            makeExpr(env, [sym("eval"), makeExpr(env, [sym("interpret-tuple"), w, sym("&self")])]),
            null,
          ),
          bnd,
        },
      ]);
      // the interpret-tuple fallback: a tuple element equal to the whole term is already final.
      return yield* reduceChildrenG(env, fuel, st2, tupleRes, (p) =>
        atomEq(p[0], w) ? [p] : undefined,
      );
    }
    // a rule fired: every reduced result still needs evaluating to normal form.
    return yield* reduceChildrenG(env, fuel, st1, reduced, () => undefined);
  }

  // bare symbol / variable / grounded
  const [pairs, st1] = yield* interpretLoopG(env, fuel, st, [
    { stack: atomToStack(makeExpr(env, [sym("eval"), w]), null), bnd },
  ]);
  // an irreducible symbol stays itself; an Atom-typed result is inert; anything else evaluates on.
  return yield* reduceChildrenG(env, fuel, st1, pairs, (p) =>
    atomEq(p[0], notReducibleA) || atomEq(p[0], w)
      ? [[w, bnd]]
      : returnsAtom(env, w) && !isEmbeddedOp(p[0])
        ? [p]
        : undefined,
  );
}

// ---------- public API ----------
const DEFAULT_FUEL = 2_000_000;

/** Type-directed evaluation of `a` (the sync driver: throws `AsyncInSyncError` if it reaches an async
 *  grounded op). This is the public synchronous entry point with the original signature. */
/** A native V8 stack overflow (`RangeError: Maximum call stack size exceeded`). The machine threads its
 *  own stack as a cons-list, but nested sub-evaluations still recurse through `yield*`, so a deeply
 *  recursive object program can exhaust the JS call stack before `fuel` runs out. The reference
 *  interpreter, being iterative, reports a `StackOverflow` error atom for runaway recursion rather than
 *  aborting; we match that by degrading the native overflow to the same error the fuel limit emits. */
function isNativeStackOverflow(e: unknown): boolean {
  return e instanceof RangeError && /call stack/i.test(e.message);
}
function stackOverflowResult(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  a: Atom,
): [Array<[Atom, Bindings]>, St] {
  return [[[makeExpr(env, [sym("Error"), inst(env, bnd, a), sym("StackOverflow")]), bnd]], st];
}

function mettaEval(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
): [Array<[Atom, Bindings]>, St] {
  ensureCompiled(env);
  try {
    return runGenSync(mettaEvalG(env, fuel, st, bnd, a));
  } catch (e) {
    if (isNativeStackOverflow(e)) return stackOverflowResult(env, st, bnd, a);
    throw e;
  }
}

/** Async type-directed evaluation: awaits async grounded operations (`env.agt`). An optional `signal`
 *  makes it cancellable (used by `race` to stop losing branches). */
export function mettaEvalAsync(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
  signal?: AbortSignal,
): Promise<[Array<[Atom, Bindings]>, St]> {
  ensureCompiled(env);
  return runGenAsync(mettaEvalG(env, fuel, st, bnd, a), signal).catch((e: unknown) => {
    if (isNativeStackOverflow(e)) return stackOverflowResult(env, st, bnd, a);
    throw e;
  });
}

/** Evaluate `atom` (i.e. interpret `(eval atom)`) under `env`, returning the result atoms. */
export function evalAtom(
  env: MinEnv,
  atom: Atom,
  st: St = initSt(),
  fuel = DEFAULT_FUEL,
): [Atom[], St] {
  const [pairs, st2] = mettaEval(env, fuel, st, [], atom);
  return [pairs.map((p) => p[0]), st2];
}

export { mettaEval };
