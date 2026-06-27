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
  sym,
  variable,
  expr,
  gint,
  atomEq,
  atomVars,
  collectVars,
  emptyExpr,
  isErrorAtom,
  metaType,
} from "./atom";
import { type Bindings, type BindingRel, hasLoop } from "./bindings";
import { format } from "./parser";
import { matchAtoms, matchAtomsScoped, merge, addVarBinding } from "./match";
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
import { type Relation, wcoJoin } from "./wcojoin";
import { type GroundingTable, type ReduceResult, callGrounded, pettaOpNames } from "./builtins";
import { tableKey, keyWellFormed, analyzePurity as analyzePurityRef, IMPURE_OPS } from "./tabling";
import { runCompiled, compileEnv, type CompiledFns } from "./compile";

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
  const a = instantiate(bnd, arg);
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
  compiled?: CompiledFns;
  /** Set when an equation changed, so the compiler re-runs before the next query. */
  compileDirty?: boolean;
  /** Opt-in PeTTa-style auto-currying, enabled by `(import! &self curry)`. When set, a symbol-headed
   *  call applied to fewer arguments than the function's arity reduces to `(partial fn (args))` instead
   *  of staying irreducible. Off by default, so the Hyperon oracle baseline is unaffected. */
  curry?: boolean;
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
    sigs: new Map(),
    gt,
    atoms: [],
    types: new Map(),
    imports: new Map(),
    exprTypes: [],
    agt: new Map(),
    mutexes: new Map(),
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
 *  rest of this run; the static common case (no runtime equation add) never hits this. */
function disableTabling(env: MinEnv): void {
  if (env.table !== undefined) {
    env.table.clear();
    env.pureFunctors = new Set();
    if (env.compiled !== undefined) {
      env.compiled = new Map();
      env.compileDirty = false;
    }
  }
}

/** Incorporate one atom into `env` (mutating): rule index, signatures, types, and the atom list.
 *  Lets a sequential runner extend the env per atom instead of rebuilding it each query; correctness
 *  gated by the 270/270 oracle. */
export function addAtomToEnv(env: MinEnv, x: Atom): void {
  env.atoms.push(x);
  // Clause-index for fast `match` candidate selection: by functor, and by functor+first-arg when the
  // first argument is a ground leaf.
  const fk = headKey(x);
  if (fk === undefined) env.varHeadedFacts.push(x);
  else {
    pushTo(env.factIndex, fk, x);
    // Index by every argument position: a ground leaf goes in argIndex; a variable/expression argument
    // goes in nonGroundAtPos (it stays a candidate for any query that binds that position).
    if (x.kind === "expr")
      for (let i = 1; i < x.items.length; i++) {
        const ak = argKey(x.items[i]!);
        if (ak !== undefined) pushTo(env.argIndex, fk + KEY_SEP + i + KEY_SEP + ak, x);
        else pushTo(env.nonGroundAtPos, fk + KEY_SEP + i, x);
      }
  }
  if (opOf(x) === "=" && x.kind === "expr" && x.items.length === 3) {
    const lhs = x.items[1]!;
    const rhs = x.items[2]!;
    const k = headKey(lhs);
    if (k === undefined) env.varRules.push([lhs, rhs]);
    else {
      const cur = env.ruleIndex.get(k);
      if (cur === undefined) env.ruleIndex.set(k, [[lhs, rhs]]);
      else cur.push([lhs, rhs]);
    }
    invalidateTabling(env);
  }
  if (x.kind === "expr" && opOf(x) === ":" && x.items.length === 3) {
    const subj = x.items[1]!;
    const t = x.items[2]!;
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
  return logSize(w.selfExtra) === 0 ? env.atoms : [...env.atoms, ...logToArray(w.selfExtra)];
}

function candidates(env: MinEnv, toEval: Atom): Array<[Atom, Atom]> {
  const k = headKey(toEval);
  const keyed = k !== undefined ? (env.ruleIndex.get(k) ?? []) : [];
  return [...keyed, ...env.varRules];
}

// ---------- world + state ----------
export interface World {
  spaces: Map<string, Atom[]>;
  store: Map<number, Atom>;
  tokens: Map<string, Atom>;
  // `&self` runtime additions as a persistent O(1)-append log (was a wholesale-copied `Atom[]`).
  selfExtra: AtomLog;
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
  const baseSelf = logToArray(base.selfExtra);
  let selfExtra = baseSelf.slice();
  const spaces = new Map(base.spaces);
  const store = new Map(base.store);
  const tokens = new Map(base.tokens);
  for (const w of branches) {
    const d = multisetDelta(baseSelf, logToArray(w.selfExtra));
    selfExtra = applyAtomDelta(selfExtra, d.added, d.removed);
    for (const [k, v] of w.spaces) {
      const baseV = base.spaces.get(k) ?? [];
      const sd = multisetDelta(baseV, v);
      spaces.set(k, applyAtomDelta(spaces.get(k) ?? baseV.slice(), sd.added, sd.removed));
    }
    for (const [k, v] of w.store) if (!Object.is(base.store.get(k), v)) store.set(k, v);
    for (const [k, v] of w.tokens) if (!Object.is(base.tokens.get(k), v)) tokens.set(k, v);
  }
  // Rebuild the rule index from the merged `&self` atoms (par is rare; correctness over speed here).
  const merged: World = {
    spaces,
    store,
    tokens,
    selfExtra: logFromArray(selfExtra),
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
function subTokens(w: World, a: Atom): Atom {
  if (w.tokens.size === 0) return a; // no bind! tokens: identity, skip the tree clone (hot path)
  if (a.kind === "sym") return w.tokens.get(a.name) ?? a;
  if (a.kind === "expr") return expr(a.items.map((x) => subTokens(w, x)));
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
const typePrep = (w: World, a: Atom): Atom => wrapStates(w, subTokens(w, a));

function candidatesW(env: MinEnv, w: World, toEval: Atom): Array<[Atom, Atom]> {
  // Runtime rules come from the index (head-matched bucket plus var-headed), not a scan of the log.
  const k2 = headKey(toEval);
  const headRules = k2 !== undefined ? (w.selfRules.get(k2) ?? []) : [];
  return [...candidates(env, toEval), ...headRules, ...w.selfVarRules];
}

// Variable list of a rule (lhs vars first, then rhs-only vars), cached on the lhs reference. Rules are
// static, so their variable set never changes; queryOp freshens the same rules on every reduction, so
// caching skips re-walking the rule each time (atomVars showed up hot in profiling otherwise).
const ruleVarsCache = new WeakMap<Atom, string[]>();
function ruleVars(lhs: Atom, rhs: Atom): string[] {
  let vs = ruleVarsCache.get(lhs);
  if (vs === undefined) {
    vs = atomVars(lhs);
    const seen = new Set(vs);
    for (const v of atomVars(rhs))
      if (!seen.has(v)) {
        seen.add(v);
        vs.push(v);
      }
    ruleVarsCache.set(lhs, vs);
  }
  return vs;
}

// The fresh-rename substitution for one rule application: each rule variable to `name#counter`.
function freshenSub(counter: number, lhs: Atom, rhs: Atom): Subst {
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
        if (!hasLoop(m)) out.push(evalResult(prev, instantiate(m, rhs0, suffix), m));
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
  const x2 = instantiate(b, x);
  const op = opOf(x2);
  // A PeTTa-compat grounded op (length, sort, append, …) defers to a user `=` rule of the same head, so the
  // stdlib never shadows a program's own definition; every other grounded op applies eagerly as before.
  const useGrounded =
    op !== undefined &&
    x2.kind === "expr" &&
    !(pettaOpNames.has(op) && hasRuleFor(env, st.world, st.counter, x2));
  if (useGrounded) {
    const args = x2.items.slice(1).map((a) => resolveStates(st.world, subTokens(st.world, a)));
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
      const args = x2.items.slice(1).map((a) => resolveStates(st.world, subTokens(st.world, a)));
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

function unifyOp(prev: Stack, a: Atom, p: Atom, t: Atom, e: Atom, b: Bindings): Item[] {
  const ms: Item[] = [];
  for (const mb of matchAtoms(a, p))
    for (const m of merge(b, mb)) if (!hasLoop(m)) ms.push(finItem(prev, instantiate(m, t), m));
  return ms.length === 0 ? [finItem(prev, e, b)] : ms;
}

// ---------- final-item helpers ----------
const isFinal = (it: Item): boolean =>
  it.stack !== null && it.stack.tail === null && it.stack.head.fin;
function finalPair(it: Item): [Atom, Bindings] {
  const f = it.stack;
  return f === null ? [emptyA, []] : [instantiate(it.bnd, f.head.atom), it.bnd];
}
function exhaustedPair(it: Item): [Atom, Bindings] {
  const f = it.stack;
  return f === null
    ? [emptyA, it.bnd]
    : [expr([sym("Error"), instantiate(it.bnd, f.head.atom), sym("StackOverflow")]), it.bnd];
}

function resolveAtomFix(b: Bindings, n: number, a: Atom): Atom {
  let cur = a;
  for (let i = 0; i < n; i++) {
    const next = instantiate(b, cur);
    if (atomEq(next, cur)) return cur;
    cur = next;
  }
  return cur;
}
function restrictBnd(vars: readonly string[], b: Bindings): Bindings {
  const solved: BindingRel[] = [];
  for (const x of vars) {
    const v = resolveAtomFix(b, b.length + 1, variable(x));
    if (!(v.kind === "var" && v.name === x)) solved.push({ tag: "val", x, a: v, y: undefined });
  }
  // The eq filter only matters when `b` actually carries an alias; most bindings are pure `val`, so skip
  // both the scan and the Set allocation in that common case. When there are aliases, use a Set for O(1)
  // membership (was `vars.includes` twice per binding, O(|vars|*|b|), the dominant cost on a large binding).
  if (!b.some((r) => r.tag === "eq")) return solved;
  const vset = new Set(vars);
  const eqs = b.filter((r): r is BindingRel => r.tag === "eq" && vset.has(r.x) && vset.has(r.y));
  return solved.length === 0 ? eqs : [...solved, ...eqs];
}
// Narrow a reduction result's bindings to the query variables: merge the result's bindings `pb` onto the
// base `baseB`, then keep only `vars`. If the merge is incompatible (no solution), fall back to `pb` alone.
// This is the standard post-reduction binding step, used after every metta-call and rule application.
function mergeRestrict(vars: readonly string[], baseB: Bindings, pb: Bindings): Bindings {
  const merged = merge(baseB, pb);
  return restrictBnd(vars, merged.length > 0 ? merged[0]! : pb);
}
function scopeVars(b: Bindings, prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(instantiate(b, p.head.atom), out, seen);
  return out;
}
// The variables a continuation directly references: the free vars of every pending stack frame's atom,
// un-instantiated (unlike scopeVars, which resolves through the binding first). Used to prune the binding
// carried across a `chain` step down to what the rest of the computation can still observe.
function frameVars(prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(p.head.atom, out, seen);
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
        const m = matchAtoms(instantiate(tb, params[i]!), argTs[i]!);
        if (m.length > 0) {
          const merged = merge(tb, m[0]!);
          if (merged.length > 0) tb = merged[0]!;
        }
      }
      out.push(instantiate(tb, ret));
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
  return combos.map((c) => expr(c));
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
  const ti = instantiate(tb, ti0);
  // A top parameter type (`Atom`/`%Undefined%`) accepts any argument, so the argument is well-typed
  // without inferring its type. Checking this by name first skips both `typePrep` and `getTypes`, each an
  // O(term-size) walk, on the very common case (e.g. `add-atom`'s `Atom` parameter). Without it, adding
  // deeply-nested terms re-walks each one every time and turns add-heavy programs quadratic.
  if (ti.kind === "sym" && (ti.name === "Atom" || ti.name === "%Undefined%"))
    return typeCheckArgs(env, w, argTypes, i + 1, tb, argsLeft.slice(1));
  const ai = argsLeft[0]!;
  const prepped = typePrep(w, ai);
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
function matchCandidates(env: MinEnv, w: World, pInst: Atom): readonly Atom[] {
  const k = headKey(pInst);
  if (k === undefined) {
    // variable-headed pattern: must consider everything.
    const extra = logToArray(w.selfExtra);
    const all = extra.length === 0 ? env.atoms.slice() : [...env.atoms, ...extra];
    return resolveAll(w, all);
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
  if (pInst.ground && logNonGround(w.selfExtra) === 0 && w.store.size === 0) {
    const c = idxCount(logGroundIdx(w.selfExtra), pInst);
    for (let i = 0; i < c; i++) cands.push(pInst);
    return cands; // pInst carries no state handle, so resolveAll would be a no-op
  }
  const extra = logToArray(w.selfExtra);
  for (const a of extra) {
    const akk = headKey(a);
    if (akk === undefined || akk === k) cands.push(a);
  }
  return resolveAll(w, cands);
}

/** Apply state resolution to candidate atoms only when the world actually holds state. */
function resolveAll(w: World, atoms: Atom[]): readonly Atom[] {
  return w.store.size === 0 ? atoms : atoms.map((x) => resolveStates(w, x));
}

function matchConj(
  getCandidates: (pInst: Atom) => readonly Atom[],
  patterns: readonly Atom[],
  st: St,
  sols: Bindings[],
): [Bindings[], St] {
  let cur = sols;
  let counter = st.counter;
  for (const p of patterns) {
    const next: Bindings[] = [];
    for (const b of cur) {
      const pInst = instantiate(b, p);
      for (const atom of getCandidates(pInst)) {
        const atom2 = freshenRule(counter, atom, atom)[0];
        counter += 1;
        for (const mb of matchAtoms(pInst, atom2))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
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
function matchConjJoin(
  getCandidates: (pInst: Atom) => readonly Atom[],
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): [Bindings[], St] {
  let counter = st.counter;
  const groundRels: Array<Relation<Atom>> = [];
  const otherPatterns: Atom[] = [];
  for (const p of patterns) {
    const pInst = instantiate(b0, p);
    const pvars = atomVars(pInst);
    if (pvars.length === 0) {
      otherPatterns.push(p); // fully-ground existence check: cheap, leave to the nested loop
      continue;
    }
    const tuples: Array<Map<string, Atom>> = [];
    let allGround = true;
    for (const atom of getCandidates(pInst)) {
      const fresh = freshenRule(counter, atom, atom)[0];
      counter += 1;
      for (const mb of matchAtoms(pInst, fresh)) {
        const t = new Map<string, Atom>();
        for (const v of pvars) {
          const val = instantiate(mb, variable(v));
          t.set(v, val);
          if (!val.ground) allGround = false;
        }
        tuples.push(t);
      }
    }
    if (allGround) groundRels.push({ vars: pvars, tuples });
    else otherPatterns.push(p);
  }
  let cur: Bindings[];
  if (groundRels.length > 0) {
    cur = [];
    for (const sol of wcoJoin(groundRels, mutexKey)) {
      let bs: Bindings[] = [b0];
      for (const [v, val] of sol) {
        const nb: Bindings[] = [];
        for (const b of bs) nb.push(...addVarBinding(b, v, val));
        bs = nb;
      }
      for (const b of bs) if (!hasLoop(b)) cur.push(b);
    }
  } else {
    cur = [b0];
  }
  for (const p of otherPatterns) {
    const next: Bindings[] = [];
    // The same candidate facts are matched against every WCO solution; a fact's freshened copies differ
    // only in their fresh variable names, which each match binds independently inside its own result. So
    // freshen each fact once and reuse it across solutions. Freshening (a full term copy for a
    // template-shaped fact) is the allocation-heavy part of the emit and was being redone per result. The
    // cache is per-conjunct, so distinct conjuncts that match the same fact still get distinct fresh vars.
    const freshCache = new Map<Atom, Atom>();
    for (const b of cur) {
      const pInst = instantiate(b, p);
      for (const atom of getCandidates(pInst)) {
        let fresh = freshCache.get(atom);
        if (fresh === undefined) {
          fresh = freshenRule(counter, atom, atom)[0];
          counter += 1;
          freshCache.set(atom, fresh);
        }
        for (const mb of matchAtoms(pInst, fresh))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
    }
    cur = next;
  }
  return [cur, { counter, world: st.world }];
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
function* interpretStack1G(env: MinEnv, fuel: number, st: St, it: Item): Gen<[Item[], St]> {
  if (it.stack === null) return [[], st];
  const top = it.stack.head;
  const prev = it.stack.tail;
  if (top.fin) {
    if (prev === null) return [[it], st];
    const pf = prev.head;
    const pprev = prev.tail;
    const res = instantiate(it.bnd, top.atom);
    if (pf.ret === "chain") {
      if (opOf(pf.atom) === "chain" && pf.atom.kind === "expr" && pf.atom.items.length === 4) {
        const v = pf.atom.items[2]!;
        const templ = pf.atom.items[3]!;
        const nf = frame(expr([sym("chain"), res, v, templ]), pf.ret, pf.vars, false);
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
        const bnd = restrictBnd(atomVars(cont, frameVars(prev)), it.bnd);
        return [[{ stack: atomToStack(cont, prev), bnd }], st];
      }
      break;
    case "unify":
      if (it2.length === 5) return [unifyOp(prev, it2[1]!, it2[2]!, it2[3]!, it2[4]!, it.bnd), st];
      break;
    case "cons-atom":
      if (it2.length === 3 && it2[2]!.kind === "expr")
        return [[finItem(prev, expr([it2[1]!, ...it2[2]!.items]), it.bnd)], st];
      if (it2.length === 3)
        return [[finItem(prev, errAtom(a, "cons-atom: expected expression tail"), it.bnd)], st];
      break;
    case "decons-atom":
      if (it2.length === 2 && it2[1]!.kind === "expr" && it2[1]!.items.length > 0) {
        const [h, ...t] = it2[1]!.items;
        return [[finItem(prev, expr([h!, expr(t)]), it.bnd)], st];
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
        for (const p of pairs)
          for (const m of merge(it.bnd, restrictBnd(scopeVars(it.bnd, prev), p[1])))
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
        const sp = instantiate(it.bnd, it2[1]!);
        const sname = sp.kind === "sym" ? sp.name : undefined;
        if (sname !== undefined && sname !== "&self") {
          const sa = st.world.spaces.get(sname);
          if (sa !== undefined && sa.length > 0) typeEnv = buildEnv([...env.atoms, ...sa], env.gt);
        }
      }
      const x = op === "get-type-space" ? it2[2]! : it2[1]!;
      return yield* getTypeOpG(typeEnv, fuel, st, prev, instantiate(it.bnd, x), it.bnd);
    }
    case "get-doc":
      if (it2.length === 2)
        return [[finItem(prev, getDocOf(env, st.world, instantiate(it.bnd, it2[1]!)), it.bnd)], st];
      break;
    case "match":
      if (it2.length === 4) return matchOp(env, st, prev, it2[1]!, it2[2]!, it2[3]!, it.bnd);
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
      return [[finItem(prev, expr(atoms.map((p) => expr([p[0], unitA]))), it.bnd)], st2];
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
      const [pairs, st2] = yield* mettaEvalG(env, fuel, st, it.bnd, it2[1]!);
      const first = pairs.length > 0 ? [pairs[0]!] : [];
      return [first.map((p) => finItem(prev, p[0], it.bnd)), st2];
    }
    case "with-mutex": {
      // Serialise the body against other `with-mutex` sections of the same name (canonical async
      // Promise-chain lock; release in finally so a throwing/empty body still unlocks).
      if (it2.length !== 3) break;
      const name = mutexKey(instantiate(it.bnd, it2[1]!));
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
      w.store.set(id, instantiate(it.bnd, it2[1]!));
      return [[finItem(prev, stateHandle(id), it.bnd)], { counter: id + 1, world: w }];
    }
    case "get-state": {
      if (it2.length !== 2) break;
      const id = stateId(st.world, instantiate(it.bnd, it2[1]!));
      if (id !== undefined) return [[finItem(prev, st.world.store.get(id) ?? emptyA, it.bnd)], st];
      return [
        [finItem(prev, errAtom(instantiate(it.bnd, it2[1]!), "get-state: not a state"), it.bnd)],
        st,
      ];
    }
    case "change-state!": {
      if (it2.length !== 3) break;
      const id = stateId(st.world, instantiate(it.bnd, it2[1]!));
      if (id !== undefined) {
        const w = cloneWorld(st.world);
        w.store.set(id, instantiate(it.bnd, it2[2]!));
        return [[finItem(prev, stateHandle(id), it.bnd)], { counter: st.counter, world: w }];
      }
      return [
        [
          finItem(
            prev,
            errAtom(instantiate(it.bnd, it2[1]!), "change-state!: not a state"),
            it.bnd,
          ),
        ],
        st,
      ];
    }
    case "new-space":
    case "new-mork-space": {
      const id = st.counter;
      const name = "&space-" + String(id);
      const w = cloneWorld(st.world);
      w.spaces.set(name, []);
      return [[finItem(prev, sym(name), it.bnd)], { counter: id + 1, world: w }];
    }
    case "fork-space": {
      if (it2.length !== 2) break;
      const src = spaceName(st.world, instantiate(it.bnd, it2[1]!));
      if (src === undefined)
        return [
          [finItem(prev, errAtom(instantiate(it.bnd, it2[1]!), "fork-space: not a space"), it.bnd)],
          st,
        ];
      const srcAtoms =
        src === "&self" ? selfAtoms(env, st.world) : (st.world.spaces.get(src) ?? []);
      const id = st.counter;
      const name = "&space-" + String(id);
      const w = cloneWorld(st.world);
      w.spaces.set(name, [...srcAtoms]);
      return [[finItem(prev, sym(name), it.bnd)], { counter: id + 1, world: w }];
    }
    case "add-atom":
      if (it2.length === 3) {
        const added = instantiate(it.bnd, it2[2]!);
        if (opOf(added) === "=") disableTabling(env);
        return spaceMutate(st, prev, it2[1]!, it.bnd, (w, name) => appendSpace(w, name, [added]));
      }
      break;
    case "remove-atom":
      if (it2.length === 3)
        return spaceMutate(st, prev, it2[1]!, it.bnd, (w, name) =>
          eraseSpace(w, name, instantiate(it.bnd, it2[2]!)),
        );
      break;
    case "get-atoms": {
      if (it2.length !== 2) break;
      const name = spaceName(st.world, instantiate(it.bnd, it2[1]!));
      if (name === undefined)
        return [
          [finItem(prev, errAtom(instantiate(it.bnd, it2[1]!), "get-atoms: not a space"), it.bnd)],
          st,
        ];
      const list = name === "&self" ? selfAtoms(env, st.world) : (st.world.spaces.get(name) ?? []);
      return [list.map((x) => finItem(prev, x, it.bnd)), st];
    }
    case "pragma!": {
      // `(pragma! <key> <value>)` writes an interpreter setting (Hyperon's pragma!) and returns unit.
      // `max-stack-depth` is the one setting that changes interpretation: it must be an unsigned integer
      // (negative or non-integer -> the same `UnsignedIntegerIsExpected` error Hyperon emits), and 0 means
      // unlimited. Any other key is accepted and ignored, matching Hyperon storing arbitrary keys. A pragma
      // only ever tightens the in-language depth bound; it cannot touch the host's step budget.
      if (it2.length !== 3) break;
      const key = instantiate(it.bnd, it2[1]!);
      if (key.kind === "sym" && key.name === "max-stack-depth") {
        const val = instantiate(it.bnd, it2[2]!);
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
      const tok = instantiate(it.bnd, it2[1]!);
      if (tok.kind === "sym") {
        const w = cloneWorld(st.world);
        w.tokens.set(tok.name, instantiate(it.bnd, it2[2]!));
        return [[finItem(prev, emptyExpr, it.bnd)], { counter: st.counter, world: w }];
      }
      return [[finItem(prev, errAtom(tok, "bind!: token must be a symbol"), it.bnd)], st];
    }
    case "import!": {
      if (it2.length !== 3) break;
      const fileAtom = instantiate(it.bnd, it2[2]!);
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
      return spaceMutate(st, prev, it2[1]!, it.bnd, (w, name) => appendSpace(w, name, fileAtoms));
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
function appendSpace(w0: World, name: string, atoms: Atom[]): World {
  // `&self` add-atom only touches `selfExtra` (and the rule index iff an equality is added), so SHARE the
  // unchanged spaces/store/tokens by reference rather than `cloneWorld`'s four fresh Maps. That copy was
  // the per-add allocation that kept the add-heavy benchmarks (matespace family) quadratic-in-GC even
  // after the log made append itself O(1).
  if (name === "&self") {
    let selfRules = w0.selfRules;
    let selfVarRules = w0.selfVarRules;
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
    return {
      spaces: w0.spaces,
      store: w0.store,
      tokens: w0.tokens,
      selfExtra: logAppendAll(w0.selfExtra, atoms),
      selfRules,
      selfVarRules,
      maxStackDepth: w0.maxStackDepth,
    };
  }
  const w = cloneWorld(w0);
  w.spaces.set(name, [...(w.spaces.get(name) ?? []), ...atoms]);
  return w;
}
function eraseSpace(w0: World, name: string, a: Atom): World {
  const w = cloneWorld(w0);
  const erase1 = (xs: readonly Atom[]): Atom[] => {
    const i = xs.findIndex((y) => atomEq(y, a));
    return i < 0 ? [...xs] : [...xs.slice(0, i), ...xs.slice(i + 1)];
  };
  if (name === "&self") {
    const xs = logToArray(w.selfExtra);
    const i = xs.findIndex((y) => atomEq(y, a));
    if (i >= 0) w.selfExtra = logFromArray([...xs.slice(0, i), ...xs.slice(i + 1)]);
  } else w.spaces.set(name, erase1(w.spaces.get(name) ?? []));
  return w;
}
function spaceMutate(
  st: St,
  prev: Stack,
  s: Atom,
  b: Bindings,
  f: (w: World, name: string) => World,
): [Item[], St] {
  const name = spaceName(st.world, instantiate(b, s));
  if (name === undefined)
    return [[finItem(prev, errAtom(instantiate(b, s), "not a space"), b)], st];
  return [[finItem(prev, emptyExpr, b)], { counter: st.counter, world: f(st.world, name) }];
}

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
    for (const t of getTypesForQuery(env, typePrep(st.world, xi))) {
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
    const illTyped = getTypes(env, typePrep(st.world, head)).some((ft) => {
      if (opOf(ft) === "->" && ft.kind === "expr")
        return typeCheckArgs(env, st.world, ft.items.slice(1, -1), 0, [], args) !== undefined;
      return false;
    });
    return illTyped ? [[], st] : yield* emit(st);
  }
  return yield* emit(st);
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
  const sn = spaceName(st.world, instantiate(b, space));
  const subbed = subTokens(st.world, pattern);
  const patterns =
    opOf(subbed) === "," && subbed.kind === "expr"
      ? subbed.items.slice(1).map((p) => resolveStates(st.world, p))
      : [resolveStates(st.world, subbed)];
  // &self uses the functor index; a named space scans its (smaller) atom list directly.
  let getCandidates: (pInst: Atom) => readonly Atom[];
  if (sn === undefined || sn === "&self") {
    getCandidates = (pInst) => matchCandidates(env, st.world, pInst);
  } else {
    const named = (st.world.spaces.get(sn) ?? []).map((x) => resolveStates(st.world, x));
    getCandidates = () => named;
  }
  const [sols, st2] =
    patterns.length >= 2
      ? matchConjJoin(getCandidates, patterns, st, b)
      : matchConj(getCandidates, patterns, st, [b]);
  const out: Item[] = [];
  for (const m of sols) if (!hasLoop(m)) out.push(finItem(prev, instantiate(m, template), m));
  return [out, st2];
}

// ---------- driver (iterative) ----------
function* interpretLoopG(
  env: MinEnv,
  fuel: number,
  st: St,
  work: Item[],
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
  const stack: Item[] = [];
  for (let i = work.length - 1; i >= 0; i--) stack.push(work[i]!);
  let cur = st;
  let f = fuel;
  while (stack.length > 0) {
    if (f <= 0) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const it = stack[i]!;
        emit(isFinal(it) ? finalPair(it) : exhaustedPair(it));
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
        emit(isFinal(it) ? finalPair(it) : exhaustedPair(it));
        continue;
      }
    }
    const [results, st2] = yield* interpretStack1G(env, f - 1, cur, it);
    cur = st2;
    f -= 1;
    // Finals stream out immediately in result order (inlined to keep the no-sink case a direct push, no
    // per-result closure). Non-finals collect in order, then push reversed so they pop in that same order.
    const more: Item[] = [];
    for (const r of results) {
      if (isFinal(r)) {
        if (sink !== undefined) sink(finalPair(r));
        else done.push(finalPair(r));
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
// its irreducibility is not stable. Keyed by object identity (WeakSet), which is exactly what the shared
// subterms threaded through a binding need.
const evaluatedAtoms = new WeakSet<Atom>();

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

// ---------- mettaEval (type-directed metta-call loop) ----------
function* mettaEvalG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
): Gen<[Array<[Atom, Bindings]>, St]> {
  if (fuel <= 0)
    return [[[expr([sym("Error"), instantiate(bnd, a), sym("StackOverflow")]), bnd]], st];
  const w = instantiate(bnd, a);
  if (w.kind === "expr" && w.ground && evaluatedAtoms.has(w)) return [[[w, bnd]], st];
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
      const queryVars = args.flatMap((x) => atomVars(x));
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
              nextParts.push([[...accAtoms, p[0]], mergeRestrict(queryVars, accB, p[1])]);
            }
          } else {
            nextParts.push([[...accAtoms, instantiate(accB, ae)], accB]);
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
        const wApp = expr([sym(op), ...partAtoms]);
        // opt-in currying: a known function applied to fewer arguments than its arity becomes a
        // `(partial fn (args))` closure (PeTTa's build_call_or_partial), checked before evaluation so a
        // grounded op is not called with the wrong arity. Requires at least one argument, so a nullary
        // thunk is still evaluated rather than curried.
        if (env.curry && partAtoms.length >= 1) {
          const ar = functionArity(env, cur2.world, op);
          if (ar !== undefined && partAtoms.length < ar) {
            out.push([expr([sym("partial"), sym(op), expr(partAtoms)]), partB]);
            continue;
          }
        }
        // compiled fast path: a pure deterministic int/bool function over ground int args.
        if (env.compiled !== undefined) {
          const cr = runCompiled(env, op, partAtoms);
          if (cr !== undefined) {
            out.push([cr, partB]);
            continue;
          }
        }
        // tabling: memoise a ground pure call's ordered result bag (keyed by its printed form). A functor
        // with runtime rules is version-keyed (see runtimeFunctorPure); a purely-static functor keeps the
        // plain key and the original fast path unchanged.
        let eligible = false;
        let key = "";
        if (tabling && wApp.ground && keyWellFormed(wApp)) {
          if (cur2.world.selfRules.has(op)) {
            if (runtimeFunctorPure(env, cur2.world, op)) {
              eligible = true;
              key = tableKey(wApp) + "@v" + rulesVersion(cur2.world.selfRules.get(op));
            }
          } else if (staticPure) {
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
          { stack: atomToStack(expr([sym("eval"), wApp]), null), bnd: lbnd },
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
            const pb = mergeRestrict(queryVars, partB, p[1]);
            if (eligible) pendingKeys.push(key);
            la = p[0];
            lbnd = pb;
            lst = cur2;
            // p[0] is operator-headed (opOf check) and instantiate preserves the head, so this stays an
            // expression headed by a symbol, exactly what the loop top reads as `lw.items[0]`.
            lw = instantiate(lbnd, la) as ExprAtom;
            continue reduceTrampoline;
          }
        }
        for (const p of pairs) {
          const pb = mergeRestrict(queryVars, partB, p[1]);
          if (atomEq(p[0], notReducibleA) || atomEq(p[0], wApp)) {
            // wApp did not reduce (a constructor application / data term). Cache a ground one so the next
            // visit short-circuits instead of re-walking it.
            if (wApp.ground) evaluatedAtoms.add(wApp);
            out.push([wApp, partB]);
          } else if (opReturnsAtom && !isEmbeddedOp(p[0])) {
            out.push([p[0], pb]);
          } else {
            const [more, st4] = yield* mettaEvalG(env, fuel - 1, cur2, pb, p[0]);
            cur2 = st4;
            for (const m of more) {
              out.push([m[0], mergeRestrict(queryVars, pb, m[1])]);
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
      { stack: atomToStack(expr([sym("eval"), w]), null), bnd },
    ]);
    const reduced = ruleRes.filter((p) => !atomEq(p[0], w) && !atomEq(p[0], notReducibleA));
    if (reduced.length === 0) {
      const [tupleRes, st2] = yield* interpretLoopG(env, fuel, st1, [
        {
          stack: atomToStack(
            expr([sym("eval"), expr([sym("interpret-tuple"), w, sym("&self")])]),
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
    { stack: atomToStack(expr([sym("eval"), w]), null), bnd },
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
function stackOverflowResult(st: St, bnd: Bindings, a: Atom): [Array<[Atom, Bindings]>, St] {
  return [[[expr([sym("Error"), instantiate(bnd, a), sym("StackOverflow")]), bnd]], st];
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
    if (isNativeStackOverflow(e)) return stackOverflowResult(st, bnd, a);
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
    if (isNativeStackOverflow(e)) return stackOverflowResult(st, bnd, a);
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
