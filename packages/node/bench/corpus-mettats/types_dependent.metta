; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/types_dependent.metta for MeTTa-TS (Hyperon) conventions.

;get-type extension for numbers:
(= (get-type $x)
   (catch (if (== (% $x 2) 0)
              EvenNumber)))

;try it:
(: f (-> EvenNumber EvenNumber EvenNumber))
(= (f $x $y)
   (+ $x $y))

!(test (f 2 4) 6)

;get-type extension for list of even numbers:
(= (get-type (cons $head $tail))
   (if (== (get-type $head) EvenNumber)
       (if (== $tail ())
           EvenNumberList
           (get-type $tail))))

;try it:
(: g (-> EvenNumberList Bool))
(= (g $L)
   True)

!(test (g (2 4 6)) True)
