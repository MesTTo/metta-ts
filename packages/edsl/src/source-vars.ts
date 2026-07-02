// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Type-level extraction of MeTTa `$`-variables from a source string, so a query written as text gets
// statically-typed result rows keyed by its variables. This is the route-parameter parsing technique
// (extracting `:param` from a path at the type level via recursive template-literal types), applied to
// `$name` tokens. It is deliberately bounded: it scans only variable positions, not the whole grammar,
// and it types the variable STRUCTURE, never the result VALUES (MeTTa results come from runtime
// rewriting, which the type system cannot evaluate), so values stay `unknown`.
//
// Note this only works on a plain string literal, not a tagged template: TypeScript widens a tagged
// template's text to `string`, discarding the literal, whereas a plain-string generic preserves it.

/** Characters allowed in a MeTTa variable name after the `$`. */
type IdentChar =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "_"
  | "-";

/** The leading identifier of `S` (characters up to the first non-identifier character). */
type IdentHead<S extends string, Acc extends string = ""> = S extends `${infer C}${infer R}`
  ? C extends IdentChar
    ? IdentHead<R, `${Acc}${C}`>
    : Acc
  : Acc;

/** `S` with its leading identifier removed. */
type AfterIdent<S extends string> = S extends `${infer C}${infer R}`
  ? C extends IdentChar
    ? AfterIdent<R>
    : S
  : S;

/** The union of every `$`-prefixed variable name in the source string `S` (a bare `$` yields nothing). */
export type SourceVars<S extends string> = S extends `${string}$${infer Rest}`
  ? (IdentHead<Rest> extends "" ? never : IdentHead<Rest>) | SourceVars<AfterIdent<Rest>>
  : never;

/** A typed query row: each variable in the source mapped to its (runtime-unwrapped) JS value. */
export type SourceRow<S extends string> = { [K in SourceVars<S>]: unknown };
