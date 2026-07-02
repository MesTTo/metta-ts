// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collectImports,
  evalSequential,
  format,
  isOraclePass,
  parseAll,
  standardTokenizer,
  type RunOptions,
} from "./index";
import type { Atom } from "./atom";
import type { QueryResult } from "./runner";

export const ORACLE_CORPUS = resolve(process.cwd(), "corpus");

// LeaTTa's 22 oracle files. c2_spaces_kb is an import target, not a test; f1_imports is excluded.
export const ORACLE_FILES = [
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
] as const;

export function readOracleFile(name: string): string {
  return readFileSync(resolve(ORACLE_CORPUS, name + ".metta"), "utf8");
}

export function importsForBaseDir(src: string, baseDir: string): Map<string, Atom[]> {
  const imports = new Map<string, Atom[]>();
  for (const name of collectImports(src)) {
    const p = resolve(baseDir, name.endsWith(".metta") ? name : name + ".metta");
    if (!existsSync(p)) continue;
    imports.set(
      name,
      parseAll(readFileSync(p, "utf8"), standardTokenizer())
        .filter((t) => !t.bang)
        .map((t) => t.atom),
    );
  }
  return imports;
}

export function oracleImportsFor(src: string): Map<string, Atom[]> {
  return importsForBaseDir(src, ORACLE_CORPUS);
}

export function evalOracleFile(name: string, opts: RunOptions = {}): QueryResult[] {
  const src = readOracleFile(name);
  return evalSequential(parseAll(src, standardTokenizer()), 100_000, oracleImportsFor(src), opts);
}

export function formattedQueryResults(results: QueryResult[]): string[] {
  return results.map((r) => format(r.query) + " => " + r.results.map(format).join(" "));
}

export function summarizeOracleResults(results: QueryResult[]): {
  readonly failures: string[];
  readonly pass: number;
  readonly total: number;
} {
  let pass = 0;
  const failures: string[] = [];
  for (const r of results) {
    if (isOraclePass(r)) pass++;
    else failures.push(`${format(r.query)} => ${r.results.map(format).join(" ") || "()none"}`);
  }
  return { failures, pass, total: results.length };
}
