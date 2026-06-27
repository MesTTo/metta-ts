; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/foldall.metta for MeTTa-TS (Hyperon) conventions.

(= (f) 2)
(= (f) 3)

(= (g 1) 2)
(= (g 2) 3)

(= (merge $A $B) (+ $A $B))

;agg function plus arg-free generator
!(test (foldall merge (f) 0)
       5)

;agg function plus arg-ful generator
!(test (foldall merge (g $x) 0)
       5)

;agg lambda plus arg-free generator
!(test (let $agglambda (|-> ($x $y) (+ $x $y))
            (foldall $agglambda (f) 0))
       5)

;agg lambda plus arg-ful generator
!(test (let $agglambda (|-> ($x $y) (+ $x $y))
            (foldall $agglambda (g $z) 0))
       5)

;agg lambda plus arg-ful generator
!(test (let $agglambda (|-> ($x $y) (+ $x $y))
            (foldall $agglambda (g $z) 0))
       5)

;agg lambda plus lambda arg-free generator
!(test (let* (($agglambda (|-> ($x $y) (+ $x $y)))
              ($genlambda (|-> ($z) (f))))
            (foldall $agglambda ($genlambda $x) 0))
       5)

;agg lambda plus lambda arg-ful generator
!(test (let* (($agglambda (|-> ($x $y) (+ $x $y)))
              ($genlambda (|-> ($z) (g $z))))
            (foldall $agglambda ($genlambda $x) 0))
       5)

;lambdas as arg directly:
!(test (foldall (|-> ($x $y) (+ $x $y))
                ((|-> ($z) (g $z)) $w) 0)
       5)

;lambdas as arg directly within syntatic construct:
!(test (foldall (if True (let $f (|-> ($x $y) (+ $x $y)) $f) (empty))
                ((|-> ($z) (g $z)) $w) 0)
       5)

;lambdas as arg directly within syntatic construct:
!(test (foldall (if True (let $f (|-> ($x $y) (+ $x $y)) $f) (empty))
                ((|-> ($z) (* 2 (g $z))) $w) 0)
       10)
