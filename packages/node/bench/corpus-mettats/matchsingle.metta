; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matchsingle.metta for MeTTa-TS (Hyperon) conventions.

(a b)
(a c)

; PeTTa commits to the first match with Prolog's `(cut)`. Hyperon/@metta-ts has no backtracking to cut;
; the idiomatic way to keep just the first nondeterministic result is `once`, so both helpers use it.
(= (match-single-via-once $space $pattern $outPattern)
   (once (match $space $pattern $outPattern)))

!(test (collapse (match-single-via-once &self (a $x) (a $x))) ((a b)))
