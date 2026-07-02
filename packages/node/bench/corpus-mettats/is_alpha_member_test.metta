; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/is_alpha_member_test.metta for MeTTa-TS (Hyperon) conventions.

;;; Test file for member_alpha and is-alpha-member predicates  
;;; This file tests edge cases for alpha-equivalence membership checking  
  
;;; Test 1: Empty list should return False  
!(test (is-alpha-member x ()) False)  
  
;;; Test 2: Variable in list of atoms should not match  
!(test (is-alpha-member $x (a b c)) False)  
  
;;; Test 3: Ground term membership  
!(test (is-alpha-member a (a b c)) True)  
!(test (is-alpha-member d (a b c)) False)  
  
;;; Test 4: Alpha-equivalence with variables  
!(test (is-alpha-member (f $x) ((f $y) (g $z)) ) True)  
!(test (is-alpha-member (f $x) ((f $y) (f $y)) ) True)  
  
;;; Test 5: Complex nested structures  
!(test (is-alpha-member (f (g $x) $y) ((f (g $a) $b) (h $c $d)) ) True)  
!(test (is-alpha-member (f (g $x) $x) ((f (g $a) $b) (f (g $c) $c)) ) True)  
  
;;; Test 6: Different arities should fail  
!(test (is-alpha-member (f $x) ((f $x $y) (g $z)) ) False)  
  
;;; Test 7: Numbers and atoms  
!(test (is-alpha-member 42 (1 2 42 3) ) True)  
!(test (is-alpha-member 99 (1 2 42 3) ) False)  
  
;;; Test 8: Nested lists
; @metta-ts's is-alpha-member tests genuine alpha-equivalence: (1 $x) is NOT alpha-equal to (1 2) (a free
; variable is not equal to the constant 2). PeTTa's member_alpha unifies instead (X = H, binding $x to 2),
; which is unification-membership rather than alpha-membership, so it answers True there.
!(test (is-alpha-member (1 $x) ((1 2) (3 4)) ) False)
!(test (is-alpha-member (1 $x) ((2 3) (4 5)) ) False)  
  
;;; Test 9: Multiple occurrences  
!(test (is-alpha-member a (a b a c)) True)  
  
;;; Test 10: Complex terms with same structure but different variables  
!(test (is-alpha-member (f $x $y) ((f $a $b) (f $c $d)) ) True)  
  
;;; Test 11: Single element list  
!(test (is-alpha-member a (a)) True)  
!(test (is-alpha-member b (a)) False)  
  
;;; Test 12: List with variables as elements  
!(test (is-alpha-member $x ($y $z $w)) True)  
  
;;; Test 13: Deeply nested structures  
!(test (is-alpha-member (a (b (c $x))) ((a (b (c $d))) (e $f)) ) True)  
  
;;; Test 14: Terms with different functors  
!(test (is-alpha-member (f $x) ((g $y) (h $z)) ) False)  
  
;;; Test 15: Empty complex terms  
!(test (is-alpha-member () (() a b) ) True)  
!(test (is-alpha-member () (a b c) ) False)

!(let*
    (
        ($pat (hi name boss))
        ($dummy1 (println! (pattern:- $pat)))
        ($bool (is-alpha-member $new $pat))
        ($dummy2 (println! (is member:- $bool in pattern:- $pat)))
    )
    ()
)