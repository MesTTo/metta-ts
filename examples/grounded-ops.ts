// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Call your own TypeScript functions from MeTTa, using the class API (@metta-ts/hyperon), which is
// modeled on Python's `hyperon` package but is TypeScript-native: no Python, no Rust, no FFI.
//
// A "grounded operation" is a TypeScript function the evaluator can invoke by name. It receives the
// argument atoms and returns result atoms. A thrown error becomes a MeTTa `(Error ...)` atom rather
// than crashing the run.
//
// Run it (after `pnpm build`): npx tsx examples/grounded-ops.ts
import { MeTTa, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();

// Expose `double` to MeTTa. `jsValue<T>()` unwraps a grounded atom to its typed JS value.
metta.registerOperation("double", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  return [ValueAtom(n * 2)];
});

// `run` returns one Atom[] per `!`-query.
console.log(metta.run("!(double 21)")[0].map(String)); // [ '42' ]

// Grounded ops compose with ordinary MeTTa rules and built-ins.
console.log(metta.run("!(+ (double 10) (* 2 3))")[0].map(String)); // [ '26' ]
