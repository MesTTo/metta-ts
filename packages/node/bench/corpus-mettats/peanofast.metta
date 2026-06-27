; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/peanofast.metta for MeTTa-TS (Hyperon) conventions.

;Peano builders:
(= (expandK $expression $n)
   (if (== $n 0)
       done
       (let $temp1 (add-atom &self (num $expression))
            (expandK (S $expression) (- $n 1)))))

;Peano demo:
(= (demo-peano $K)
   (expandK Z $K))

!(demo-peano 2500)
!(test (length (collapse (match &self (num $1) $1))) 2500)
