// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Atom } from "./atom";
import { setOutputSink, setRawSink, stdTable } from "./builtins";
import { addAtomToEnv, buildEnv, initSt, mettaEval, type St } from "./eval";
import { withBuiltinModules } from "./extensions";
import { parseAll, format } from "./parser";
import { pettaStdlibAtoms } from "./petta-stdlib";
import { preludeAtoms, standardTokenizer } from "./runner";
import { stdlibAtoms } from "./stdlib";
import { analyzePurity } from "./tabling";
import { importsForBaseDir } from "./oracle-corpus";

const ROUTE_ENV = "METTA_COLLAPSE_ROUTE";
const CORPUS_DIR = resolve(process.cwd(), "packages/node/bench/corpus-mettats");
const DIFF_FUEL = 100_000;

type PrintedRun = {
  readonly results: ReadonlyArray<readonly [query: string, results: readonly string[]]>;
  readonly counter: number;
};

const originalRouteEnv = process.env[ROUTE_ENV];

afterEach(() => {
  // The route is on unless the variable is "0", so an unset value behaves the same as "1"; restore by
  // assigning a string rather than deleting the key (the codebase forbids `delete`).
  process.env[ROUTE_ENV] = originalRouteEnv ?? "1";
});

function buildDefaultTestEnv(imports: Map<string, Atom[]>) {
  const env = buildEnv([...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms()], stdTable());
  env.imports = withBuiltinModules(imports);
  env.table = new Map();
  env.pureFunctors = analyzePurity(env);
  env.compiled = new Map();
  env.compileDirty = true;
  return env;
}

function runWithCounter(src: string, imports: Map<string, Atom[]> = new Map()): PrintedRun {
  const env = buildDefaultTestEnv(imports);
  let st: St = initSt();
  const out: Array<readonly [string, string[]]> = [];
  const restoreOutput = setOutputSink(() => {});
  const restoreRaw = setRawSink(() => {});
  try {
    for (const { atom, bang } of parseAll(src, standardTokenizer())) {
      if (!bang) {
        addAtomToEnv(env, atom);
        continue;
      }
      const [pairs, st2] = mettaEval(env, DIFF_FUEL, st, [], atom);
      st = st2;
      out.push([format(atom), pairs.map((p) => format(p[0]))]);
    }
  } finally {
    setOutputSink(restoreOutput);
    setRawSink(restoreRaw);
  }
  return { results: out, counter: st.counter };
}

function withRoute<T>(enabled: boolean, fn: () => T): T {
  const prev = process.env[ROUTE_ENV];
  process.env[ROUTE_ENV] = enabled ? "1" : "0";
  try {
    return fn();
  } finally {
    process.env[ROUTE_ENV] = prev ?? "1";
  }
}

function expectRouteIdentical(
  name: string,
  src: string,
  imports: Map<string, Atom[]> = new Map(),
): void {
  const off = withRoute(false, () => runWithCounter(src, imports));
  const on = withRoute(true, () => runWithCounter(src, imports));
  expect(on, `${name} changed results or counter with ${ROUTE_ENV}=1`).toEqual(off);
}

function rulesOnly(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("!("))
    .join("\n");
}

function smallMatespace(file: string, k: number): string {
  const src = readFileSync(resolve(CORPUS_DIR, file), "utf8");
  return `${rulesOnly(src)}\n!(length (collapse (mate-space-demo ${k})))`;
}

const ADVERSARIAL: ReadonlyArray<readonly [name: string, src: string]> = [
  [
    "tail match references a let-bound variable",
    `
      (p a)
      (= (route-test) (let $x a (match &self (p $x) $x)))
      !(length (collapse (route-test)))
    `,
  ],
  [
    "build prefix branches before tail match",
    `
      (p a)
      (= (route-test) (let $x (superpose (a b)) (match &self (p $y) $y)))
      !(length (collapse (route-test)))
    `,
  ],
  [
    "literal match keeps the existing count path",
    `
      (p a)
      (p b)
      !(length (collapse (match &self (p $x) $x)))
    `,
  ],
  ["non-function collapse argument falls back", "!(length (collapse (superpose (a b c))))"],
  [
    "route fires through nested let* and let to the tail match",
    `
      (q 1)
      (q 2)
      (= (route-test) (let* (($a (add-atom &self (q 3)))) (let $b nope (match &self (q $n) $n))))
      !(length (collapse (route-test)))
    `,
  ],
];

// Real corpus programs that use length/collapse/match, so the route is exercised against actual code:
// peano's `(length (collapse (demo-peano K)))` fires the route (demo-peano's body is a let* that ends in a
// tail match over the built `num` facts), and the others keep the literal-match count path. The full
// corpus's byte-identity with the route active is covered by the main suite (the oracle and the
// hashCons/flat differential all run with the route on by default), so this stays a focused, fast set.
const ROUTE_CORPUS = [
  "peano.metta",
  "collapse.metta",
  "foldallspacecount.metta",
  "foldallmatch.metta",
];

describe("collapse count route is byte-identical", () => {
  it("agrees on real corpus programs that use length/collapse", () => {
    for (const file of ROUTE_CORPUS) {
      const path = resolve(CORPUS_DIR, file);
      const src = readFileSync(path, "utf8");
      expectRouteIdentical(file, src, importsForBaseDir(src, dirname(path)));
    }
  }, 60_000);

  // The route fires on all three matespace shapes (a single-clause function whose let*/let body ends in a
  // tail match). matespacefast has the cheap binary build; matespace and matespace2 use the O(N^2) case-
  // match re-enumeration, so they are slow even at small K and run here at K=3 (matespacefast at K=11).
  it("agrees on small matespace variants", () => {
    expectRouteIdentical("matespacefast K=11", smallMatespace("matespacefast.metta", 11));
    expectRouteIdentical("matespace K=3", smallMatespace("matespace.metta", 3));
    expectRouteIdentical("matespace2 K=3", smallMatespace("matespace2.metta", 3));
  }, 120_000);

  for (const [name, src] of ADVERSARIAL) {
    it(name, () => expectRouteIdentical(name, src));
  }
});
