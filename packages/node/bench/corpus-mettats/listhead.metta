; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/listhead.metta for MeTTa-TS (Hyperon) conventions.

;First check out constanthead.metta for the simpler case:
(= (len ()) 0)
(= (len (cons $Head $Tail))
   (let $N0 (len $Tail)
        (+ $N0 1)))

; The first two tests depend on PeTTa's cons-list matching, where `(cons $Head $Tail)` unifies with a
; flat tuple `(1 2 3 4 5 6)` (PeTTa lists are cons cells). Hyperon expressions are flat, so `(cons …)` is
; an ordinary 3-element pattern that does not match; the @metta-ts idiom is car-atom/cdr-atom. Only the
; plain `cons` builder test is Hyperon-faithful here.
!(test (cons 42 ()) (42))
;Now please out functionhead.metta for a generalization of the idea!
