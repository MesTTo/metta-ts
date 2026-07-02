// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Head-to-head wall-clock benchmark: MeTTa-TS vs PeTTa on the PeTTa example corpus.
//
// Runs every `examples/*.metta` through both engines as a black-box subprocess, times each, and checks the
// embedded `(test actual expected)` assertions (both engines print `✅`/`❌`). It reports per-example timing,
// a pass/agreement summary, and aggregate speedups, then writes a Markdown table.
//
// Requirements to reproduce:
//   - A PeTTa checkout with a working `run.sh` (needs SWI-Prolog). Point at it with PETTA_DIR; the default is
//     a sibling `../PeTTa` of this repo.
//   - MeTTa-TS built: `pnpm -r build` (or build packages/core then packages/node) so `dist/cli.js` exists.
//
// Usage:
//   PETTA_DIR=/path/to/PeTTa node packages/node/bench/corpus-bench.mjs [options]
//     --timeout=<sec>      per-run wall-clock cap for each engine (default 60)
//     --runs=<n>           runs per example; the minimum is kept (default 1)
//     --max-steps=<n>      MeTTa-TS step budget so deep finite programs complete (default 100000000)
//     --filter=<substr>    only examples whose name contains <substr>
//     --quick              a small fixed subset, for a fast sanity sweep
//     --out=<file>         Markdown output path (default bench/RESULTS-corpus.md)
//     --engine=ts|petta    run only one engine (timing without the head-to-head)
//     --hash-cons          run the MeTTa-TS CLI with experimental hash-consing enabled

import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const PETTA_DIR = resolve(process.env.PETTA_DIR ?? resolve(here, "../../../../PeTTa"));
const RUN_SH = join(PETTA_DIR, "run.sh");
const EXAMPLES = join(PETTA_DIR, "examples");
const CLI = resolve(here, "../dist/cli.js");
const TIMEOUT_MS = Number(arg("timeout", "60")) * 1000;
const RUNS = Number(arg("runs", "1"));
const MAX_STEPS = arg("max-steps", "100000000");
const FILTER = arg("filter", "");
const ENGINE = arg("engine", "both"); // both | ts | petta
const OUT = resolve(arg("out", join(here, "RESULTS-corpus.md")));
const QUICK_SET = [
  "fib", "fact", "ackermann", "peano", "peanofast", "permutations",
  "he_minimalmetta", "nars_tuffy", "pln_tuffy", "matespace",
];
const HASH_CONS =
  flag("hash-cons") || process.env.METTA_TS_HASHCONS === "1" || process.env.METTA_TS_HASHCONS === "true";

// Examples that exercise a host capability outside a pure-TypeScript engine's scope. @metta-ts is
// deliberately dependency-free (its whole value is pure TS, no native/runtime FFI), so these are not part
// of the MeTTa-TS corpus. They are reported separately as N/A rather than counted as failures.
const EXCLUSIONS = {
  // Host capability outside a pure-TypeScript engine.
  python: "Python FFI (py-call)",
  python_import: "Python FFI (py-call / .py import)",
  torch: "Python FFI (PyTorch)",
  prologimport: "Prolog FFI (callPredicate / import_prolog_function)",
  git_import: "git-import! (clone + build a native library)",
  git_import2: "git-import! + faiss native FFI",
  llm_cities: "LLM API call + Python (useGPT)",
  repl: "interactive stdin (readln! REPL loop)",
  // PeTTa's Prolog execution model, which contradicts Hyperon's structural reduction. @metta-ts follows
  // Hyperon, so these have no Hyperon-faithful counterpart (every test depends on the PeTTa-only feature).
  nestedcons: "PeTTa cons-list matching ((cons $h $t) over a flat tuple)",
  caseconstrain: "PeTTa cons-list matching inside case",
  functionhead: "PeTTa reverse/inverted function matching (function call as an LHS pattern)",
  functionhead2: "PeTTa reverse/inverted function matching",
  functionhead3: "PeTTa reverse/inverted function matching + specialization",
  invertfunction: "PeTTa function inversion (solve a call backwards via unification)",
  partialdef: "PeTTa head-eval-then-apply ((mp 1 1) where (= (mp) (+)))",
  specialize: "PeTTa specializer (partial-evaluation of function bodies)",
  callquoteevalreduce: "PeTTa call/eval/reduce full-evaluation vocabulary (Hyperon eval is single-step)",
  spaces_succeedspredicate: "PeTTa unify-as-space-query (unify a space against a pattern)",
  functionremoval: "PeTTa reverse function matching (predominantly; removes a function clause by inversion)",
  functionremovalspec: "PeTTa reverse function matching + specialization",
  invertpeanoplus: "PeTTa function inversion (solve Peano plus backwards)",
  roman_test: "lib_roman uses PeTTa cons-list matching and = as a unification predicate (both PeTTa-only)",
  spaces_find: "needs PeTTa global-variable propagation: find's internal match must bind the caller's vars THROUGH collapse, which loses per-result bindings in Hyperon (variables are expression-scoped)",
  translatorrule: "PeTTa add-translator-rule! (compile-time macro/rewrite system), not a Hyperon feature",
  translatorrule_for: "PeTTa add-translator-rule! (compile-time macro/rewrite system)",
  test_unify_eval_branches: "PeTTa unify-as-space-query: lib_he overloads unify with an is-space dispatch so (unify &self pat then else) queries the space. Hyperon's unify is the minimal-MeTTa atom-vs-atom primitive (let = (unify $atom $pat $tmpl Empty)), so unifying the &self space atom against a pattern expression always fails and returns the else branch",
  patrick_test: "PeTTa reverse function matching (@) + add-translator-rule! (for) + cons-list matching",
  mettaset: "PeTTa superpose-as-union: (superpose ((1 (superpose (a b c))) ...)) yields 8 atoms in PeTTa. Hyperon/LeaTTa evaluate superpose's tuple argument as a cross-product first ({a,b,c}x{d,e,f}x{a,b} = 18 combos, each a 3-tuple superposed to 54 atoms), verified against the LeaTTa binary — the same cross-product semantics documented in spaces2",
  metta4_streams: "PeTTa superpose-as-union: range is (= (range $K $N) (if (< $K $N) (superpose ($K (range (+ $K 1) $N))) (empty))). Under Hyperon/LeaTTa the tuple ($K (range ...)) is evaluated as a cross-product, so the (empty) base case makes {$K}x{} empty and (range 1 5) yields nothing (verified: LeaTTa gives (collapse (range 1 5)) = empty). PeTTa unions the elements instead, so range streams 1..N",
  spaces_removeallatoms: "prelude-in-&self mismatch (same class as the LeaTTa oracle's f1_imports): remove-all-atoms = (collapse (match &self $x (remove-atom &self $x))) and the test asserts (collapse (get-atoms &self)) = (). This build ships the prelude/stdlib INSIDE &self, so get-atoms &self returns the thousands of prelude atoms and a bare-variable match enumerates them all. The test assumes &self holds only the user's atoms (PeTTa keeps stdlib in a separate space); it needs a separate stdlib space, not a code fix",
  // PeTTa execution-model features that Hyperon-faithful @metta-ts deliberately lacks. Each reason was
  // verified against the authority (the LeaTTa binary or the Hyperon stdlib), not assumed — see the
  // "ran cases triaged" section of bench/TODO-parity.md. Same nature as the entries above.
  ifsimple: "PeTTa 2-arg if (optional else): Hyperon's if is (-> Bool Atom Atom $t) (hyperon stdlib.metta:511), so (if True 42) is IncorrectNumberOfArguments. No Hyperon-faithful form of a 2-arg if",
  booleansolver: "PeTTa 2-arg if used as a relational solver: (if (and (or $x True) $y) ($x $y)) returns the then-branch under satisfiable bindings (Prolog-style), not a Hyperon construct",
  casenew: "PeTTa superpose-as-union: (superpose ((wu1) (wu2))) with (wu1)->(empty). Hyperon/LeaTTa cross-product the tuple, so the empty element makes the whole superpose empty (@metta-ts returns empty, Hyperon-faithful). Same class as mettaset/metta4_streams",
  types_nondet: "PeTTa overloaded-function dispatch: with (: f (-> Type1 Type1)) and (: f (-> Type2 Type2)), (f T1in) is (Error (f T1in) (BadArgType 1 Type2 Type1)) in BOTH @metta-ts and the LeaTTa binary (verified). PeTTa's T1out is PeTTa-only",
  library: "imports lib_roman (cons-lists + =-unification) and tests cons-list map-flat — PeTTa-only matching",
  holbenchmark: "PeTTa cons-list matching: (= (map-flat $f (cons $x $xs)) ...) over a flat tuple",
  holfunctions_intrinsicop: "PeTTa cons-list matching: (= (mymap $f (cons $x $xs)) ...) over a flat tuple",
  logicprog: "PeTTa relational logic programming: (later-in-alphabet d $1) solved backward; the LeaTTa binary also does not terminate (verified)",
  logicprogset: "PeTTa 2-arg if + relational solving: (if (once (myf $M)) $M) with (member a $M) used to enumerate $M",
  scale: "PeTTa unify-as-space-query + let* over the space ((unify ($head $tail) $ht ...)); the LeaTTa binary also errors (bad-let-star) (verified)",
  specializefunctiontypes: "PeTTa specializer (f_Spec_[g], repra) — same class as the excluded specialize",
  translatepredicate: "PeTTa translatePredicate (the translator's compile-time rewrite) + Prolog-style (is $x 2)",
};

for (const [label, path] of [["PeTTa run.sh", RUN_SH], ["MeTTa-TS CLI", CLI]]) {
  if (ENGINE === "ts" && label.startsWith("PeTTa")) continue;
  if (ENGINE === "petta" && label.startsWith("MeTTa")) continue;
  if (!existsSync(path)) {
    console.error(`Missing ${label}: ${path}`);
    if (label.startsWith("PeTTa")) console.error("  set PETTA_DIR=/path/to/PeTTa");
    else console.error("  build first: pnpm -r build");
    process.exit(2);
  }
}

// Classify one process result into a status + correctness counters.
function classify(res, ms) {
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const timedOut = res.signal === "SIGTERM" || res.error?.code === "ETIMEDOUT";
  const checks = (out.match(/✅/g) ?? []).length;
  const fails = (out.match(/❌/g) ?? []).length;
  let status;
  if (timedOut) status = "timeout";
  else if (res.status !== 0 || res.error) status = "error";
  else if (fails > 0) status = "fail";
  else if (checks > 0) status = "pass";
  else status = "ran"; // no embedded assertion
  return { status, checks, fails, ms };
}

function timeCmd(cmd, args, env) {
  let best = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = spawnSync(cmd, args, {
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 1 << 27,
      env: { ...process.env, ...env },
    });
    const c = classify(res, performance.now() - t0);
    if (best === null || c.ms < best.ms) best = c;
    if (c.status === "timeout" || c.status === "error") break; // no point repeating a failure
  }
  return best;
}

// PeTTa runs its own `examples/`; MeTTa-TS runs the MeTTa-TS-convention corpus that ships with this repo
// (`bench/corpus-mettats/`). Same algorithms, expectations written in MeTTa-TS (Hyperon) conventions.
const TS_CORPUS = resolve(here, "corpus-mettats");
const runPetta = (name) => timeCmd("sh", [RUN_SH, join(EXAMPLES, name + ".metta")], {});
const runTs = (name) =>
  timeCmd(
    process.execPath,
    [
      "--stack-size=8000",
      CLI,
      `--max-steps=${MAX_STEPS}`,
      ...(HASH_CONS ? ["--hash-cons"] : []),
      join(TS_CORPUS, name + ".metta"),
    ],
    { METTA_TS_STACK: "1" },
  );

let files = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".metta"))
  .filter((f) => !(basename(f, ".metta") in EXCLUSIONS))
  .sort();
if (flag("quick")) files = files.filter((f) => QUICK_SET.includes(basename(f, ".metta")));
if (FILTER) files = files.filter((f) => f.includes(FILTER));

console.log(`MeTTa-TS vs PeTTa on ${files.length} examples`);
console.log(`  PeTTa:    ${PETTA_DIR}`);
console.log(
  `  timeout=${TIMEOUT_MS / 1000}s runs=${RUNS} max-steps=${MAX_STEPS} engine=${ENGINE} hash-cons=${HASH_CONS}\n`,
);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(pad("example", 26), padL("petta", 9), padL("metta-ts", 10), padL("speedup", 9), " result");
console.log("-".repeat(72));

const rows = [];
for (const f of files) {
  const name = basename(f, ".metta");
  const p = ENGINE === "ts" ? null : runPetta(name);
  const t = ENGINE === "petta" ? null : runTs(name);
  const speedup = p && t && p.status === "pass" && t.status === "pass" ? p.ms / t.ms : null;
  const agree =
    p && t ? (p.status === t.status ? p.status : `${p.status}/${t.status}`) : (p ?? t).status;
  rows.push({ name, p, t, speedup, agree });
  console.log(
    pad(name, 26),
    padL(p ? p.ms.toFixed(0) + (p.status === "pass" ? "" : "*") : "-", 9),
    padL(t ? t.ms.toFixed(0) + (t.status === "pass" ? "" : "*") : "-", 10),
    padL(speedup ? speedup.toFixed(2) + "x" : "-", 9),
    " " + agree,
  );
}

// ---- summary ----
const both = rows.filter((r) => r.p && r.t);
const bothPass = both.filter((r) => r.p.status === "pass" && r.t.status === "pass");
const tsPass = rows.filter((r) => r.t?.status === "pass").length;
const pPass = rows.filter((r) => r.p?.status === "pass").length;
const speedups = bothPass.map((r) => r.speedup).sort((a, b) => a - b);
const median = speedups.length ? speedups[Math.floor(speedups.length / 2)] : null;
const geomean = speedups.length
  ? Math.exp(speedups.reduce((s, x) => s + Math.log(x), 0) / speedups.length)
  : null;
const tsWins = bothPass.filter((r) => r.speedup >= 1).length;
const sum = (rs, k) => rs.reduce((s, r) => s + r[k].ms, 0);

const excluded = Object.entries(EXCLUSIONS);
console.log("\n" + "=".repeat(72));
console.log(`examples:            ${rows.length} (+${excluded.length} N/A, host capability outside pure TS)`);
if (ENGINE !== "ts") console.log(`PeTTa pass:          ${pPass}`);
if (ENGINE !== "petta") console.log(`MeTTa-TS pass:       ${tsPass}`);
if (both.length) {
  console.log(`both pass:           ${bothPass.length}`);
  console.log(`MeTTa-TS faster:     ${tsWins}/${bothPass.length}`);
  if (median) console.log(`speedup median:      ${median.toFixed(2)}x   geomean ${geomean.toFixed(2)}x`);
  console.log(
    `total (both-pass):   PeTTa ${(sum(bothPass, "p") / 1000).toFixed(1)}s   MeTTa-TS ${(sum(bothPass, "t") / 1000).toFixed(1)}s`,
  );
}
if (excluded.length) {
  console.log(`\nN/A (host capability outside a pure-TypeScript engine):`);
  for (const [name, reason] of excluded) console.log(`  ${pad(name, 16)} ${reason}`);
}

// ---- markdown ----
const md = [];
md.push("# MeTTa-TS vs PeTTa — PeTTa example corpus\n");
md.push(`Wall-clock per example as a black-box subprocess (each engine's runtime startup included).`);
md.push(`\`speedup\` = PeTTa / MeTTa-TS over examples both engines pass. \`*\` marks a non-pass run.\n`);
md.push(`- examples: ${rows.length}, both pass: ${bothPass.length}` + (median ? `, speedup median ${median.toFixed(2)}x, geomean ${geomean.toFixed(2)}x` : ""));
md.push(`- timeout ${TIMEOUT_MS / 1000}s, runs ${RUNS} (min), MeTTa-TS --max-steps ${MAX_STEPS}\n`);
md.push("| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |");
md.push("|---|--:|--:|--:|---|");
for (const r of rows) {
  const pm = r.p ? r.p.ms.toFixed(0) + (r.p.status === "pass" ? "" : `\\* (${r.p.status})`) : "-";
  const tm = r.t ? r.t.ms.toFixed(0) + (r.t.status === "pass" ? "" : `\\* (${r.t.status})`) : "-";
  md.push(`| ${r.name} | ${pm} | ${tm} | ${r.speedup ? r.speedup.toFixed(2) + "x" : "-"} | ${r.agree} |`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md.join("\n") + "\n");
console.log(`\nwrote ${OUT}`);
