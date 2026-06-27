// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { differential, genPrograms, ADVERSARIAL } from "./difftest";
import { runProgram, runProgramAsync } from "./runner";
import { sym } from "./atom";

describe("differential harness", () => {
  it("reports no divergence when both modes are the same engine", async () => {
    const progs = [...ADVERSARIAL, ...genPrograms(50)];
    const diffs = await differential(
      progs,
      (s) => runProgram(s),
      async (s) => runProgramAsync(s),
    );
    expect(diffs, diffs.map((d) => d.program).join("\n---\n")).toEqual([]);
  });

  it("detects an injected divergence", async () => {
    const diffs = await differential(
      ["!(+ 1 2)"],
      (s) => runProgram(s),
      async () => [{ query: sym("x"), results: [] }],
    );
    expect(diffs.length).toBe(1);
  });
});
