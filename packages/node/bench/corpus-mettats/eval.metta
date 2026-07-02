; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/eval.metta for MeTTa-TS (Hyperon) conventions.

(= (f $L $a $b)
   (let $result (+ $a $b)
        (append ($result) $L)))

;Match does not automatically interpret the returned pattern as code:
;!(match &self (= (f 40.7 2) $x) $x)

;But we can fully evaluate the matched body if we desire. PeTTa's `eval` forces a full evaluation;
;Hyperon's `eval` is a single minimal-MeTTa step, so the Hyperon idiom is (metta $body %Undefined% &self).
!(test (let $fbody_specialized (match &self (= (f (42) 40.7 2) $x) $x) (metta $fbody_specialized %Undefined% &self))
       (42.7 42))

;Additionally we can emulate eval by using add-atom and remove-atom (not recommended):
(= (evalCustom $body)
   (let* (($a   (add-atom &self (= (myfunc) $body)))
          ($res (reduce (myfunc)))
          ($r   (remove-atom &self (= (myfunc) $body))))
         $res))

!(test (evalCustom (match &self (= (f (42) 40.7 2) $x) $x))
       (42.7 42))
