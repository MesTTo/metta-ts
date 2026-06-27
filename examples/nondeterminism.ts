// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Nondeterminism: a function with several `=` rules returns several results, and superpose/collapse
// move between a nondeterministic stream and a single collected tuple.
//
// Run it (after `pnpm build`): npx tsx examples/nondeterminism.ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  ; two rules for the same head -> two results
  (= (bin) 0)
  (= (bin) 1)
  !(bin)

  ; superpose turns a tuple into a nondeterministic choice
  !(superpose (red green blue))

  ; collapse gathers all results of a nondeterministic expression into one tuple
  !(collapse (bin))

  ; nondeterminism propagates through other calls
  (= (double $x) (* 2 $x))
  !(double (superpose (1 2 3)))
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// !(bin)                       => [ '0', '1' ]
// !(superpose (red green blue))=> [ 'red', 'green', 'blue' ]
// !(collapse (bin))            => [ '(0 1)' ]
// !(double (superpose (1 2 3)))=> [ '2', '4', '6' ]
