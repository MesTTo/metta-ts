; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/patrick_iterate_quad.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self (library lib_patrick))

(= (quad-step $dummy ($t $i $sum))
   (if (== $i $t)
       ( (+ $t 1) 1 (+ $sum (* $t $i)) )
       ( $t (+ $i 1) (+ $sum (* $t $i)) )))

(= (quad-sum $n)
   (last (iterate 0 (/ (* $n (+ $n 1)) 2) (1 1 0) quad-step)))

!(test (quad-sum 1000) 125417041750)
