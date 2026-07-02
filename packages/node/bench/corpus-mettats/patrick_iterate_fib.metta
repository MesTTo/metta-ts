; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/patrick_iterate_fib.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self (library lib_patrick))

(= (fib-step $i ($a $b))
   ($b (+ $a $b)))

(= (fib $n)
   (first (iterate 0 $n (0 1) fib-step)))

!(test (fib 100) 354224848179261915075)
