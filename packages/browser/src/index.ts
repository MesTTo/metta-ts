// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/browser: browser entry point. The core interpreter has no Node dependencies,
// so this build re-exports it and adds an in-memory VFS for `import!`.
import {
  type Atom,
  parseAll,
  standardTokenizer,
  evalSequential,
  collectImports,
  type QueryResult,
} from "@metta-ts/core";

/** Build an `import!` map from an in-memory file map (name -> MeTTa source). */
export function vfsImports(src: string, files: Map<string, string>): Map<string, Atom[]> {
  const m = new Map<string, Atom[]>();
  for (const name of collectImports(src)) {
    const text = files.get(name) ?? files.get(name + ".metta");
    if (text !== undefined)
      m.set(
        name,
        parseAll(text, standardTokenizer())
          .filter((t) => !t.bang)
          .map((t) => t.atom),
      );
  }
  return m;
}

/** Run a MeTTa program in the browser with optional in-memory `import!` modules. */
export function run(
  src: string,
  files: Map<string, string> = new Map(),
  fuel?: number,
): QueryResult[] {
  return evalSequential(parseAll(src, standardTokenizer()), fuel, vfsImports(src, files));
}

export * from "@metta-ts/core";
