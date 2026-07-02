// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Parallel branch evaluation for `hyperpose` on Node `worker_threads`. PeTTa's `hyperpose` forks OS
// threads; cooperative concurrency (par/race) cannot, because a branch that compiles to a native loop runs
// synchronously and never yields. Each branch is a self-contained pure computation (the program's rules plus
// one branch expression), so it runs in its own worker. The main thread blocks on an Atomics counter, which
// fits the CLI's synchronous driver. `firstOnly` (for `(once (hyperpose …))`) returns when one branch
// produces a result and cancels the rest, matching `once` over forked threads. Node-only: the browser has no
// worker_threads.
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";

// The worker builds an env from the program's rule source, evaluates one branch, and writes its results
// (each atom formatted to source) into its slice of the shared buffer as a JSON string, then signals.
const WORKER_SRC = `
const { workerData } = require("node:worker_threads");
const { corePath, rulesSrc, branchSrc, sab, base, cap, fuel } = workerData;
const view = new Int32Array(sab);
(async () => {
  try {
    const m = await import(corePath);
    const r = m.runProgram(rulesSrc + "\\n!" + branchSrc, fuel);
    const last = r[r.length - 1];
    const out = JSON.stringify((last && last.results ? last.results : []).map((a) => m.format(a)));
    if (out.length > cap) { Atomics.store(view, base, -1); }
    else {
      for (let i = 0; i < out.length; i++) view[base + 2 + i] = out.charCodeAt(i);
      Atomics.store(view, base + 1, out.length);
      Atomics.store(view, base, 1);
    }
  } catch (e) {
    Atomics.store(view, base, -1); // import failure, fuel exhaustion, anything: this branch bailed
  } finally {
    // Always signal completion, even on a caught failure, so the main thread's Atomics.wait cannot block
    // forever waiting for a branch that already errored.
    Atomics.add(view, 0, 1);
    Atomics.notify(view, 0);
  }
})();
`;

const CAP = 16384; // ints (chars) reserved per branch for its formatted-result JSON; overflow -> bail

/** Evaluate each branch source (with the shared `rulesSrc` prelude) in its own worker. Returns, per branch,
 *  the list of formatted result atoms, or `null` if the branch errored, overflowed the buffer, or was not
 *  read under `firstOnly` because an earlier branch already won. */
export function evalBranchesParallel(
  corePath: string,
  rulesSrc: string,
  branchSrcs: readonly string[],
  firstOnly: boolean,
  fuel: number,
): (string[] | null)[] {
  const n = branchSrcs.length;
  const region = 2 + CAP; // [status, len, chars...] per branch; status 0=pending, 1=done, -1=bail
  const sab = new SharedArrayBuffer((1 + n * region) * 4);
  const view = new Int32Array(sab);
  const workers = branchSrcs.map(
    (br, i) =>
      new Worker(WORKER_SRC, {
        eval: true,
        workerData: {
          corePath,
          rulesSrc,
          branchSrc: br,
          sab,
          base: 1 + i * region,
          cap: CAP,
          fuel,
        },
      }),
  );
  const out: (string[] | null)[] = new Array(n).fill(null);
  const read = (i: number): string[] | null | undefined => {
    const base = 1 + i * region;
    const status = Atomics.load(view, base);
    if (status === 0) return undefined; // still pending
    if (status === -1) return null; // errored / overflowed
    const len = Atomics.load(view, base + 1);
    let s = "";
    for (let j = 0; j < len; j++) s += String.fromCharCode(view[base + 2 + j]!);
    return JSON.parse(s) as string[];
  };
  // A branch that dies outside the worker's finally (e.g. the runtime is killed) would never bump the
  // counter. Cap each wait so the main thread cannot block forever if every remaining branch hangs.
  const WAIT_MS = 60_000;
  let done = false;
  while (!done) {
    const prev = Atomics.load(view, 0);
    for (let i = 0; i < n; i++) {
      if (out[i] !== null) continue;
      const r = read(i);
      if (r === undefined) continue;
      out[i] = r;
      // Under `once`, the lowest-index branch with a non-empty result wins (branch order, matching
      // sequential `once`); an errored branch (null) or an empty result does not win, so keep scanning.
      if (firstOnly && r !== null && r.length > 0) {
        done = true;
        break;
      }
    }
    if (Atomics.load(view, 0) >= n) done = true; // every branch finished
    if (
      !done &&
      Atomics.wait(view, 0, prev, WAIT_MS) === "timed-out" &&
      Atomics.load(view, 0) === prev
    )
      break; // no branch progressed in WAIT_MS: a worker is wedged, return what we have
  }
  for (const w of workers) void w.terminate();
  return out;
}

/** Build the `RunOptions.parEvalImpl` hook the core runner calls for `(once (hyperpose …))`. Resolves the
 *  built `@metta-ts/core` entry once (the worker re-imports it) and binds the step ceiling. */
export function makeParEvalImpl(
  fuel: number,
): (rulesSrc: string, branchSrcs: string[], firstOnly: boolean) => (string[] | null)[] {
  const corePath = createRequire(import.meta.url).resolve("@metta-ts/core");
  return (rulesSrc, branchSrcs, firstOnly) =>
    evalBranchesParallel(corePath, rulesSrc, branchSrcs, firstOnly, fuel);
}
