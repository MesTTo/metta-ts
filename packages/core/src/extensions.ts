// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// TS-native MeTTa extensions, not part of upstream MeTTa, packaged as importable built-in modules.
// They stay out of the vendored, spec-conformant prelude so the 270/270 Hyperon oracle runs against a
// pristine baseline; a program opts in with `(import! &self concurrency)`. Importing a module brings
// its type signatures into scope (see `registerImportedTypes` in eval.ts), which is what makes the
// type-directed argument handling work, e.g. `transaction`'s body is typed `Atom`, so it reaches the
// transaction instruction unevaluated and is evaluated under snapshot/rollback.
import { type Atom } from "./atom";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";

/** The `concurrency` module: timing/concurrency extensions (transaction, and later par/race/mutex). */
export const CONCURRENCY_MODULE_SRC = `
  (: transaction (-> Atom %Undefined%))
`;

/** The `curry` module: PeTTa-style partial application. Importing it sets the engine's curry flag (see
 *  the import! handler), so a symbol-headed call applied to fewer arguments than the function's arity
 *  reduces to `(partial fn (args))`. This module supplies the rules that *apply* such a closure (append
 *  the new arguments and re-evaluate the now-fuller call, which re-curries if still short), plus the
 *  same under-application handling for |-> lambdas, whose head is an expression and so is not reached by
 *  the symbol-headed hook. Off unless imported, so the Hyperon oracle baseline is untouched. */
export const CURRY_MODULE_SRC = `
  (: partial (-> Atom Expression Atom))

  ; Apply a closure to further arguments: append them to the bound list, rebuild the call, evaluate it.
  ; append is forced through its own let (cons-atom would otherwise take it as a literal subexpression),
  ; and the rebuilt call is fully reduced with metta (eval is a single step), which re-curries if still
  ; under-applied.
  (= ((partial $f $bound) $a)
     (let $args (append $bound ($a))
       (let $call (cons-atom $f $args) (metta $call %Undefined% &self))))
  (= ((partial $f $bound) $a $b)
     (let $args (append $bound ($a $b))
       (let $call (cons-atom $f $args) (metta $call %Undefined% &self))))

  ; An under-applied |-> lambda (head is an expression, so the core hook does not see it) becomes a
  ; partial closure over the lambda value; applying it later rebuilds the full application.
  (= ((|-> ($p1 $p2) $body) $a1)
     (partial (|-> ($p1 $p2) $body) ($a1)))
  (= ((|-> ($p1 $p2 $p3) $body) $a1)
     (partial (|-> ($p1 $p2 $p3) $body) ($a1)))
  (= ((|-> ($p1 $p2 $p3) $body) $a1 $a2)
     (partial (|-> ($p1 $p2 $p3) $body) ($a1 $a2)))
`;

const moduleCache = new Map<string, Atom[]>();

function parseModule(src: string): Atom[] {
  return parseAll(src, standardTokenizer())
    .filter((t) => !t.bang)
    .map((t) => t.atom);
}

/** The built-in extension modules, by the name used in `(import! &self <name>)`. */
export function builtinModules(): Map<string, Atom[]> {
  if (moduleCache.size === 0) {
    moduleCache.set("concurrency", parseModule(CONCURRENCY_MODULE_SRC));
    moduleCache.set("curry", parseModule(CURRY_MODULE_SRC));
  }
  return moduleCache;
}

/** A fresh imports map seeded with the built-in extension modules, optionally merged with caller
 *  imports. Built-ins are only applied when a program actually `(import! ...)`s them, so this never
 *  affects the Hyperon oracle baseline. Built-in module names are reserved: a caller-supplied module of
 *  the same name does NOT override the built-in (otherwise a disk file that happens to share a name, e.g.
 *  a corpus `curry.metta` that itself does `(import! &self curry)`, would shadow the built-in rules). */
export function withBuiltinModules(extra?: Map<string, Atom[]>): Map<string, Atom[]> {
  const out = new Map<string, Atom[]>(builtinModules());
  if (extra) for (const [k, v] of extra) if (!out.has(k)) out.set(k, v);
  return out;
}
