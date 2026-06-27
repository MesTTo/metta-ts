; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/spaces2.metta for MeTTa-TS (Hyperon) conventions.

(foo 1)
(foo 2)
(foo 42 42)
(foo (42 42))

!(bar 42)
!(bar 43)

(= (answer) 42)

; `(superpose (E1 E2 E3))` evaluates its tuple as a CROSS-PRODUCT of the elements' results (Hyperon
; semantics, verified against the LeaTTa binary), so a tuple element that yields NOTHING — here the
; `(bar $1)` match, since no `bar` atom exists — makes the whole product empty, and the collapse is `()`.
; (PeTTa instead unions the three matches.) The Hyperon-faithful result is therefore `(space () 42)`.
!(test (space (msort (collapse (superpose ((match &self (foo $1) (foo $1))
                                           (match &self (foo $1 $2) (foo $1 $2))
                                           (match &self (bar $1) (bar $1)))))) (answer))
       (space () 42))
