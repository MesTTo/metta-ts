// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Typed combinators for MeTTa special forms and standard-library operations. Each maps to an
// interpreter symbol: `=`, `:`, `->`, `if`, `case`, `let`, `let*`, `match`, `superpose`, `collapse`,
// `empty`, `unify`, arithmetic/comparison/boolean grounded ops, or list ops. Special forms are
// capitalized (`If`/`Let`/`Match`/…) because they are forms, not data, and to dodge JS reserved words;
// grounded ops stay lowercase (`add`/`gt`/…) to read as ordinary function calls.
import { E, S, type ExpressionAtom } from "@metta-ts/hyperon";
import { ground, type Term } from "./term";

/** A rewrite rule `(= head body)`. Define several with the same head for nondeterministic results. */
export const rule = (head: Term, body: Term): ExpressionAtom =>
  E(S("="), ground(head), ground(body));

/** A type declaration `(: subject type)`. */
export const decl = (subject: Term, type: Term): ExpressionAtom =>
  E(S(":"), ground(subject), ground(type));

/** A function type `(-> A B ... R)`. */
export const arrow = (...types: Term[]): ExpressionAtom => E(S("->"), ...types.map(ground));

/** `(if cond then else)`. Only the taken branch is evaluated. */
export const If = (cond: Term, then: Term, els: Term): ExpressionAtom =>
  E(S("if"), ground(cond), ground(then), ground(els));

/** `(case scrutinee ((pat body) ...))`, sequential mutually-exclusive pattern matching. */
export const Case = (
  scrutinee: Term,
  cases: ReadonlyArray<readonly [Term, Term]>,
): ExpressionAtom =>
  E(S("case"), ground(scrutinee), E(...cases.map(([pat, body]) => E(ground(pat), ground(body)))));

/** `(let pattern value body)`: unify `value` against `pattern`, then evaluate `body`. */
export const Let = (pattern: Term, value: Term, body: Term): ExpressionAtom =>
  E(S("let"), ground(pattern), ground(value), ground(body));

/** `(let* ((pat val) ...) body)`: sequential lets. */
export const LetStar = (
  bindings: ReadonlyArray<readonly [Term, Term]>,
  body: Term,
): ExpressionAtom =>
  E(S("let*"), E(...bindings.map(([pat, val]) => E(ground(pat), ground(val)))), ground(body));

/** `(match space pattern template)`. Defaults to `&self`, the program's own space. */
export const Match = (pattern: Term, template: Term, space: Term = S("&self")): ExpressionAtom =>
  E(S("match"), ground(space), ground(pattern), ground(template));

/** `(superpose (a b ...))`: a nondeterministic choice among the items. */
export const Superpose = (...items: Term[]): ExpressionAtom =>
  E(S("superpose"), E(...items.map(ground)));

/** `(collapse x)`: gather all nondeterministic results of `x` into a single expression. */
export const Collapse = (x: Term): ExpressionAtom => E(S("collapse"), ground(x));

/** `(empty)`: no results, which prunes a branch. */
export const Empty = (): ExpressionAtom => E(S("empty"));

/** `(unify a b then else)`: low-level unification with then/else continuations. */
export const Unify = (a: Term, b: Term, then: Term, els: Term): ExpressionAtom =>
  E(S("unify"), ground(a), ground(b), ground(then), ground(els));

/** `(sealed (vars...) body)`: alpha-rename `body`'s variables (except `vars`) to fresh names, so a
 *  template can be reused without variable capture. */
export const Sealed = (vars: ReadonlyArray<Term>, body: Term): ExpressionAtom =>
  E(S("sealed"), E(...vars.map(ground)), ground(body));

/** `(quote x)`: hold `x` as data so the interpreter does not evaluate it. */
export const Quote = (x: Term): ExpressionAtom => E(S("quote"), ground(x));

const op2 =
  (name: string) =>
  (a: Term, b: Term): ExpressionAtom =>
    E(S(name), ground(a), ground(b));

const op1 =
  (name: string) =>
  (x: Term): ExpressionAtom =>
    E(S(name), ground(x));

/** Arithmetic grounded operations. */
export const add = op2("+");
export const sub = op2("-");
export const mul = op2("*");
export const div = op2("/");
export const mod = op2("%");

/** Comparison grounded operations (return `True`/`False`). */
export const eq = op2("==");
export const gt = op2(">");
export const lt = op2("<");
export const ge = op2(">=");
export const le = op2("<=");

/** Boolean grounded operations. */
export const and = op2("and");
export const or = op2("or");
export const not = op1("not");

/** Expression/list grounded operations. */
export const carAtom = op1("car-atom");
export const cdrAtom = op1("cdr-atom");
export const consAtom = (head: Term, tail: Term): ExpressionAtom =>
  E(S("cons-atom"), ground(head), ground(tail));
/** `(decons-atom expr)`: split a non-empty expression into `(head tail)`. */
export const deconsAtom = op1("decons-atom");

/** Type introspection. `getType` reports an atom's declared/inferred type; `getMetatype` reports its
 *  meta-type (`Symbol`/`Variable`/`Expression`/`Grounded`). */
export const getType = op1("get-type");
export const getMetatype = op1("get-metatype");

/** Assertions for eDSL tests. Each returns the unit atom `()` on success and an `(Error ...)` atom on
 *  failure, matching Hyperon's stdlib. `assertEqual` compares evaluated results; `assertAlphaEqual`
 *  compares up to a consistent renaming of variables. */
export const assertEqual = op2("assertEqual");
export const assertAlphaEqual = op2("assertAlphaEqual");

/** Set operations over the (collapsed) results of their arguments, deduplicating modulo equality.
 *  `unique` removes duplicates from one result set; `union`/`intersection`/`subtraction` combine two. */
export const unique = op1("unique");
export const union = op2("union");
export const intersection = op2("intersection");
export const subtraction = op2("subtraction");

/** `(println! x)`: print `x` (a side effect); returns the unit atom `()`. */
export const println = op1("println!");

// ---------- JSON / dict-space (the `registerJsonModule` operations) ----------
// These need the JSON module enabled on the runner: `mettaDB().useJson()`.

/** `(json-encode x)`: encode a MeTTa atom (string, number, expression, dict-space, or a mix) to a JSON
 *  string. */
export const jsonEncode = op1("json-encode");

/** `(json-decode s)`: decode a JSON string to MeTTa (array to expression, object to a dict-space of
 *  `(key value)` pairs, string to string, number to number). */
export const jsonDecode = op1("json-decode");

/** `(dict-space ((k v) ...))`: build a grounded Space of `(key value)` pairs from key-value tuples. */
export const dictSpace = (pairs: ReadonlyArray<readonly [Term, Term]>): ExpressionAtom =>
  E(S("dict-space"), E(...pairs.map(([k, v]) => E(ground(k), ground(v)))));

/** `(get-keys space)`: every key in a dict-space, one result per key. */
export const getKeys = op1("get-keys");

/** `(get-value space key)`: the value tied to `key` in a dict-space, empty if absent. */
export const getValue = op2("get-value");
