// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// PeTTa-compat standard library, written in MeTTa, for functions PeTTa auto-loads (mostly via its translator)
// that are not part of Hyperon's stdlib: anonymous-function application (`|->`), folding over a
// nondeterministic generator (`foldall`), and `maplist`. They are loaded after the Hyperon prelude/stdlib so
// the PeTTa example corpus runs on the same engine. New names only; nothing here shadows a Hyperon op.
//
// The key idioms (see the metta-lang.dev tutorials and chaining/dtl/utils.metta):
//   - Recurse over an expression with a single `(if (== $e ()) base (recurse via car-atom/cdr-atom))` rule,
//     not two pattern rules, so the empty case is not also matched by the recursive one (which would fork).
//   - Mark a generator / function argument `Atom`-typed so it is passed unevaluated; a function value (a
//     symbol or a `|->` lambda) must not be reduced before it is applied.
//   - Apply a `|->` lambda through `sealed`, giving each application a private copy of the lambda's variables
//     so repeated applications (e.g. inside a fold) do not capture one another.
import { type Atom } from "./atom";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";

export const PETTA_STDLIB_SRC = `
  ; ---- Types of the PeTTa-compat grounded ops (grounded in builtins.ts pettaEntries). These are not
  ; Hyperon ops; PeTTa's lib_builtin_types declares them, so the types are declared here to match. ----
  (: exp (-> Number Number))
  (: min (-> Number Number Number))
  (: max (-> Number Number Number))

  ; A |-> lambda is a value: (|-> (params) body) has no rewrite of its own, only its application does.
  ; The body is Atom-typed so it is carried unevaluated. Without this, evaluating the lambda value (e.g.
  ; when it is bound by let, whose value slot is %Undefined%-typed and so evaluated) would reduce the body
  ; early, collapsing a nondeterministic body before the lambda is ever applied.
  (: |-> (-> Expression Atom Atom))

  ; ---- anonymous function application: ((|-> (params...) body) args...) ----
  ; Each clause seals the (params body) to fresh variables, binds the fresh params to the arguments, then
  ; evaluates the fresh body. sealing is what makes a lambda reusable inside a higher-order function.
  ; Limitation: one clause per arity (1-5 here). A single variadic clause is not expressible because a
  ; MeTTa rule head has a fixed shape — it cannot match "the lambda applied to any number of arguments";
  ; extend by adding the next arity. (PeTTa handles this in its translator, not in MeTTa.)
  (= ((|-> ($p1) $body) $a1)
     (let* (((($q1) $sb) (sealed () (($p1) $body))) ($q1 $a1)) $sb))
  (= ((|-> ($p1 $p2) $body) $a1 $a2)
     (let* (((($q1 $q2) $sb) (sealed () (($p1 $p2) $body))) ($q1 $a1) ($q2 $a2)) $sb))
  (= ((|-> ($p1 $p2 $p3) $body) $a1 $a2 $a3)
     (let* (((($q1 $q2 $q3) $sb) (sealed () (($p1 $p2 $p3) $body))) ($q1 $a1) ($q2 $a2) ($q3 $a3)) $sb))
  (= ((|-> ($p1 $p2 $p3 $p4) $body) $a1 $a2 $a3 $a4)
     (let* (((($q1 $q2 $q3 $q4) $sb) (sealed () (($p1 $p2 $p3 $p4) $body)))
            ($q1 $a1) ($q2 $a2) ($q3 $a3) ($q4 $a4)) $sb))
  (= ((|-> ($p1 $p2 $p3 $p4 $p5) $body) $a1 $a2 $a3 $a4 $a5)
     (let* (((($q1 $q2 $q3 $q4 $q5) $sb) (sealed () (($p1 $p2 $p3 $p4 $p5) $body)))
            ($q1 $a1) ($q2 $a2) ($q3 $a3) ($q4 $a4) ($q5 $a5)) $sb))

  ; ---- foldall: fold an aggregator over ALL nondeterministic results of a generator ----
  ; The generator is Atom-typed so it reaches foldall unevaluated; collapse then runs it and collects the
  ; results into a tuple, which fold-over walks left to right. The aggregator stays Atom-typed (a symbol or a
  ; lambda); the accumulator is evaluated so each application reduces.
  (: foldall (-> Atom Atom Atom %Undefined%))
  (: fold-over (-> Atom %Undefined% Atom %Undefined%))
  (= (fold-over $agg $acc $t)
     (if (== $t ())
         $acc
         (let* (($h (car-atom $t)) ($r (cdr-atom $t)))
           (fold-over $agg ($agg $acc $h) $r))))
  (= (foldall $agg $gen $init)
     (let $rs (collapse $gen) (fold-over $agg $init $rs)))

  ; ---- cons (PeTTa alias of cons-atom) ----
  (= (cons $h $t) (cons-atom $h $t))

  ; ---- progn: evaluate each argument in order, return the last (arguments evaluate applicatively, so the
  ;      earlier ones run for their side effects) ----
  (= (progn $a) $a)
  (= (progn $a $b) $b)
  (= (progn $a $b $c) $c)
  (= (progn $a $b $c $d) $d)

  ; ---- prog1: evaluate each argument in order, return the FIRST (the others run for their side effects) ----
  (= (prog1 $a) $a)
  (= (prog1 $a $b) $a)
  (= (prog1 $a $b $c) $a)
  (= (prog1 $a $b $c $d) $a)

  ; ---- forall: True iff every nondeterministic result of the generator passes the check ----
  (: forall (-> Atom Atom Bool))
  (: all-true (-> Atom %Undefined% Bool))
  (= (all-true $check $rs)
     (if (== $rs ())
         True
         (let* (($h (car-atom $rs)) ($r (cdr-atom $rs)) ($ok ($check $h)))
           (if $ok (all-true $check $r) False))))
  (= (forall $gen $check)
     (let $rs (collapse $gen) (all-true $check $rs)))

  ; ---- foldl: fold a function over a list, init as the seed; applies ($f elem acc), left to right ----
  (: foldl (-> Atom %Undefined% %Undefined% %Undefined%))
  (= (foldl $f $list $acc)
     (if (== $list ())
         $acc
         (let* (($h (car-atom $list)) ($t (cdr-atom $list)) ($a1 ($f $h $acc)))
           (foldl $f $t $a1))))

  ; ---- reduce: PeTTa's full-evaluation operator. Its argument is %Undefined%-typed, so @metta-ts has
  ;      already evaluated it to a normal form by the time the rule fires; returning it (identity) is
  ;      therefore exactly "fully evaluate the argument". Hyperon's single-step eval is the distinct op.
  (= (reduce $x) $x)

  ; ---- find: True iff a pattern matches anything in a space, else False (PeTTa lib_spaces; the
  ;      minimal-MeTTa unify-space case as a boolean). Uses match + case, both Hyperon ops. ----
  (= (find $space $pattern)
     (case (match $space $pattern True)
           ((True True)
            (Empty False))))

  ; ---- match-count: count matches of a pattern without listifying them (PeTTa lib_spaces). ----
  (= (match-count $space $pattern)
     (foldall + (match $space $pattern 1) 0))

  ; ---- iterate: apply $step ($i $state) -> $state' n times, counting $i up (PeTTa lib_patrick). $step is
  ;      a symbol or a |-> lambda; ($step $i $state) is an ordinary application. ----
  (= (iterate $i $n $state $step)
     (if (== $n 0)
         $state
         (iterate (+ $i 1) (- $n 1) ($step $i $state) $step)))

  ; ---- maplist: apply a function (symbol or lambda) to each element of a tuple ----
  ; cons-atom's head is Atom-typed (unevaluated), so the application ($f $h) and the recursive call are
  ; forced through let* before being consed.
  (: maplist (-> Atom Atom %Undefined%))
  (= (maplist $f $list)
     (if (== $list ())
         ()
         (let* (($h (car-atom $list))
                ($t (cdr-atom $list))
                ($fh ($f $h))
                ($rest (maplist $f $t)))
           (cons-atom $fh $rest))))
`;

let cache: Atom[] | undefined;
/** The PeTTa-compat stdlib atoms (parsed once). */
export function pettaStdlibAtoms(): Atom[] {
  if (cache === undefined)
    cache = parseAll(PETTA_STDLIB_SRC, standardTokenizer())
      .filter((t) => !t.bang)
      .map((t) => t.atom);
  return cache;
}
