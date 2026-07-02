// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Run MeTTa from TypeScript with the core package. `runProgram` parses a source string, adds every
// non-bang atom to the knowledge base, evaluates each `!`-query, and returns one result group per query.
//
// Run it (after `pnpm build`): npx tsx examples/quickstart.ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  ; a rule: factorial via the minimal unify instruction
  (= (fact $n) (unify $n 0 1 (* $n (fact (- $n 1)))))

  ; queries
  !(fact 5)
  !(fact 10)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
// (fact 5)  => [ '120' ]
// (fact 10) => [ '3628800' ]
