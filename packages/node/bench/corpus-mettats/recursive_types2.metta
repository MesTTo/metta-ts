; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/recursive_types2.metta for MeTTa-TS (Hyperon) conventions.

(: Z Nat)
(: S (-> Nat Nat))
(: Greater (-> Nat Nat Bool))
(= (Greater (S $x) Z)
   True)
(= (Greater Z $x)
   False)
(= (Greater (S $x) (S $y))
   (Greater $x $y))

!(test (Greater (S Z) (S Z)) False)    ; False
!(test (Greater (S (S Z)) (S Z)) True) ; True
