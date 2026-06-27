// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Program runner: sequential top-to-bottom evaluation of a MeTTa program, a faithful port of
// LeaTTa `Stdlib.lean` (`evalSequential`, `oracleReport`). Each `!`-query is evaluated against the
// prelude plus the KB atoms that precede it; world effects (add-atom, bind!, state) thread forward.
import { type Atom, gint, gfloat, gbool } from "./atom";
import { Tokenizer } from "./tokenizer";
import { parseAll, format } from "./parser";
import {
  type St,
  type MinEnv,
  type AsyncGroundFn,
  buildEnv,
  addAtomToEnv,
  initSt,
  mettaEval,
  mettaEvalAsync,
} from "./eval";
import { stdTable } from "./builtins";
import { analyzePurity } from "./tabling";
import { PRELUDE_SRC } from "./prelude";
import { withBuiltinModules } from "./extensions";
import { stdlibAtoms } from "./stdlib";
import { pettaStdlibAtoms } from "./petta-stdlib";

/** The standard tokenizer: integer/float literals and the `True`/`False` grounded booleans. */
export function standardTokenizer(): Tokenizer {
  const t = new Tokenizer();
  t.register(/^-?\d+$/, (s) => gint(BigInt(s)));
  t.register(/^-?\d+\.\d+$/, (s) => gfloat(Number(s)));
  // Scientific-notation floats (Hyperon arithmetics.rs: `[\-\+]?\d+(\.\d+)?[eE][\-\+]?\d+`), e.g. 1e-3,
  // 1.5e2, -2e10. Registered after the plain int/decimal forms, which it does not overlap.
  t.register(/^-?\d+(\.\d+)?[eE][-+]?\d+$/, (s) => gfloat(Number(s)));
  t.register(/^True$/, () => gbool(true));
  t.register(/^False$/, () => gbool(false));
  return t;
}

let preludeCache: Atom[] | undefined;
/** The prelude's atoms (parsed once and cached). */
export function preludeAtoms(): Atom[] {
  if (preludeCache === undefined)
    preludeCache = parseAll(PRELUDE_SRC, standardTokenizer())
      .filter((t) => !t.bang)
      .map((t) => t.atom);
  return preludeCache;
}

export interface QueryResult {
  readonly query: Atom;
  readonly results: Atom[];
}

export const DEFAULT_FUEL = 100_000;
const DEFAULT_TABLING = true;

/** A fresh environment preloaded with the prelude and standard library, with `imports` seeded by the
 *  built-in extension modules (e.g. `concurrency`). The env is built once and extended per non-bang
 *  atom; built-in modules apply only when a program actually `(import! ...)`s them, so the Hyperon
 *  oracle baseline is unaffected. */
function buildDefaultEnv(imports: Map<string, Atom[]>, tabling: boolean): MinEnv {
  const env: MinEnv = buildEnv(
    [...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms()],
    stdTable(),
  );
  env.imports = withBuiltinModules(imports);
  if (tabling) {
    env.table = new Map();
    env.pureFunctors = analyzePurity(env);
    env.compiled = new Map();
    env.compileDirty = true;
  }
  return env;
}

export interface RunOptions {
  readonly tabling?: boolean;
  // Initial interpreter stack-depth bound; 0 (the default) means unlimited, matching Hyperon. A program can
  // tighten it in-language with `(pragma! max-stack-depth N)`. This is the embedder's knob: it sets the
  // starting bound but is not a hard ceiling; the `fuel` argument is the resource ceiling. Left to the
  // developer rather than hardcoded so a host embedding untrusted programs can pick its own policy.
  readonly maxStackDepth?: number;
  // Optional parallel branch evaluator for `(once (hyperpose …))`, supplied by the Node host (a
  // worker_threads pool; see packages/node/src/par-hyperpose.ts). Given the program's rule source, the
  // formatted branch atoms, and whether to stop at the first result, it returns each branch's results as
  // formatted source strings (or `null` for a branch that errored or, under `firstOnly`, lost the race).
  // Absent in the browser, where `hyperpose` falls back to sequential evaluation.
  readonly parEvalImpl?: (
    rulesSrc: string,
    branchSrcs: string[],
    firstOnly: boolean,
  ) => (string[] | null)[];
}

/** Evaluate a parsed program sequentially. `imports` backs `import!` (pre-read by the caller). */
export function evalSequential(
  atoms: readonly { atom: Atom; bang: boolean }[],
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  const out: QueryResult[] = [];
  let st: St = initSt();
  if (opts.maxStackDepth !== undefined) st.world.maxStackDepth = opts.maxStackDepth;
  const env = buildDefaultEnv(imports, opts.tabling ?? DEFAULT_TABLING);
  if (opts.parEvalImpl !== undefined) {
    // Re-evaluate a branch in a worker from the program's static (non-`!`) rules; a pure ground branch
    // references only those, so this reproduces the in-line evaluation. Result strings are parsed back.
    const rulesSrc = atoms
      .filter((a) => !a.bang)
      .map((a) => format(a.atom))
      .join("\n");
    const impl = opts.parEvalImpl;
    env.parEval = (branchSrcs, firstOnly) =>
      impl(rulesSrc, branchSrcs, firstOnly).map((r) =>
        r === null ? null : r.flatMap((s) => parseAll(s, standardTokenizer()).map((p) => p.atom)),
      );
  }
  for (const { atom, bang } of atoms) {
    if (!bang) {
      addAtomToEnv(env, atom);
      continue;
    }
    const [pairs, st2] = mettaEval(env, fuel, st, [], atom);
    st = st2;
    out.push({ query: atom, results: pairs.map((p) => p[0]) });
  }
  return out;
}

/** Parse and run a MeTTa source string sequentially. */
export function runProgram(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  return evalSequential(parseAll(src, standardTokenizer()), fuel, imports, opts);
}

/** Async sequential evaluation: like `runProgram`, but `!`-queries are awaited, so async grounded
 *  operations (registered in `asyncOps`) can perform I/O. Sync programs give identical results to
 *  `runProgram`; the async path only differs when an async op is actually reached. */
export async function runProgramAsync(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
): Promise<QueryResult[]> {
  const parsed = parseAll(src, standardTokenizer());
  const env = buildDefaultEnv(imports, false);
  for (const [k, v] of asyncOps) env.agt.set(k, v);
  const out: QueryResult[] = [];
  let st: St = initSt();
  for (const { atom, bang } of parsed) {
    if (!bang) {
      addAtomToEnv(env, atom);
      continue;
    }
    const [pairs, st2] = await mettaEvalAsync(env, fuel, st, [], atom);
    st = st2;
    out.push({ query: atom, results: pairs.map((p) => p[0]) });
  }
  return out;
}

/** Module names referenced by top-level `import!` statements (so a caller can pre-read them). */
export function collectImports(src: string): string[] {
  const out: string[] = [];
  for (const { atom } of parseAll(src, standardTokenizer())) {
    if (
      atom.kind === "expr" &&
      atom.items.length === 3 &&
      atom.items[0]!.kind === "sym" &&
      atom.items[0]!.name === "import!" &&
      atom.items[2]!.kind === "sym"
    )
      out.push((atom.items[2] as { name: string }).name);
  }
  return out;
}

/** An oracle assertion passes iff its query evaluates to exactly the unit atom `()`. */
export function isOraclePass(r: QueryResult): boolean {
  return (
    r.results.length === 1 && r.results[0]!.kind === "expr" && r.results[0]!.items.length === 0
  );
}

/** Run a test file and report pass/fail counts and the failing queries. */
export function oracleReport(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
): { total: number; passed: number; failures: string[] } {
  const results = runProgram(src, fuel, imports);
  let passed = 0;
  const failures: string[] = [];
  for (const r of results) {
    if (isOraclePass(r)) passed++;
    else
      failures.push(
        `FAIL: ${format(r.query)}\n   got: ${r.results.map(format).join(" ") || "(no results)"}`,
      );
  }
  return { total: results.length, passed, failures };
}
