// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
// Algorithmic benchmarks (min/median over N runs) for the naive-recursion class PeTTa ships as
// examples. Run after building core: `node packages/node/bench/perf.mjs`.
import { runProgram } from "../../core/dist/index.js";

const FIB = "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))";
const FACT = "(= (fact $n) (if (< $n 1) 1 (* $n (fact (- $n 1)))))";
const ACK =
  "(= (ack $m $n) (if (== $m 0) (+ $n 1) (if (== $n 0) (ack (- $m 1) 1) (ack (- $m 1) (ack $m (- $n 1))))))";

function timeOnce(src) {
  const t = performance.now();
  runProgram(src);
  return performance.now() - t;
}

function report(name, src, runs) {
  try {
    runProgram(src); // warmup
    const ts = [];
    for (let i = 0; i < runs; i++) ts.push(timeOnce(src));
    ts.sort((a, b) => a - b);
    const min = ts[0];
    const median = ts[Math.floor(ts.length / 2)];
    console.log(name.padEnd(34), "min", min.toFixed(1) + "ms", " median", median.toFixed(1) + "ms");
  } catch (e) {
    console.log(name.padEnd(34), "ERROR:", e.message);
  }
}

// Note: linear recursion depth is bounded by the native JS call stack (a few hundred), a separate
// limitation from tabling. fib's overlapping-subproblem recursion stays shallow once memoised.
console.log("Naive recursion (untabled or tabled, depending on the default):");
report("fib(25)", `${FIB}\n!(fib 25)`, 5);
report("fib(28)", `${FIB}\n!(fib 28)`, 5);
report("factorial(100)", `${FACT}\n!(fact 100)`, 20);
report("ackermann(2,3)", `${ACK}\n!(ack 2 3)`, 20);
console.log("\nLarge-integer exactness:");
report("fib(90) value", `${FIB}\n!(fib 90)`, 1);
console.log("node " + process.version + " | pure TypeScript, no native, no WASM");
