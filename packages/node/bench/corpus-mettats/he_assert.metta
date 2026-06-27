; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_assert.metta for MeTTa-TS (Hyperon) conventions.

; In Hyperon an `assert*` returns the unit atom `()` on success (PeTTa returns True), so the expected
; value of the wrapping `test` is `()`. A failing assert returns an `(Error ...)`, which the test catches.
!(test (assertEqual (+ 1 2) (- 6 3)) ())
!(test (assertAlphaEqual (h $x $y) (h $a $b)) ())
!(test (assertAlphaEqual (quote (+ $x $y)) (quote (+ $a $b))) ())

; assertEqualToResult's second argument is the expected *result set* (a tuple), not a bare value, and it
; is not evaluated (Hyperon doc: "considered as a set of values of the first argument's evaluation").
; collapse of a single result `r` is the one-element tuple `(r)`.
!(test (assertEqualToResult (+ 1 2) (3)) ())
(= (adder) ($x))
!(test (assertAlphaEqualToResult (adder) (($y))) ())
