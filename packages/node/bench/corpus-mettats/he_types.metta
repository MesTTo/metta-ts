; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_types.metta for MeTTa-TS (Hyperon) conventions.


!(test (is-function (-> Atom Atom)) True)
!(test (is-function Atom) False)
;TODO:
;(: type1 Type)
;!(type-cast A type1 &self)
;!(type-cast 1 type1 &self)
!(test (match-types Atom Atom "Matched!" "Didn't match") "Matched!")
; Hyperon match-types treats Atom as a wildcard that matches any type, so this is "Matched!".
!(test (match-types Atom Number "Matched!" "Didn't match") "Matched!")
!(test (first-from-pair (A B)) A)
!(test (second-from-pair (A B)) B)
!(test (match-type-or True Number Bool) True)
