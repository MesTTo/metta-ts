// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/edsl: typed TypeScript builders for MeTTa. `names()` and `vars()` mint symbols/functors and
// logic variables from proxies; capitalized combinators (`If`/`Let`/`Match`/…) build the special forms;
// tagged templates (`m`) cover raw MeTTa source; `mettaDB()` runs it all on the existing interpreter.
// Any JS value auto-grounds, and the runner bridges both directions (`fn`/`fns` in, `call`/`import` out).
export {
  type Term,
  type Var,
  type VarValue,
  type Name,
  type Names,
  type Vars,
  names,
  vars,
  ground,
  patternVars,
  e,
  nil,
  list,
} from "./term";
export {
  rule,
  decl,
  arrow,
  If,
  Case,
  Let,
  LetStar,
  Match,
  Superpose,
  Collapse,
  Empty,
  Unify,
  Sealed,
  Quote,
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
  getType,
  getMetatype,
  assertEqual,
  assertAlphaEqual,
  unique,
  union,
  intersection,
  subtraction,
  println,
  jsonEncode,
  jsonDecode,
  dictSpace,
  getKeys,
  getValue,
} from "./forms";
export { m, mAll, parseSource } from "./template";
export { type SourceVars, type SourceRow } from "./source-vars";
export { MettaDB, mettaDB, type Row, type ImportedFn, type CallProxy, type FnSchema } from "./db";

// Re-export hyperon atom types for annotations without a second import.
export { Atom, type GroundedAtom, ValueAtom, atomToJs } from "@metta-ts/hyperon";
