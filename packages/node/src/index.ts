// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/node: Node adapters for file-backed import! and program runs.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import {
  type Atom,
  parseAll,
  standardTokenizer,
  evalSequential,
  collectImports,
  type QueryResult,
  type RunOptions,
  DEFAULT_FUEL,
} from "@metta-ts/core";
import { makeParEvalImpl } from "./par-hyperpose";

/** Pre-read every `import!` target referenced in `src`, resolving names against `baseDir`. */
export function readImports(
  src: string,
  baseDir: string,
  importRoot = baseDir,
): Map<string, Atom[]> {
  const m = new Map<string, Atom[]>();
  const base = resolve(baseDir);
  const root = resolve(importRoot);
  for (const name of collectImports(src)) {
    const p = resolve(base, name.endsWith(".metta") ? name : name + ".metta");
    // Keep imports inside the chosen root. `runFile` uses the file directory's parent so a corpus file can
    // share a sibling `../lib` directory without allowing imports above that tree.
    if (p !== root && !p.startsWith(root + sep)) continue;
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

/** Run a `.metta` file from disk, resolving `import!` relative to the file's directory. `fuel` is the step
 *  ceiling; `opts` carries interpreter settings such as the initial `maxStackDepth`. */
export function runFile(path: string, fuel?: number, opts?: RunOptions): QueryResult[] {
  const src = readFileSync(path, "utf8");
  const tops = parseAll(src, standardTokenizer());
  const fileDir = dirname(resolve(path));
  // Node hosts `(once (hyperpose …))` on a worker_threads pool by default (the browser cannot, and falls
  // back to sequential). A caller can override by passing its own `parEvalImpl` (or `null` to disable).
  const withPar: RunOptions =
    opts?.parEvalImpl === undefined
      ? { ...opts, parEvalImpl: makeParEvalImpl(fuel ?? DEFAULT_FUEL) }
      : opts;
  return evalSequential(tops, fuel, readImports(src, fileDir, dirname(fileDir)), withPar);
}

export * from "@metta-ts/core";
export { ParallelFlatMatcher } from "./flat-parallel";
