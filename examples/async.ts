// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// MeTTa can be asynchronous: a grounded operation can do I/O (a fetch, a database query, a timer) and
// the evaluator awaits it. Register the op with `registerAsyncOperation` and run the program with
// `runAsync`. A synchronous program gives identical results either way; the async path only differs
// when an async op is actually reached.
//
// Run it (after `pnpm build`): npx tsx examples/async.ts
import { MeTTa, ValueAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();

// An async op: pretend this is a network call. It resolves to result atoms.
metta.registerAsyncOperation("fetch-temperature", async (_args: Atom[]) => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return [ValueAtom(21)];
});

const out = await metta.runAsync("!(fetch-temperature)");
console.log(out[0].map(String)); // [ '21' ]
