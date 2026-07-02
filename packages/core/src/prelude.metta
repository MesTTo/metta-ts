; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

(: + (-> Number Number Number))
   (: - (-> Number Number Number))
   (: * (-> Number Number Number))
   (: / (-> Number Number Number))
   (: % (-> Number Number Number))
   (: = (-> $t $t %Undefined%))
   (: == (-> $t $t Bool))
   (: < (-> Number Number Bool))
   (: > (-> Number Number Bool))
   (: <= (-> Number Number Bool))
   (: >= (-> Number Number Bool))
   (: get-type (-> Atom Atom))
   (: get-doc (-> Atom %Undefined%))
   (: help! (-> Atom %Undefined%))
   (: eval (-> Atom Atom))
   (: evalc (-> Atom SpaceType Atom))
   (: chain (-> Atom Variable Atom %Undefined%))
   (: unify (-> Atom Atom Atom Atom %Undefined%))
   (: function (-> Atom Atom))
   (: return (-> Atom Atom))
   (: cons-atom (-> Atom Expression Atom))
   (: decons-atom (-> Expression Atom))
   (: collapse-bind (-> Atom Expression))
   (: superpose-bind (-> Expression Atom))
   (: metta (-> Atom Atom Atom Atom))
   (: quote (-> Atom Atom))
   (: new-state (-> $t (StateMonad $t)))
   (: change-state! (-> (StateMonad $t) $t (StateMonad $t)))
   (: if (-> Bool Atom Atom $t))
   (: let (-> Atom %Undefined% Atom %Undefined%))
   (: let* (-> Expression Atom %Undefined%))
   (: car-atom (-> Expression %Undefined%))
   (: cdr-atom (-> Expression Expression))
   (: switch (-> %Undefined% Expression %Undefined%))
   (: interpret-tuple (-> Atom Atom Atom))
   (= (interpret-tuple $expr $space)
      (function (eval (if-equal $expr ()
        (return ())
        (chain (decons-atom $expr) $ht
          (unify ($head $tail) $ht
            (chain (metta-thread $head %Undefined% $space) $rhead
              (chain (eval (interpret-tuple $tail $space)) $rtail
                (chain (cons-atom $rhead $rtail) $res (return $res))))
            (return $expr)))))))
   (: switch-minimal (-> Atom Expression Atom))
   (: switch-internal (-> Atom Expression Atom))
   (: collapse (-> Atom Atom))
   (: unique (-> Atom %Undefined%))
   (: union (-> Atom Atom %Undefined%))
   (: intersection (-> Atom Atom %Undefined%))
   (: subtraction (-> Atom Atom %Undefined%))
   (: Error (-> Atom Atom Atom))
   (: noeval (-> Atom Atom))
   (: id (-> $t $t))
   (: match (-> Atom Atom Atom %Undefined%))
   (: if-decons-expr (-> Expression Variable Variable Atom Atom %Undefined%))
   (: foldl-atom (-> Expression Atom Variable Variable Atom %Undefined%))
   (: assert (-> Atom (->)))
   (: assertIncludes (-> Atom Expression (->)))
   (: assertEqual (-> Atom Atom (->)))
   (: assertEqualMsg (-> Atom Atom Atom (->)))
   (: assertEqualToResult (-> Atom Atom (->)))
   (: assertEqualToResultMsg (-> Atom Atom Atom (->)))
   (: assertAlphaEqual (-> Atom Atom (->)))
   (: assertAlphaEqualMsg (-> Atom Atom Atom (->)))
   (: assertAlphaEqualToResult (-> Atom Atom (->)))
   (: assertAlphaEqualToResultMsg (-> Atom Atom Atom (->)))
   (= (if True $t $e) $t)
   (= (if False $t $e) $e)
   (= (id $x) $x)
   (= (noeval $x) $x)
   (= (quote $atom) NotReducible)
   (= (unquote (quote $atom)) $atom)
   (= (nop) ())
   (= (let $pattern $atom $template) (unify $atom $pattern $template Empty))
   (= (let* $pairs $template)
      (chain (decons-atom $pairs) $ht
        (unify ($head $tail) $ht
          (unify ($pat $at) $head
            (let $pat $at (let* $tail $template))
            (Error (let* $pairs $template) bad-let-star))
          $template)))
   (= (car-atom $a)
      (chain (decons-atom $a) $ht (unify ($head $tail) $ht $head (Error (car-atom $a) car-atom-empty))))
   (= (cdr-atom $a)
      (chain (decons-atom $a) $ht (unify ($head $tail) $ht $tail (Error (cdr-atom $a) cdr-atom-empty))))
   (= (switch $atom $cases) (id (switch-minimal $atom $cases)))
   (= (switch-minimal $atom $cases)
      (function (chain (decons-atom $cases) $list
        (chain (eval (switch-internal $atom $list)) $res
          (chain (eval (if-equal $res NotReducible Empty $res)) $x (return $x))))))
   (= (switch-internal $atom (($pattern $template) $tail))
      (function (unify $atom $pattern
        (return $template)
        (chain (eval (switch-minimal $atom $tail)) $ret (return $ret)))))
   (: case (-> Atom Expression %Undefined%))
   (= (case $atom $cases)
      (function
        (chain (context-space) $space
        (chain (collapse-bind (metta $atom %Undefined% $space)) $c
        (chain (eval (== $c ())) $is_empty
        (unify $is_empty True
          (chain (eval (switch-minimal Empty $cases)) $r (return $r))
          (chain (superpose-bind $c) $e
            (chain (eval (switch-minimal $e $cases)) $r (return $r)))))))))
   (= (collapse $atom)
      (function (chain (context-space) $space
        (chain (collapse-bind (metta $atom %Undefined% $space)) $pairs
          (chain (eval (collapse-extract $pairs)) $r (return $r))))))
   (= (unique $arg) (let $c (collapse $arg) (let $u (unique-atom $c) (superpose $u))))
   (= (union $a $b) (let $c1 (collapse $a) (let $c2 (collapse $b) (let $u (union-atom $c1 $c2) (superpose $u)))))
   (= (intersection $a $b) (let $c1 (collapse $a) (let $c2 (collapse $b) (let $u (intersection-atom $c1 $c2) (superpose $u)))))
   (= (subtraction $a $b) (let $c1 (collapse $a) (let $c2 (collapse $b) (let $u (subtraction-atom $c1 $c2) (superpose $u)))))
   (: atom-subst (-> Atom Variable Atom Atom))
   (= (atom-subst $atom $var $templ)
      (function (chain (eval (noeval $atom)) $var (return $templ))))
   (: map-atom (-> Expression Variable Atom Expression))
   (= (map-atom $list $var $map)
      (function (chain (decons-atom $list) $ht
        (unify ($head $tail) $ht
          (chain (eval (sealed ($var) $map)) $sealedmap
            (chain (eval (map-atom $tail $var $sealedmap)) $tail-mapped
              (chain (eval (atom-subst $head $var $sealedmap)) $map-expr
                (chain (metta $map-expr %Undefined% &self) $head-mapped
                  (chain (cons-atom $head-mapped $tail-mapped) $res (return $res))))))
          (return ())))))
   (: filter-atom (-> Expression Variable Atom Expression))
   (= (filter-atom $list $var $filter)
      (function (chain (decons-atom $list) $ht
        (unify ($head $tail) $ht
          (chain (eval (sealed ($var) $filter)) $sealedfilter
            (chain (eval (filter-atom $tail $var $sealedfilter)) $tail-filtered
              (chain (eval (atom-subst $head $var $sealedfilter)) $filter-expr
                (chain (metta $filter-expr %Undefined% &self) $is-filtered
                  (eval (if $is-filtered
                    (chain (cons-atom $head $tail-filtered) $res (return $res))
                    (return $tail-filtered)))))))
          (return ())))))
   (= (if-decons-expr $atom $head $tail $then $else)
      (function (eval (if-equal $atom ()
        (return $else)
        (chain (decons-atom $atom) $list
          (unify $list ($head $tail) (return $then) (return $else)))))))
   (= (foldl-atom $list $init $a $b $op)
      (function (eval (if-equal $list ()
        (return $init)
        (chain (decons-atom $list) $ht
          (unify ($head $tail) $ht
            (chain (eval (atom-subst $init $a $op)) $op1
              (chain (eval (atom-subst $head $b $op1)) $op2
                (chain (metta $op2 %Undefined% &self) $newacc
                  (chain (eval (foldl-atom $tail $newacc $a $b $op)) $r (return $r)))))
            (return $init)))))))
   (= (assert $atom)
      (chain (context-space) $space
        (chain (metta $atom %Undefined% $space) $eval-atom
          (unify $eval-atom True () (Error (assert $atom) ($atom not True))))))
   (= (assertIncludes $atom $content)
      (let $eval_atom (collapse $atom)
        (let $diff (subtraction-atom $content $eval_atom)
          (if (== $diff ())
            ()
            (Error (assertIncludes $atom $content)
              (assertIncludes error: $diff not included in result: $eval_atom))))))
   (= (assertEqual $actual $expected)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (chain (metta (collapse $expected) %Undefined% $space) $expected-results
            (eval (_assert-results-are-equal $actual-results $expected-results (assertEqual $actual $expected)))))))
   (= (assertEqualMsg $actual $expected $msg)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (chain (metta (collapse $expected) %Undefined% $space) $expected-results
            (eval (_assert-results-are-equal-msg $actual-results $expected-results (assertEqualMsg $actual $expected) $msg))))))
   (= (assertEqualToResult $actual $expected-results)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (eval (_assert-results-are-equal $actual-results $expected-results (assertEqualToResult $actual $expected-results))))))
   (= (assertEqualToResultMsg $actual $expected-results $msg)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (eval (_assert-results-are-equal-msg $actual-results $expected-results (assertEqualToResultMsg $actual $expected-results) $msg)))))
   (= (assertAlphaEqual $actual $expected)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (chain (metta (collapse $expected) %Undefined% $space) $expected-results
            (eval (_assert-results-are-alpha-equal $actual-results $expected-results (assertAlphaEqual $actual $expected)))))))
   (= (assertAlphaEqualMsg $actual $expected $msg)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (chain (metta (collapse $expected) %Undefined% $space) $expected-results
            (eval (_assert-results-are-alpha-equal-msg $actual-results $expected-results (assertAlphaEqualMsg $actual $expected) $msg))))))
   (= (assertAlphaEqualToResult $actual $expected-results)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (eval (_assert-results-are-alpha-equal $actual-results $expected-results (assertAlphaEqualToResult $actual $expected-results))))))
   (= (assertAlphaEqualToResultMsg $actual $expected-results $msg)
      (chain (context-space) $space
        (chain (metta (collapse $actual) %Undefined% $space) $actual-results
          (eval (_assert-results-are-alpha-equal-msg $actual-results $expected-results (assertAlphaEqualToResultMsg $actual $expected-results) $msg)))))
   (: noreduce-eq (-> Atom Atom Bool))
   (= (noreduce-eq $a $b) (== (quote $a) (quote $b)))
   (: if-error (-> Atom Atom Atom %Undefined%))
   (= (if-error $atom $then $else)
      (function (chain (eval (get-metatype $atom)) $meta
        (eval (if-equal $meta Expression
          (eval (if-equal $atom ()
            (return $else)
            (chain (decons-atom $atom) $list
              (unify $list ($head $tail)
                (eval (if-equal $head Error (return $then) (return $else)))
                (return $else) ))))
          (return $else) )))))
   (: return-on-error (-> Atom Atom %Undefined%))
   (= (return-on-error $atom $then)
      (function (eval (if-equal $atom Empty (return (return Empty))
        (eval (if-error $atom (return (return $atom))
          (return $then) ))))))
   (: for-each-in-atom (-> Expression Atom (->)))
   (= (for-each-in-atom $expr $func)
      (if (noreduce-eq $expr ())
        ()
        (let $head (car-atom $expr)
          (let $tail (cdr-atom $expr)
          (let $_ ($func $head)
          (for-each-in-atom $tail $func) )))))
   (: is-function (-> Type Bool))
   (= (is-function $type)
      (let $mtype (get-metatype $type)
        (unify $mtype Expression
          (let $size (size-atom $type)
            (unify $size 0
              False
              (let ($h $t) (decons-atom $type)
                (unify $h -> True False))))
          False)))
   (: match-types (-> Type Type Atom Atom %Undefined%))
   (= (match-types $type1 $type2 $then $else)
      (function (eval (if-equal $type1 %Undefined%
        (return $then)
        (eval (if-equal $type2 %Undefined%
          (return $then)
          (eval (if-equal $type1 Atom
            (return $then)
            (eval (if-equal $type2 Atom
              (return $then)
              (unify $type1 $type2 (return $then) (return $else)) ))))))))))
   (: match-type-or (-> Bool Atom Type Bool))
   (= (match-type-or $folded $next $type)
      (function
        (chain (eval (match-types $next $type True False)) $matched
          (chain (eval (or $folded $matched)) $or (return $or)) )))
   (: first-from-pair (-> Expression Atom))
   (= (first-from-pair $pair)
      (function
        (unify $pair ($first $second)
          (return $first)
          (return (Error (first-from-pair $pair) "incorrect pair format")))))
   (: type-cast-error-or-bad-type (-> Atom Expression Atom))
   (= (type-cast-error-or-bad-type $atom $actual-types)
      (function
        (chain (eval (filter-atom $actual-types $actual (eval (if-error $actual True False)))) $actual-errors
          (chain (decons-atom $actual-errors) $error-and-tail
            (unify $error-and-tail ($error $tail)
              (return $error)
              (return (Error $atom BadType)))))))
   (: type-cast (-> Atom Type Space %Undefined%))
   (= (type-cast $atom $type $space)
      (function (chain (eval (get-metatype $atom)) $meta
        (eval (if-equal $type $meta
          (return $atom)
          (chain (eval (collapse-bind (eval (get-type $atom $space)))) $collapsed
            (chain (eval (map-atom $collapsed $pair (eval (first-from-pair $pair)))) $actual-types
              (chain (eval (foldl-atom $actual-types False $a $b (eval (match-type-or $a $b $type)))) $is-some-comp
                (eval (if $is-some-comp
                  (return $atom)
                  (chain (eval (type-cast-error-or-bad-type $atom $actual-types)) $error (return $error)) ))))))))))
   (: ErrorType Type)
   (: SpaceType Type)
   (: BadType (-> Type Type ErrorDescription))
   (: BadArgType (-> Number Type Type ErrorDescription))
   (: IncorrectNumberOfArguments ErrorDescription)
   (: add-atom (-> SpaceType Atom (->)))
   (: remove-atom (-> SpaceType Atom (->)))
   (: add-reduct (-> SpaceType %Undefined% (->)))
   (= (add-reduct $dst $atom) (add-atom $dst $atom))
   (: add-reducts (-> SpaceType %Undefined% (->)))
   (= (add-reducts $space $tuple) (foldl-atom $tuple () $a $b (add-reduct $space $b)))
   (: add-atoms (-> SpaceType Expression (->)))
   (= (add-atoms $space $tuple) (foldl-atom $tuple () $a $b (add-atom $space $b)))
