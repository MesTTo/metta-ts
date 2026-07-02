; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/functiontypes.metta for MeTTa-TS (Hyperon) conventions.

(: wu1 (-> Number Expression Expression))
(= (wu1 $a $b)
   (42 $a $b))

(: wu2 (-> Number Number Number))
(= (wu2 $a $b)
   (+ $a $b))

(: wu3 (-> Number Number %Undefined%))
(= (wu3 $a $b)
   (if (< $a 10)
       (+ $a $b)
       (a list not a number)))

; wu1's second parameter is Expression-typed, so per the Hyperon spec (metta returns an argument
; unevaluated when its meta-type already equals the expected type) the argument (+ 4 2) is NOT evaluated
; before the call; the body becomes (42 6 (+ 4 2)), which then reduces to (42 6 6). PeTTa instead wraps
; the result in quote and keeps (+ 4 2) literal. (The LeaTTa binary evaluates the Expression-typed arg and
; reports BadArgType — it diverges from the spec here; @metta-ts follows the spec.)
!(test (wu1 (+ 2 4) (+ 4 2)) (42 6 6))

!(test (wu2 (+ 2 4) (+ 4 2)) 12)

!(test (wu3 42 0) (a list not a number))

!(test (wu3 2 0) 2)
