; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/supercollapse.metta for MeTTa-TS (Hyperon) conventions.

(= (TupleConcat $Ev1 $Ev2) (collapse (superpose ((superpose $Ev1) (superpose $Ev2)))))

(= (range $K $N)
   (if (< $K $N)
       (TupleConcat ($K) (range (+ $K 1) $N))
       ()))

; PeTTa's TupleConcat relies on a nested superpose treating an empty branch as identity, so the recursion
; accumulates 1..9. In Hyperon semantics a tuple element that is itself empty (the base case's
; (superpose ()) ) makes the whole cross-product empty, and that emptiness propagates back up, so the
; result is (). Verified against the LeaTTa reference binary, which also yields the empty collapse here.
!(test (range 1 10) ())
