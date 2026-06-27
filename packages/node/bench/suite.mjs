// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Deopt-aware benchmark suite (mitata) for the MeTTa TS hot paths. Pure TypeScript, no native.
// Run after building core: `node packages/node/bench/suite.mjs`
import { run, bench, group, summary } from "mitata";
import {
  runProgram,
  matchAtoms,
  buildEnv,
  evalAtom,
  stdTable,
  sym,
  variable,
  expr,
  gint,
  parseAll,
  standardTokenizer,
  preludeAtoms,
} from "../../core/dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const tk = standardTokenizer();
const CORPUS = resolve(process.cwd(), "corpus");
const corpus = readdirSync(CORPUS)
  .filter((f) => f.endsWith(".metta") && f !== "c2_spaces_kb.metta")
  .map((f) => readFileSync(resolve(CORPUS, f), "utf8"));

// Hot-path microbenchmarks
const deep = expr([variable("x"), expr([variable("y"), sym("a")]), gint(3)]);
const deepT = expr([sym("p"), expr([sym("q"), sym("a")]), gint(3)]);

group("matcher", () => {
  summary(() => {
    bench("matchAtoms (nested, binds 2 vars)", () => matchAtoms(deep, deepT));
    bench("matchAtoms (symbol mismatch)", () => matchAtoms(sym("a"), sym("b")));
  });
});

// A space with 1000 facts, query one
const facts = Array.from({ length: 1000 }, (_, i) => expr([sym("Edge"), gint(i), gint(i + 1)]));
const big = buildEnv([...preludeAtoms(), ...facts], stdTable());
const query = expr([sym("match"), sym("&self"), expr([sym("Edge"), gint(500), variable("y")]), variable("y")]);
group("space", () => {
  bench("match over 1000-atom space", () => evalAtom(big, query));
});

// Evaluation
const fibEnv = buildEnv(
  [
    ...preludeAtoms(),
    ...parseAll(
      "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))",
      tk,
    ).map((t) => t.atom),
  ],
  stdTable(),
);
const fib15 = parseAll("(fib 15)", tk)[0].atom;
group("eval", () => {
  bench("fib(15) (~1.2k recursive calls)", () => evalAtom(fibEnv, fib15));
  bench("stdlib load + (+ 1 2)", () => runProgram("!(+ 1 2)"));
});

group("oracle", () => {
  bench("full 270-assertion corpus", () => {
    for (const src of corpus) runProgram(src);
  });
});

await run();
