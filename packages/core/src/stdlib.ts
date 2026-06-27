// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The MeTTa standard library that ships with @metta-ts/core, hardcoded and always loaded after the
// (LeaTTa-vendored) prelude. These are STANDARD hyperon functions, written in MeTTa wherever possible
// so the interpreter runs them (only genuine host primitives, println!/format-args/arithmetic, are
// grounded in builtins.ts). TS-native, non-standard extensions (transaction, concurrency) do NOT live
// here; they are opt-in import modules (see extensions.ts).
//
// Ported/adapted from hyperon-experimental stdlib.metta. Only declarations missing from the prelude are
// added here, to avoid duplicate definitions.
import { type Atom } from "./atom";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";

export const STDLIB_SRC = `
  ; ---- Types of the grounded ops (math, bool, atom). Hyperon's grounded atoms carry their type
  ; intrinsically and \`get-type\` reads it; @metta-ts grounds these as host functions in builtins.ts,
  ; so the type signature is declared here to match. Values from hyperon-experimental math.rs/atom.rs
  ; (math ops are f64-valued, so e.g. pow-math/sqrt-math return Number; min-atom/max-atom take any
  ; expression, typed %Undefined% -> Number). The core arithmetic and comparison ops (+ - < == …) are
  ; already declared in the prelude.
  (: pow-math (-> Number Number Number))
  (: sqrt-math (-> Number Number))
  (: abs-math (-> Number Number))
  (: log-math (-> Number Number Number))
  (: trunc-math (-> Number Number))
  (: ceil-math (-> Number Number))
  (: floor-math (-> Number Number))
  (: round-math (-> Number Number))
  (: sin-math (-> Number Number))
  (: asin-math (-> Number Number))
  (: cos-math (-> Number Number))
  (: acos-math (-> Number Number))
  (: tan-math (-> Number Number))
  (: atan-math (-> Number Number))
  (: isnan-math (-> Number Bool))
  (: isinf-math (-> Number Bool))
  (: min-atom (-> %Undefined% Number))
  (: max-atom (-> %Undefined% Number))
  (: and (-> Bool Bool Bool))
  (: or (-> Bool Bool Bool))
  (: not (-> Bool Bool))
  (: xor (-> Bool Bool Bool))

  ; sealed alpha-renames the variables of its second argument. That argument is Atom-typed so the
  ; body reaches sealed unevaluated (hyperon-experimental core.rs: (-> Expression Atom Atom)); without
  ; this the reduce loop would evaluate the body first, e.g. collapsing (== 1 \$e) before renaming.
  (: sealed (-> Expression Atom Atom))

  ; ---- IO (host primitives grounded in builtins.ts) ----
  (: println! (-> %Undefined% (->)))
  (: print! (-> %Undefined% (->)))
  (: format-args (-> String Expression String))
  ; repr renders an atom's textual form. The argument is Atom-typed (not evaluated) so repr shows the
  ; atom as written; to repr a reduced form, evaluate it first (e.g. bind it with let).
  (: repr (-> Atom String))

  ; trace! prints its first argument and returns the (evaluated) second.
  (: trace! (-> %Undefined% %Undefined% %Undefined%))
  (= (trace! $msg $ret) (let $unit (println! $msg) $ret))

  ; include = import a module's contents into the current space.
  (: include (-> Atom %Undefined%))
  (= (include $module) (import! &self $module))

  ; ---- Error system ----
  (: ErrorType Type)
  (: ErrorDescription Type)
  (: IncorrectNumberOfArguments ErrorDescription)
  (: BadType (-> Type Type ErrorDescription))
  (: BadArgType (-> Number Type Type ErrorDescription))

  ; ---- Module system (minimal: @metta-ts resolves modules via import! into a space) ----
  (: module-space-no-deps (-> SpaceType SpaceType))
  (= (module-space-no-deps $s) $s)
  (: print-mods! (-> (->)))
  (= (print-mods!) ())
  (: git-module! (-> Atom (->)))
  (= (git-module! $url) (Error (git-module! $url) "git-module! is not supported in @metta-ts"))

  ; ---- Documentation system (ported from hyperon stdlib.metta) ----
  (: DocDescription Type)
  (: DocInformal Type)
  (: DocFormal Type)
  (: DocItem Type)
  (: DocKindFunction Type)
  (: DocKindAtom Type)
  (: DocType Type)
  (: DocParameters Type)
  (: DocParameter Type)
  (: DocParameterInformal Type)
  (: DocReturn Type)
  (: DocReturnInformal Type)
  (: @doc (-> Atom DocDescription DocParameters DocReturnInformal DocInformal))
  (: @desc (-> String DocDescription))
  (: @param (-> DocType DocDescription DocParameter))
  (: @return (-> DocType DocDescription DocReturn))
  (: @doc-formal (-> DocItem DocKindFunction DocType DocDescription DocParameters DocReturn DocFormal))
  (: @item (-> Atom DocItem))
  (: @kind (-> Atom DocKindFunction))
  (: @type (-> Type DocType))
  (: @params (-> Expression DocParameters))

  (= (get-doc-single-atom $space $atom)
    (let $type (get-type-space $space $atom)
      (if (is-function $type)
        (get-doc-function $space $atom $type)
        (get-doc-atom $space $atom) )))
  (= (get-doc-function $space $name $type)
    (unify $space (@doc $name $desc (@params $params) $ret)
      (let $type' (if (== $type %Undefined%) (undefined-doc-function-type $params) (cdr-atom $type))
      (let ($params' $ret') (get-doc-params $params $ret $type')
        (@doc-formal (@item $name) (@kind function) (@type $type) $desc (@params $params') $ret')))
      Empty ))
  (= (get-doc-atom $space $atom)
    (let $type (get-type-space $space $atom)
      (unify $space (@doc $atom $desc)
        (@doc-formal (@item $atom) (@kind atom) (@type $type) $desc)
        (unify $space (@doc $atom $desc' (@params $params) $ret)
          (get-doc-function $space $atom %Undefined%)
          Empty ))))
  (= (get-doc-params $params $ret $types)
    (let $head-type (car-atom $types)
    (let $tail-types (cdr-atom $types)
      (if (== () $params)
        (let (@return $ret-desc) $ret
          (() (@return (@type $head-type) (@desc $ret-desc))) )
        (let (@param $param-desc) (car-atom $params)
          (let $tail-params (cdr-atom $params)
          (let ($params' $result-ret) (get-doc-params $tail-params $ret $tail-types)
          (let $result-params (cons-atom (@param (@type $head-type) (@desc $param-desc)) $params')
            ($result-params $result-ret) ))))))))
  (= (undefined-doc-function-type $params)
    (if (== () $params) (%Undefined%)
      (let $params-tail (cdr-atom $params)
      (let $tail (undefined-doc-function-type $params-tail)
        (cons-atom %Undefined% $tail) ))))
  (= (help-param! $param)
    (let (@param (@type $type) (@desc $desc)) $param
      (println! (format-args "  {} {}" ((type $type) $desc))) ))
  (: help-space! (-> SpaceType (->)))
  (= (help-space! $space)
    (let $_ (collapse
      (unify $space (@doc $name (@desc $desc) $params $ret)
        (let () (println! (format-args "{} {}" ($name $desc))) Empty)
        Empty )) ()))

  ; mod-space! loads a module into a fresh space and returns it.
  (: mod-space! (-> Atom SpaceType))
  (= (mod-space! $module) (let $s (new-space) (let $u (import! $s $module) $s)))
`;

let cache: Atom[] | undefined;

/** The standard-library atoms (parsed once and cached). Always loaded by the runner. */
export function stdlibAtoms(): Atom[] {
  if (cache === undefined)
    cache = parseAll(STDLIB_SRC, standardTokenizer())
      .filter((t) => !t.bang)
      .map((t) => t.atom);
  return cache;
}
