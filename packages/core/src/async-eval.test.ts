// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runProgramAsync, preludeAtoms } from "./runner";
import { format } from "./parser";
import { gint, sym, expr, type Atom } from "./atom";
import { type AsyncGroundFn, AsyncInSyncError, buildEnv, initSt, mettaEval } from "./eval";
import { stdlibAtoms } from "./stdlib";
import { stdTable } from "./builtins";

// An async grounded op that doubles its argument after an actual await (simulated I/O).
const fetchDouble: AsyncGroundFn = async (args) => {
  await new Promise((r) => setTimeout(r, 1));
  const a = args[0]!;
  return {
    tag: "ok",
    results: [gint((a.kind === "gnd" && a.value.g === "int" ? Number(a.value.n) : 0) * 2)],
  };
};
const ops = new Map<string, AsyncGroundFn>([["fetch-double", fetchDouble]]);
const r1 = async (src: string): Promise<string[]> => {
  const rs = await runProgramAsync(src, ops);
  return rs[rs.length - 1]!.results.map(format);
};

describe("async evaluation (generator dual-driver)", () => {
  it("awaits a top-level async grounded op", async () => {
    expect(await r1("!(fetch-double 21)")).toEqual(["42"]);
  });

  it("suspends through sync evaluation: async op nested inside arithmetic", async () => {
    expect(await r1("!(+ 1 (fetch-double 20))")).toEqual(["41"]);
  });

  it("composes with control flow: async op in a conditional (only the taken branch)", async () => {
    expect(await r1("!(if (> (fetch-double 5) 8) yes no)")).toEqual(["yes"]);
  });

  it("composes with nondeterminism", async () => {
    expect(
      (
        await runProgramAsync("!(collapse (fetch-double (superpose (1 2 3))))", ops)
      )[0]!.results.map(format),
    ).toEqual(["(2 4 6)"]);
  });

  it("a pure program gives the same result via the async runner", async () => {
    expect(await r1("!(+ 1 2)")).toEqual(["3"]);
  });

  it("the sync driver throws AsyncInSyncError when it reaches an async op", () => {
    const env = buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());
    env.agt.set("fetch-double", fetchDouble);
    const q: Atom = expr([sym("fetch-double"), gint(3)]);
    expect(() => mettaEval(env, 100_000, initSt(), [], q)).toThrow(AsyncInSyncError);
  });
});
