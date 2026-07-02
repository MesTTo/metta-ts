// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Transactions (opt-in via `(import! &self concurrency)`): the body's space mutations commit only on
// success, and roll back on a thrown Error atom or zero results.
//
// Run it (after `pnpm build`): npx tsx examples/transactions.ts
import { runProgram, format } from "@metta-ts/core";

const last = (src: string): string[] => runProgram(src).at(-1)!.results.map(format);

// Commit: the body adds (cnt 7) and returns a value, so the mutation sticks.
console.log(
  "commit:",
  last(`
    !(import! &self concurrency)
    !(add-atom &self (cnt 5))
    !(transaction (add-atom &self (cnt 7)))
    !(collapse (match &self (cnt $v) $v))
  `),
); // [ '(5 7)' ]

// Rollback: the body adds (cnt 6) then produces zero results, so the add is undone.
console.log(
  "rollback:",
  last(`
    !(import! &self concurrency)
    !(add-atom &self (cnt 5))
    !(transaction (let $u (add-atom &self (cnt 6)) (superpose ())))
    !(collapse (match &self (cnt $v) $v))
  `),
); // [ '(5)' ]
