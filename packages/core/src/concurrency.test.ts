// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import { runProgramAsync, runProgram } from "./runner";
import { format } from "./parser";
import { gint } from "./atom";
import { setOutputSink } from "./builtins";
import { type AsyncGroundFn } from "./eval";

// async ops: `aw n` resolves to n after an n-ms delay (so timing is controllable).
const aw: AsyncGroundFn = async (args) => {
  const a = args[0]!;
  const n = a.kind === "gnd" && a.value.g === "int" ? Number(a.value.n) : 0;
  await new Promise((r) => setTimeout(r, n));
  return { tag: "ok", results: [gint(n)] };
};
const ops = (): Map<string, AsyncGroundFn> => new Map([["aw", aw]]);
const last = async (src: string): Promise<string[]> => {
  const rs = await runProgramAsync(src, ops());
  return rs[rs.length - 1]!.results.map(format);
};

let restore: ((l: string) => void) | undefined;
afterEach(() => {
  if (restore) setOutputSink(restore);
  restore = undefined;
});

describe("par", () => {
  it("evaluates branches concurrently and unions their results", async () => {
    expect(await last("!(collapse (par (aw 3) (aw 4) (aw 2)))")).toEqual(["(3 4 2)"]);
  });

  it("runs concurrently (total time ~ slowest branch, not the sum)", async () => {
    const t = Date.now();
    await last("!(par (aw 40) (aw 40) (aw 40))");
    expect(Date.now() - t).toBeLessThan(100); // ~40ms concurrent, not ~120ms sequential
  });

  it("merges each branch's add-atom effects deterministically", async () => {
    expect(
      await last(`
        !(par (add-atom &self (k 1)) (add-atom &self (k 2)) (add-atom &self (k 3)))
        !(collapse (match &self (k $v) $v))
      `),
    ).toEqual(["(1 2 3)"]);
  });
});

describe("race / once", () => {
  it("returns the first branch to produce a result", async () => {
    expect(await last("!(race (aw 40) (aw 3))")).toEqual(["3"]);
  });

  it("all-empty branches give an empty result", async () => {
    expect(await last("!(race (superpose ()) (superpose ()))")).toEqual([]);
  });

  it("cancels the losing branch (its effect does not land)", async () => {
    // the slow branch would add (k slow) but is aborted when the fast branch wins
    const out = await last(`
      !(race (let $x (aw 40) (add-atom &self (k slow))) (aw 2))
      !(collapse (match &self (k $v) $v))
    `);
    expect(out).toEqual(["()"]); // empty tuple: (k slow) was never added; the loser was cancelled before its add-atom
  });

  it("once cuts nondeterminism to the first result (and works synchronously)", async () => {
    expect(await last("!(once (superpose (1 2 3)))")).toEqual(["1"]);
    // sync runner: once with a pure argument needs no async
    expect(runProgram("!(once (superpose (7 8 9)))")[0]!.results.map(format)).toEqual(["7"]);
  });
});

describe("with-mutex", () => {
  it("serializes external effects across concurrent branches", async () => {
    const lines: string[] = [];
    restore = setOutputSink((l) => lines.push(l));
    await last(
      "!(par" +
        " (with-mutex L (let $x (aw 20) (let $y (println! A1) (println! A2))))" +
        " (with-mutex L (let $x (aw 2) (let $y (println! B1) (println! B2)))))",
    );
    // A's whole section completes before B's, despite B's shorter await (not interleaved).
    expect(lines).toEqual(["A1", "A2", "B1", "B2"]);
  });
});

describe("sync driver rejects concurrency primitives", () => {
  it("par/race/with-mutex throw AsyncInSyncError under runProgram", () => {
    expect(() => runProgram("!(par (+ 1 1) (+ 2 2))")).toThrow(/async|sync/i);
    expect(() => runProgram("!(race (+ 1 1))")).toThrow(/async|sync/i);
    expect(() => runProgram("!(with-mutex L (+ 1 1))")).toThrow(/async|sync/i);
  });
});
