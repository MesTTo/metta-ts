; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/types.metta for MeTTa-TS (Hyperon) conventions.

;Concrete types

(: a A)
(: b B)
(: A Type)
(: x Letter)
(: x Buchstabe)

; get-type of a free variable is %Undefined% in Hyperon (types.rs get_atom_types), not a fresh type
; variable as in PeTTa.
!(test (get-type $a) %Undefined%)
!(test (get-type a) A)
!(test (get-type b) B)
!(test (get-type c) %Undefined%)
!(test (get-type A) Type)
!(test (get-type B) %Undefined%)
!(test (get-type (a b)) (A B))
!(test (get-type 42) Number)
!(test (get-type "42") String)

!(test (collapse (get-type x)) (Letter Buchstabe))
 
;Function Types

(: mid (-> $a $a))
(= (mid $x) (let (a b) $x $x))

!(test (mid ($a b)) (a b))

(: testx (-> $a $b $a))
!(test (get-type (testx 1 "f")) Number)

;Non-Deterministic Types

(: at A)
(: at T)

(: t T)

(: testf (-> $a $a))
(= (testf at) t)

!(test (testf at) t)


