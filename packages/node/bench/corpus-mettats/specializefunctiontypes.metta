; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/specializefunctiontypes.metta for MeTTa-TS (Hyperon) conventions.

(= (g $x) $x)

(: f (-> Atom Number Atom))
(: f (-> Atom String Atom))
(= (f $g $x)
   (repra ($g $x)))

!(f g 42)

!(test (match &self (: f_Spec_[g] (-> Atom Number Atom)) ok) ok)
!(test (match &self (: f_Spec_[g] (-> Atom String Atom)) ok) ok)
