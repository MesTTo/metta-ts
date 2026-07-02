// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Data-parallel matcher over a flat interned KB. KB Int32 tokens live in a SharedArrayBuffer. A warm
// worker_threads pool claims fact offsets via an Atomics work-stealing counter and scans with zero
// copying; the immutable shared region is data-race-free, so the hot path uses plain reads. Node-first;
// the same Int32 layout ports to Web Workers + SAB under cross-origin isolation later.
//
// Use this only for a large KB scanned by a non-selective query. A keyed query is already ~constant-time
// via the in-memory argument index. Best fit: full scans and unbound-head patterns over millions of atoms.
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { type Atom, type FlatKB, encodePattern, decodeAt } from "@metta-ts/core";

// Worker code: pure integer matching over the shared token array. Atom decoding needs the interner,
// which stays on the main thread. Offsets are claimed via an Atomics work-stealing counter.
const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
const tokens = new Int32Array(workerData.tokensSAB);
const offsets = new Int32Array(workerData.offsetsSAB);
const counter = new Int32Array(workerData.counterSAB);
const numFacts = workerData.numFacts;
const T_ARITY = 0, T_SYMBOL = 1, T_NEWVAR = 2, T_VARREF = 3;
const tg = (t) => (t >>> 28) & 0xf, pl = (t) => t & 0x0fffffff;
function subLen(tk, pos) {
  const t = tk[pos];
  if (tg(t) === T_ARITY) { let l = 1, p = pos + 1; for (let i = 0; i < pl(t); i++) { const x = subLen(tk, p); l += x; p += x; } return l; }
  return 1;
}
function rangeEq(tk, as, bs) {
  const l = subLen(tk, as); if (l !== subLen(tk, bs)) return false;
  for (let i = 0; i < l; i++) if (tk[as + i] !== tk[bs + i]) return false; return true;
}
function matchAt(pat, fact, fs) {
  const binds = []; let vc = 0, pp = 0, fp = fs;
  function go() {
    const pt = pat[pp], ptag = tg(pt);
    if (ptag === T_NEWVAR) { const l = subLen(fact, fp); binds[vc++] = [fp, fp + l]; pp++; fp += l; return true; }
    if (ptag === T_VARREF) { const ref = binds[pl(pt)]; if (!ref) return false; if (!rangeEq(fact, ref[0], fp)) return false; pp++; fp += subLen(fact, fp); return true; }
    if (ptag === T_SYMBOL) { if (fact[fp] !== pt) return false; pp++; fp++; return true; }
    if (fact[fp] !== pt) return false; const n = pl(pt); pp++; fp++;
    for (let i = 0; i < n; i++) if (!go()) return false; return true;
  }
  return go() ? binds : null;
}
parentPort.on("message", (pat) => {
  const out = [];
  for (;;) {
    const idx = Atomics.add(counter, 0, 1);
    if (idx >= numFacts) break;
    const binds = matchAt(pat, tokens, offsets[idx]);
    if (binds) out.push(binds);   // binds: array indexed by de Bruijn id -> [start, end)
  }
  parentPort.postMessage(out);
});
`;

/** A worker-pool, SharedArrayBuffer-backed parallel matcher over a {@link FlatKB}. Build it once from a
 *  KB, reuse the warm pool across queries, and `close()` when done. */
export class ParallelFlatMatcher {
  private readonly kb: FlatKB;
  private readonly tokens: Int32Array;
  private readonly counter: Int32Array;
  private readonly numFacts: number;
  private readonly workers: Worker[];
  // All workers share one work-stealing counter, so calls must not overlap; serialize them on a queue.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(kb: FlatKB, workerCount = Math.max(1, availableParallelism() - 1)) {
    this.kb = kb;
    const toks = kb.tokenArray;
    const offs = kb.factOffsets;
    this.numFacts = offs.length;

    const tokensSAB = new SharedArrayBuffer(toks.length * 4);
    this.tokens = new Int32Array(tokensSAB);
    this.tokens.set(toks);
    const offsetsSAB = new SharedArrayBuffer(Math.max(1, offs.length) * 4);
    new Int32Array(offsetsSAB).set(offs);
    const counterSAB = new SharedArrayBuffer(4);
    this.counter = new Int32Array(counterSAB);

    this.workers = Array.from(
      { length: Math.max(1, workerCount) },
      () =>
        new Worker(WORKER_SRC, {
          eval: true,
          workerData: { tokensSAB, offsetsSAB, counterSAB, numFacts: this.numFacts },
        }),
    );
  }

  /** Match `pattern` across the KB in parallel. Returns one binding map (variable name -> atom) per
   *  match, identical (up to order) to the single-threaded `FlatKB.match`. Concurrent calls are
   *  serialized internally (the workers share one counter), so it is safe to call without awaiting. */
  async match(pattern: Atom): Promise<Array<Map<string, Atom>>> {
    const run = this.queue.then(() => this.matchOne(pattern));
    this.queue = run.catch(() => undefined); // keep the chain alive even if a call rejects
    return run;
  }

  private async matchOne(pattern: Atom): Promise<Array<Map<string, Atom>>> {
    const enc = encodePattern(pattern, this.kb.interner);
    if (enc === null) return [];
    Atomics.store(this.counter, 0, 0); // reset the work-stealing cursor; postMessage publishes it
    const replies = this.workers.map(
      (w) =>
        // Reject on worker error or early exit, so a crashing worker fails the match instead of leaving
        // `Promise.all` and the serialized queue hung forever. Remove all listeners when any fires so a
        // long-lived worker does not accumulate them across calls.
        new Promise<Array<Array<[number, number]>>>((res, rej) => {
          const onMsg = (m: Array<Array<[number, number]>>): void => (cleanup(), res(m));
          const onErr = (e: Error): void => (cleanup(), rej(e));
          const onExit = (code: number): void => (
            cleanup(),
            rej(new Error(`match worker exited (${code})`))
          );
          const cleanup = (): void => {
            w.off("message", onMsg);
            w.off("error", onErr);
            w.off("exit", onExit);
          };
          w.on("message", onMsg);
          w.on("error", onErr);
          w.on("exit", onExit);
        }),
    );
    for (const w of this.workers) w.postMessage(enc.tokens);
    const perWorker = await Promise.all(replies);

    const out: Array<Map<string, Atom>> = [];
    for (const matches of perWorker)
      for (const ranges of matches) {
        const m = new Map<string, Atom>();
        ranges.forEach((r, idx) =>
          m.set(enc.varNames[idx]!, decodeAt(this.tokens, r[0], this.kb.interner)[0]),
        );
        out.push(m);
      }
    return out;
  }

  /** Terminate the worker pool. */
  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
