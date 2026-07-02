; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/translatorrule_fib.metta for MeTTa-TS (Hyperon) conventions.

(= (fib-tr $n $a $b)
   (if (== $n 0)
       $a
       (fib-tr (- $n 1) $b (+ $a $b))))

(= (fib $n)
   (fib-tr $n 0 1))
   

(= (compilefib $n)
   (fib $n))

;can be commented out but then the following will be slower:
!(add-translator-rule! compilefib)

(= (smartfun $b)
   (* (compilefib 10) $b))

!(test (smartfun 42) 2310)
