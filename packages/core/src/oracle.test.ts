// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseAll, standardTokenizer, evalSequential, isOraclePass, collectImports } from "./index";
import { format } from "./parser";
import type { Atom } from "./atom";

const CORPUS = resolve(process.cwd(), "corpus");
// LeaTTa's 22 oracle files (c2_spaces_kb is an import target, not a test; f1_imports excluded).
const FILES = [
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

describe("Hyperon oracle (270 assertions)", () => {
  let grand = 0;
  let grandPass = 0;
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(resolve(CORPUS, f + ".metta"), "utf8");
      const tops = parseAll(src, standardTokenizer());
      const results = evalSequential(tops, 100_000, importsFor(src));
      let pass = 0;
      const fails: string[] = [];
      for (const r of results) {
        if (isOraclePass(r)) pass++;
        else fails.push(`${format(r.query)} => ${r.results.map(format).join(" ") || "()none"}`);
      }
      grand += results.length;
      grandPass += pass;
      expect(fails, fails.join("\n")).toEqual([]);
    });
  }
  it("ZZ total is 270/270", () => {
    expect(grandPass).toBe(grand);
    expect(grand).toBe(270);
  });
});
