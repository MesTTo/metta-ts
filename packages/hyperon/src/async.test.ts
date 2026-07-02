// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "./base";
import { ValueAtom, GroundedAtom } from "./atoms";

const dbl = async (args: import("./atoms").Atom[]): Promise<import("./atoms").Atom[]> => {
  await new Promise((r) => setTimeout(r, 1));
  const n = (args[0] as GroundedAtom).object().content as number;
  return [ValueAtom(n * 2)];
};

describe("MeTTa async runner", () => {
  it("awaits an async grounded operation", async () => {
    const m = new MeTTa();
    m.registerAsyncOperation("a-dbl", dbl);
    expect((await m.runAsync("!(a-dbl 21)"))[0]!.map((a) => a.toString())).toEqual(["42"]);
  });

  it("composes async ops inside sync evaluation", async () => {
    const m = new MeTTa();
    m.registerAsyncOperation("a-dbl", dbl);
    expect((await m.runAsync("!(+ 1 (a-dbl 20))"))[0]!.map((a) => a.toString())).toEqual(["41"]);
  });

  it("a rejecting async op becomes an Error atom", async () => {
    const m = new MeTTa();
    m.registerAsyncOperation("boom", async () => {
      await Promise.resolve();
      throw new Error("kaboom");
    });
    const out = (await m.runAsync("!(boom)"))[0]!.map((a) => a.toString());
    expect(out.join("")).toContain("kaboom");
  });

  it("a pure program runs unchanged via runAsync", async () => {
    const m = new MeTTa();
    expect((await m.runAsync("!(+ 2 3)"))[0]!.map((a) => a.toString())).toEqual(["5"]);
  });
});
