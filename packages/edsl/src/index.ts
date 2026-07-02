// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/edsl: typed TypeScript builders for MeTTa. Term builders and special-form combinators
// construct ordinary atoms; tagged templates (`m`) cover raw MeTTa source; `mettaDB()` runs them on the
// existing interpreter. `ground` and template interpolation embed TypeScript values as grounded atoms.
export {
  type Term,
  type Var,
  type VarValue,
  type SymbolBuilder,
  v,
  S,
  ground,
  e,
  rel,
  nil,
  list,
} from "./term";
export {
  rule,
  decl,
  arrow,
  iff,
  caseOf,
  lett,
  letStar,
  matchSelf,
  superpose,
  collapse,
  empty,
  unify,
  add,
  sub,
  mul,
  div,
  mod,
  eq,
  gt,
  lt,
  ge,
  le,
  and,
  or,
  not,
  carAtom,
  cdrAtom,
  consAtom,
  deconsAtom,
  quote,
  getType,
  getMetatype,
  assertEqual,
  assertAlphaEqual,
  unique,
  union,
  intersection,
  subtraction,
  println,
  sealed,
} from "./forms";
export { m, mAll } from "./template";
export { MettaDB, mettaDB, type Row } from "./db";

// Re-export hyperon atom types for annotations without a second import.
export { Atom, type GroundedAtom, ValueAtom, atomToJs } from "@metta-ts/hyperon";
