; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/curry.metta for MeTTa-TS (Hyperon) conventions.
;
; Currying (partial application) is a PeTTa execution-model feature, not Hyperon semantics: PeTTa's
; translator turns every under-applied call into a `partial`. @metta-ts keeps the core Hyperon-faithful
; and offers the same behaviour as the opt-in `curry` module. PeTTa curries at translation time, so its
; `repr` sees the already-partial term; @metta-ts curries at evaluation time, so the repr tests bind the
; under-applied call with `let` (whose value is evaluated) before taking its repr.
!(import! &self curry)

(= (f $a $b) (+ $a $b))

(= (g $a $b $c) (+ $c (+ $a $b)))

!(test (let $p (f 1) (repr $p)) "(partial f (1))")
!(test ((f 1) 2) 3)
!(test (let $p (g 1 2) (repr $p)) "(partial g (1 2))")

(= (h $A $B)
   (append ($A) $B))

!(test ((h 42) (1 2 3)) (42 1 2 3))
!(test (let $p (h 42) (repr $p)) "(partial h (42))")
; PeTTa's 2-argument map-atom applies a function to each element; that conflicts with Hyperon's
; 3-argument map-atom, so @metta-ts uses maplist (the PeTTa-compat mapper) with the curried `(+ 1)`.
!(test (maplist (+ 1) (1 2 3)) (2 3 4))
