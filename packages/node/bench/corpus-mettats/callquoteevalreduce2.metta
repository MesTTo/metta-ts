; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/callquoteevalreduce2.metta for MeTTa-TS (Hyperon) conventions.

(= (fib $N)
   (if (< $N 2)
       $N
       (+ (fib (- $N 1))
          (fib (- $N 2)))))

(= (myfunc)
   5)

(= (call-fib)
   (call (fib (myfunc))))

(= (quote-fib)
   (quote (fib (myfunc))))

(= (eval-fib)
   (eval (fib (myfunc))))

(= (reduce-fib)
   (reduce (fib (myfunc))))

; call-fib and eval-fib are omitted: PeTTa's `call` and `eval` force a FULL evaluation, but Hyperon has no
; `call`, and its `eval` is a single minimal-MeTTa step (so `(eval (fib (myfunc)))` only unfolds one rule,
; not all the way to 5). `quote` (hold as data) and `reduce` (the PeTTa-compat full reducer @metta-ts
; provides) are Hyperon-expressible and kept.
!(test (fib-quote (quote-fib)) (fib-quote (quote (fib (myfunc)))))
!(test (fib-reduce (reduce-fib)) (fib-reduce 5))
