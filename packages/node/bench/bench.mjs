// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Performance benchmark for the MeTTa TS interpreter (pure TypeScript, no native, no WASM).
// Run after building core: `node packages/node/bench/bench.mjs`
import { runProgram } from "../../core/dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function bench(name, f, iters = 1) {
  for (let i = 0; i < 3; i++) f(); // warmup
  const t = performance.now();
  for (let i = 0; i < iters; i++) f();
  const ms = (performance.now() - t) / iters;
  console.log(name.padEnd(40), ms.toFixed(2) + " ms");
}

bench("stdlib parse+load + (+ 1 2)", () => runProgram("!(+ 1 2)"), 50);

const fib =
  "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib 18)";
bench("fib(18) naive double-recursion", () => runProgram(fib), 5);

const CORPUS = resolve(process.cwd(), "corpus");
const files = readdirSync(CORPUS).filter((f) => f.endsWith(".metta") && f !== "c2_spaces_kb.metta");
bench("full 270-assertion oracle (22 files)", () => {
  for (const f of files) runProgram(readFileSync(resolve(CORPUS, f), "utf8"));
});

console.log("\nnode " + process.version + " | pure TypeScript, no native, no WASM");
