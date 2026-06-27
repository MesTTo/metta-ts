; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/builin_types.metta for MeTTa-TS (Hyperon) conventions.

;; @metta-ts declares the types of its grounded ops in its own stdlib (Hyperon's grounded atoms
;; carry their type intrinsically), so no lib import is needed.

;; Test type definitions of arithmetic operators
!(test (get-type +) (-> Number Number Number))
!(test (get-type -) (-> Number Number Number))
!(test (get-type *) (-> Number Number Number))
!(test (get-type /) (-> Number Number Number))
!(test (get-type %) (-> Number Number Number))

;; Test type definitions of comparison operators
!(test (get-type <) (-> Number Number Bool))
!(test (get-type <=) (-> Number Number Bool))
!(test (get-type >) (-> Number Number Bool))
!(test (get-type >=) (-> Number Number Bool))

;; Type of the equality operator. In Hyperon `==` is (-> $t $t Bool) (the two operands share one type
;; variable, unlike PeTTa's (-> $a $b Bool)). There is no `!=` grounded op in Hyperon, so that line is dropped.
!(test (get-type ==) (-> $t $t Bool))

;; Test type definitions of common mathematical functions
!(test (get-type pow-math) (-> Number Number Number))
!(test (get-type sqrt-math) (-> Number Number))
!(test (get-type abs-math) (-> Number Number))
!(test (get-type log-math) (-> Number Number Number))
!(test (get-type trunc-math) (-> Number Number))
!(test (get-type ceil-math) (-> Number Number))
!(test (get-type floor-math) (-> Number Number))
!(test (get-type round-math) (-> Number Number))
!(test (get-type sin-math) (-> Number Number))
!(test (get-type asin-math) (-> Number Number))
!(test (get-type cos-math) (-> Number Number))
!(test (get-type acos-math) (-> Number Number))
!(test (get-type tan-math) (-> Number Number))
!(test (get-type atan-math) (-> Number Number))
!(test (get-type min-atom) (-> %Undefined% Number))
!(test (get-type max-atom) (-> %Undefined% Number))
!(test (get-type min) (-> Number Number Number))
!(test (get-type max) (-> Number Number Number))
!(test (get-type exp) (-> Number Number))

;; Test type definitions of isnan and isinf predicates
!(test (get-type isnan-math) (-> Number Bool))
!(test (get-type isinf-math) (-> Number Bool))

;; Type definitions of boolean operators
!(test (get-type and) (-> Bool Bool Bool))
!(test (get-type or) (-> Bool Bool Bool))
!(test (get-type not) (-> Bool Bool))
!(test (get-type xor) (-> Bool Bool Bool))
