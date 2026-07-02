#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// MeTTa TS command-line runner: `metta-ts <file.metta>` prints each !-query's results.
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { format, type RunOptions } from "@metta-ts/core";
import { runFile } from "./index";

// Deep effectful MeTTa recursion can exceed V8's default call stack. Re-exec once with a larger stack,
// matching the reference interpreter's iterative driver. Set METTA_TS_STACK to skip (e.g. when embedding).
function reexecWithLargerStack(): void {
  if (process.env.METTA_TS_STACK !== undefined) return;
  const res = spawnSync(
    process.execPath,
    ["--stack-size=8000", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, METTA_TS_STACK: "1" } },
  );
  process.exit(res.status ?? 1);
}

function main(): void {
  reexecWithLargerStack();
  // CLI resource limits: `--max-steps` is the step ceiling, and `--max-stack-depth` seeds the interpreter
  // stack-depth bound a program can further tighten with `pragma!`.
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "max-steps": { type: "string" },
      "max-stack-depth": { type: "string" },
      "hash-cons": { type: "boolean" },
      "flat-atomspace": { type: "boolean" },
    },
  });
  const file = positionals[0];
  if (file === undefined) {
    process.stderr.write(
      "usage: metta-ts [--max-steps=N] [--max-stack-depth=N] [--hash-cons] [--flat-atomspace] <file.metta>\n",
    );
    process.exit(2);
  }
  const fuel = values["max-steps"] !== undefined ? Number(values["max-steps"]) : undefined;
  const maxStackDepth =
    values["max-stack-depth"] !== undefined ? Number(values["max-stack-depth"]) : undefined;
  const hashCons =
    values["hash-cons"] === true ||
    process.env.METTA_TS_HASHCONS === "1" ||
    process.env.METTA_TS_HASHCONS === "true";
  const flatAtomspace =
    values["flat-atomspace"] === true ||
    process.env.METTA_TS_FLAT_ATOMSPACE === "1" ||
    process.env.METTA_TS_FLAT_ATOMSPACE === "true";
  const opts: RunOptions | undefined =
    maxStackDepth !== undefined || hashCons || flatAtomspace
      ? {
          ...(maxStackDepth !== undefined ? { maxStackDepth } : {}),
          ...(hashCons || flatAtomspace
            ? {
                experimental: {
                  ...(hashCons ? { hashCons: true } : {}),
                  ...(flatAtomspace ? { flatAtomspace: true } : {}),
                },
              }
            : {}),
        }
      : undefined;
  for (const r of runFile(file, fuel, opts)) {
    process.stdout.write("[" + r.results.map(format).join(", ") + "]\n");
  }
}

main();
