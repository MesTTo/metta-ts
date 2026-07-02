; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/fibsmart.metta for MeTTa-TS (Hyperon) conventions.

(= (fib-tr $n $a $b)
   (if (== $n 0)
       $a
       (fib-tr (- $n 1) $b (+ $a $b))))

(= (fib $n)
   (fib-tr $n 0 1))

!(test (fib 100) 354224848179261915075)
