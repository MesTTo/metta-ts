// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  evalOracleFile,
  formattedQueryResults,
  ORACLE_FILES,
  summarizeOracleResults,
} from "./oracle-corpus";

describe("Hyperon oracle with experimental.hashCons", () => {
  let grand = 0;
  let grandPass = 0;

  for (const f of ORACLE_FILES) {
    it(f, () => {
      const off = evalOracleFile(f);
      const on = evalOracleFile(f, { experimental: { hashCons: true } });
      const summary = summarizeOracleResults(on);
      grand += summary.total;
      grandPass += summary.pass;
      expect(formattedQueryResults(on), `${f} hashCons output diverged from default`).toEqual(
        formattedQueryResults(off),
      );
      expect(summary.failures, summary.failures.join("\n")).toEqual([]);
    });
  }

  it("ZZ total is 270/270", () => {
    expect(grandPass).toBe(grand);
    expect(grand).toBe(270);
  });
});
