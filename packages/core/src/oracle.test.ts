// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { evalOracleFile, ORACLE_FILES, summarizeOracleResults } from "./oracle-corpus";

describe("Hyperon oracle (270 assertions)", () => {
  let grand = 0;
  let grandPass = 0;
  for (const f of ORACLE_FILES) {
    it(f, () => {
      const summary = summarizeOracleResults(evalOracleFile(f));
      grand += summary.total;
      grandPass += summary.pass;
      expect(summary.failures, summary.failures.join("\n")).toEqual([]);
    });
  }
  it("ZZ total is 270/270", () => {
    expect(grandPass).toBe(grand);
    expect(grand).toBe(270);
  });
});
