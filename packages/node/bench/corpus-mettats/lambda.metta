; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/lambda.metta for MeTTa-TS (Hyperon) conventions.
;
; The later tests partially apply a function ((myfunc 42)) and a lambda (((|-> ($x $y) ...) 43) 44),
; which rely on currying. That is a PeTTa execution-model feature offered in @metta-ts as the opt-in
; `curry` module (core stays Hyperon-faithful).
!(import! &self curry)

;fake lambda (works in H-E MeTTa too):
(: apply (-> Expression %Undefined% %Undefined%))
(= (apply (lambda $var $body) $arg)
   (eval (let $var $arg $body)))

(= (applyL1)
   (apply (lambda $x (+ $x 1)) 2))

(= (applyL2)
   (apply (lambda ($x $y) (+ $x $y)) (2 7)))

!(test (applyL1) 3)
!(test (applyL2) 9)

;Proper lambdas that act as first-class compiled functions:
!(test (maplist (|-> ($a) (+ 1 $a)) (1 2 3))
       (2 3 4))

!(test ((|-> ($acc $e) (or (== 1 $e) $acc)) False 1)
       True)

(= (myfunc $a $b) (cons $a $b))

!(test (let $f (myfunc 42)
            ((|-> ($x) ($f ($x 2 3))) 43))
       (42 43 2 3))

!(test (((|-> ($x $y) (42 $x $y)) 43) 44)
       (42 43 44))

(= (myfunc2 $mylambda)
   ($mylambda 43 44))

!(test (let* (($k 45)
              ($lambda (|-> ($x $y) (42 $x $y $k))))
             (myfunc2 $lambda))
       (42 43 44 45))
