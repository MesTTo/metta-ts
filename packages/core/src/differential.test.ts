// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  format,
  runProgram,
  setOutputSink,
  setRawSink,
  type QueryResult,
  type RunOptions,
} from "./index";
import { importsForBaseDir } from "./oracle-corpus";

const CORPUS_DIR = resolve(process.cwd(), "packages/node/bench/corpus-mettats");
const DIFF_FUEL = 100_000;
const WORKER_CAP = 1 << 20;
const requireForTest = createRequire(import.meta.url);
// These corpus programs are already tracked as non-terminating or Stage 4 symbolic-search outliers in
// the benchmark harness; Stage 1 verifies byte identity on the terminating corpus plus targeted slow cases.
const CORE_TIMEOUT_CORPUS = new Set([
  "matespace.metta",
  "matespace2.metta",
  "matespacefast.metta",
  "spaces_removeallatoms.metta",
  "tilepuzzle.metta",
]);
const WORKER_SRC = `
const { workerData } = require("node:worker_threads");
const view = new Int32Array(workerData.sab);
(async () => {
  try {
    const m = await import(workerData.coreUrl);
    m.setOutputSink(() => {});
    m.setRawSink(() => {});
    const rs = m.runProgram(
      workerData.rulesSrc + "\\n!" + workerData.branchSrc,
      workerData.fuel,
      new Map(),
      {
        experimental: {
          hashCons: workerData.hashCons,
          flatAtomspace: workerData.flatAtomspace,
        },
      },
    );
    const last = rs[rs.length - 1];
    const payload = JSON.stringify((last?.results ?? []).map((a) => m.format(a)));
    const base = workerData.base;
    if (payload.length > workerData.cap) {
      Atomics.store(view, base, -1);
    } else {
      for (let i = 0; i < payload.length; i++) view[base + 2 + i] = payload.charCodeAt(i);
      Atomics.store(view, base + 1, payload.length);
      Atomics.store(view, base, 1);
    }
  } catch {
    Atomics.store(view, workerData.base, -1);
  } finally {
    Atomics.add(view, 0, 1);
    Atomics.notify(view, 0);
  }
})();
`;

const ADVERSARIAL: Array<readonly [string, string]> = [
  ["duplicate-producing superpose", "(= (dup) (superpose (a a b)))\n!(dup)"],
  [
    "nested collapse",
    "!(collapse (superpose ((collapse (superpose (a b))) (collapse (superpose (a b))))))",
  ],
  ["same-head multi-match", "(p a 1)\n(p a 2)\n(p b 3)\n!(match &self (p a $x) $x)"],
  ["deep recursion", "(= (down $n) (if (== $n 0) Z (S (down (- $n 1)))))\n!(down 20)"],
  ["cyclic-binding unify", "!(unify $x (f $x) ok fail)"],
];

type PrintedResult = readonly [query: string, results: readonly string[]];
type Esbuild = {
  readonly buildSync: (options: {
    readonly bundle: boolean;
    readonly entryPoints: readonly string[];
    readonly format: "esm";
    readonly logLevel: "silent";
    readonly outfile: string;
    readonly platform: "node";
    readonly target: "node20";
  }) => void;
};

let bundledCoreUrl: string | undefined;

function currentCoreBundleUrl(): string {
  if (bundledCoreUrl !== undefined) return bundledCoreUrl;
  const outfile = resolve("/tmp", `metta-ts-hashcons-diff-core-${process.pid}.mjs`);
  mkdirSync(dirname(outfile), { recursive: true });
  const { buildSync } = requireForTest("esbuild") as Esbuild;
  buildSync({
    entryPoints: [resolve(process.cwd(), "packages/core/src/index.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  bundledCoreUrl = pathToFileURL(outfile).href;
  return bundledCoreUrl;
}

function readWorkerResult(view: Int32Array, base: number): string[] | null | undefined {
  const status = Atomics.load(view, base);
  if (status === 0) return undefined;
  if (status < 0) return null;
  const len = Atomics.load(view, base + 1);
  let payload = "";
  for (let i = 0; i < len; i++) payload += String.fromCharCode(view[base + 2 + i]!);
  return JSON.parse(payload) as string[];
}

function evalBranches(
  rulesSrc: string,
  branchSrcs: string[],
  firstOnly: boolean,
  hashCons: boolean,
  flatAtomspace: boolean,
): (string[] | null)[] {
  const region = 2 + WORKER_CAP;
  const sab = new SharedArrayBuffer((1 + branchSrcs.length * region) * 4);
  const view = new Int32Array(sab);
  const workers = branchSrcs.map(
    (branchSrc, i) =>
      new Worker(WORKER_SRC, {
        eval: true,
        workerData: {
          coreUrl: currentCoreBundleUrl(),
          rulesSrc,
          branchSrc,
          sab,
          base: 1 + i * region,
          cap: WORKER_CAP,
          fuel: DIFF_FUEL,
          hashCons,
          flatAtomspace,
        },
      }),
  );
  const out: (string[] | null)[] = new Array(branchSrcs.length).fill(null);
  const done = new Array<boolean>(branchSrcs.length).fill(false);
  let remaining = branchSrcs.length;
  let stop = false;
  while (!stop && remaining > 0) {
    const progress = Atomics.load(view, 0);
    for (let i = 0; i < branchSrcs.length; i++) {
      if (done[i]) continue;
      const base = 1 + i * region;
      const r = readWorkerResult(view, base);
      if (r === undefined) continue;
      out[i] = r;
      done[i] = true;
      remaining--;
      if (firstOnly && r !== null && r.length > 0) {
        stop = true;
        break;
      }
    }
    if (!stop && remaining > 0 && Atomics.wait(view, 0, progress, 60_000) === "timed-out") {
      stop = true;
    }
  }
  for (const worker of workers) void worker.terminate();
  return out;
}

function printed(rs: QueryResult[]): PrintedResult[] {
  return rs.map((r) => [format(r.query), r.results.map(format)]);
}

function runExperimental(
  src: string,
  experimental: NonNullable<RunOptions["experimental"]>,
  baseDir = process.cwd(),
): PrintedResult[] {
  const hashCons = experimental.hashCons === true;
  const flatAtomspace = experimental.flatAtomspace === true;
  const opts: RunOptions = {
    experimental,
    parEvalImpl: (rulesSrc, branchSrcs, firstOnly) =>
      evalBranches(rulesSrc, branchSrcs, firstOnly, hashCons, flatAtomspace),
  };
  const restoreOutput = setOutputSink(() => {});
  const restoreRaw = setRawSink(() => {});
  try {
    return printed(runProgram(src, DIFF_FUEL, importsForBaseDir(src, baseDir), opts));
  } finally {
    setOutputSink(restoreOutput);
    setRawSink(restoreRaw);
  }
}

function expectByteIdentical(name: string, src: string, baseDir = process.cwd()): void {
  const off = runExperimental(src, { hashCons: false }, baseDir);
  const on = runExperimental(src, { hashCons: true }, baseDir);
  expect(on, `${name} changed results with experimental.hashCons`).toEqual(off);
}

export function assertHashConsByteIdentical(): void {
  for (const file of corpusFiles()) {
    const path = resolve(CORPUS_DIR, file);
    expectByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
  }
  for (const [name, src] of ADVERSARIAL) expectByteIdentical(name, src);
}

function expectFlatAtomspaceByteIdentical(
  name: string,
  src: string,
  baseDir = process.cwd(),
): void {
  const off = runExperimental(src, { flatAtomspace: false }, baseDir);
  const on = runExperimental(src, { flatAtomspace: true }, baseDir);
  expect(on, `${name} changed results with experimental.flatAtomspace`).toEqual(off);
}

function corpusFiles(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".metta") && !CORE_TIMEOUT_CORPUS.has(f))
    .sort();
}

describe("experimental.hashCons is byte-identical", () => {
  for (const file of corpusFiles()) {
    it(
      file,
      () => {
        const path = resolve(CORPUS_DIR, file);
        expectByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
      },
      120_000,
    );
  }

  for (const [name, src] of ADVERSARIAL) {
    it(name, () => expectByteIdentical(name, src), 120_000);
  }
});

describe("experimental.flatAtomspace is byte-identical", () => {
  for (const file of corpusFiles()) {
    it(
      file,
      () => {
        const path = resolve(CORPUS_DIR, file);
        expectFlatAtomspaceByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
      },
      120_000,
    );
  }

  for (const [name, src] of ADVERSARIAL) {
    it(name, () => expectFlatAtomspaceByteIdentical(name, src), 120_000);
  }

  it("runtime multiplicity, remove, and rollback", () => {
    expectFlatAtomspaceByteIdentical(
      "runtime multiplicity, remove, and rollback",
      `
        !(add-atom &self (p a))
        !(add-atom &self (p a))
        !(match &self (p a) hit)
        !(remove-atom &self (p a))
        !(match &self (p a) hit)
        !(import! &self concurrency)
        !(transaction (let $u (add-atom &self (p aborted)) (superpose ())))
        !(match &self (p $x) $x)
      `,
    );
  });
});
