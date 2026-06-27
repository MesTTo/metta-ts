; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/forall.metta for MeTTa-TS (Hyperon) conventions.

(= (f) 1)
(= (f) 2)

(= (g 1) 1)
(= (g 2) 2)

(= (P $X) (< $X 2))

;Arg-free generator function plus check function
!(test (forall (f) P)
       False)

;Arg-ful generator function plus check function
!(test (forall (g $x) P)
       False)

;Arg-ful generator lambda plus check function
!(test (let $genlambda (|-> ($x) (g $x))
            (forall ($genlambda $z) P))
       False)

;Arg-ful generator function plus check lambda
!(test (let $checklambda (|-> ($v) (< $v 2))
            (forall (g 2) $checklambda))
       False)

;Arg-ful generator function plus check lambda
!(test (let $checklambda (|-> ($v) (< $v 2))
            (forall (g 1) $checklambda))
       True)

;Arg-ful generator function plus check lambda
!(test (let $checklambda (|-> ($v) (< $v 2))
            (forall (g 2) $checklambda))
       False)

;Arg-ful generator lambda plus check lambda
!(test (let* (($checklambda (|-> ($v) (< $v 2)))
              ($genlambda (|-> ($x) (g $x))))
             (forall ($genlambda $z) $checklambda))
       False)

;lambdas as arg directly:
!(test (forall ((|-> ($x) (g $x)) $z)
                (|-> ($v) (< $v 2)))
       False)

;lambdas as arg directly:
!(test (forall ((|-> ($x) (g $x)) $z)
                (|-> ($v) (< $v 20)))
       True)

;lambdas as arg with lambda wrapped in syntactic construct:
!(test (forall ((|-> ($x) (g $x)) $z)
               (if True (|-> ($v) (< $v 2)) 42))
       False)

;lambdas as arg with lambda wrapped in syntactic construct:
!(test (forall ((|-> ($x) (g $x)) $z)
               (if True (|-> ($v) (< $v 20)) 42))
       True)

;lambdas as arg with lambda wrapped in syntactic construct:
!(test (forall ((|-> ($x) (* 100 (g $x))) $z)
               (if True (|-> ($v) (< $v 20)) 42))
       False)
