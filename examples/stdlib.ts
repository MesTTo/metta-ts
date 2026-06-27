// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The standard library is always loaded: arithmetic, comparison, the control forms if/case/let, and the
// console output ops. This shows a few of them together.
//
// Run it (after `pnpm build`): npx tsx examples/stdlib.ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  ; arithmetic and comparison are grounded operations
  !(+ (* 2 3) 4)            ; 10
  !(> 5 3)                  ; True

  ; if evaluates only the taken branch
  !(if (> 5 3) bigger smaller)

  ; case pattern-matches sequentially
  !(case (+ 1 1)
     ((1 one)
      (2 two)
      ($x other)))

  ; let binds by unification, then evaluates the body
  !(let $x (+ 1 2) (* $x $x))   ; 9

  ; recursion + if: factorial
  (= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))
  !(fact 6)                 ; 720
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
