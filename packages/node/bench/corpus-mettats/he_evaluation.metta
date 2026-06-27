; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_evaluation.metta for MeTTa-TS (Hyperon) conventions.


(= (double $x) (+ $x $x))

; PeTTa's `eval` fully evaluates; Hyperon's `eval` is a single step, so `(eval (double 5))` only unfolds
; the rule to `(+ 5 5)`. The Hyperon idiom for full evaluation is `(metta … %Undefined% &self)`.
!(test (metta (double 5) %Undefined% &self) 10)

; evalc on a grounded call computes in one step (+ is grounded), so a single step already yields 10.
!(test (evalc (+ 5 5) &self) 10)

!(test (chain (+ 2 3) $x (* $x 2)) 10)

; for-each-in-atom runs its function for side effects and returns the unit atom () in Hyperon (PeTTa
; collects the per-element results into a tuple).
!(test (for-each-in-atom (1 3 5 62 2 5) println!) ())
