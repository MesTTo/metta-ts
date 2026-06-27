// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Optional typing: declare types with `:` and function types with `->`. The type checker rejects
// ill-typed applications, and get-type / metatypes let a program inspect itself.
//
// Run it (after `pnpm build`): npx tsx examples/types.ts
import { runProgram, format } from "@metta-ts/core";

const results = runProgram(`
  ; a data type and two constructors
  (: Color Type)
  (: Red Color)
  (: Green Color)

  ; a typed function
  (: favorite (-> Color Color))
  (= (favorite Red) Green)
  !(favorite Red)            ; Green

  ; get-type reports the inferred type
  !(get-type Red)            ; Color
  !(get-type favorite)       ; (-> Color Color)

  ; an ill-typed application does not type-check (returns a type error)
  !(favorite 42)
`);

for (const { query, results: rs } of results) {
  console.log(format(query), "=>", rs.map(format));
}
