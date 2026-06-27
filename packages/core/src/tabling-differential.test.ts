// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { differential, genPrograms, ADVERSARIAL } from "./difftest";
import { runProgram, standardTokenizer, collectImports } from "./runner";
import { parseAll } from "./parser";
import type { Atom } from "./atom";

const CORPUS = resolve(process.cwd(), "corpus");
const CORPUS_FILES = [
  "a1_symbols",
  "a2_opencoggy",
  "a3_twoside",
  "b0_chaining_prelim",
  "b1_equal_chain",
  "b2_backchain",
  "b3_direct",
  "b4_nondeterm",
  "b5_types_prelim",
  "c1_grounded_basic",
  "c2_spaces",
  "c3_pln_stv",
  "d1_gadt",
  "d2_higherfunc",
  "d3_deptypes",
  "d4_type_prop",
  "d5_auto_types",
  "e1_kb_write",
  "e2_states",
  "e3_match_states",
  "g1_docs",
  "test_stdlib",
];

function importsFor(src: string): Map<string, Atom[]> {
  const m = new Map<string, Atom[]>();
  for (const name of collectImports(src)) {
    const p = resolve(CORPUS, name + ".metta");
    if (existsSync(p))
      m.set(
        name,
        parseAll(readFileSync(p, "utf8"), standardTokenizer())
          .filter((t) => !t.bang)
          .map((t) => t.atom),
      );
  }
  return m;
}

describe("tabling is byte-identical to untabled", () => {
  it("agrees on the adversarial corpus and 300 generated programs", async () => {
    const progs = [...ADVERSARIAL, ...genPrograms(300, 7)];
    const diffs = await differential(
      progs,
      (s) => runProgram(s, 100_000, new Map(), { tabling: false }),
      (s) => runProgram(s, 100_000, new Map(), { tabling: true }),
    );
    expect(
      diffs,
      diffs.map((d) => `${d.program}\n  off:${d.a}\n  on :${d.b}`).join("\n---\n"),
    ).toEqual([]);
  });

  it("agrees on the 270-assertion oracle corpus files", async () => {
    const progs = CORPUS_FILES.map((f) => readFileSync(resolve(CORPUS, f + ".metta"), "utf8"));
    const diffs = await differential(
      progs,
      (s) => runProgram(s, 100_000, importsFor(s), { tabling: false }),
      (s) => runProgram(s, 100_000, importsFor(s), { tabling: true }),
    );
    expect(diffs, diffs.map((d) => d.program.slice(0, 60)).join("\n")).toEqual([]);
  });
});
