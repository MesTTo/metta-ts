; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/matchtypes.metta for MeTTa-TS (Hyperon) conventions.
;
; match-types and match-type-or are part of @metta-ts's standard prelude (ported from hyperon-experimental
; stdlib.metta), so the PeTTa lib_he redefinitions are dropped to avoid a conflicting second definition.
; The Hyperon match-types treats Atom (and %Undefined%) as a wildcard that matches any type, unlike PeTTa's
; plain `(== $A $B)`, so (match-types Atom Number …) takes the "then" branch.
!(test (match-types Atom Atom "Matched!" "Didn't match") "Matched!")
!(test (match-types Atom Number "Matched!" "Didn't match") "Matched!")
!(test (match-types Number Number "Matched!" "Didn't match") "Matched!")
!(test (match-types Number Bool "Matched!" "Didn't match") "Didn't match")

!(test (match-type-or True Number Number) True)
!(test (match-type-or False Number Number) True)
!(test (match-type-or True Number Bool) True)
!(test (match-type-or False Number Bool) False)
