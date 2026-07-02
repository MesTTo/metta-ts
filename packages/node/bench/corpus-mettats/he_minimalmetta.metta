; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_minimalmetta.metta for MeTTa-TS (Hyperon) conventions.


(= (div $x $y $accum)
   (chain (eval (- $x $y)) $r1
     (chain (eval (< $r1 0)) $r2
       (chain (unify $r2 True
         $accum
         (chain (eval (+ 1 $accum)) $inc
           (chain (eval (div $r1 $y $inc)) $r4 $r4)
         )) $r3 $r3
       )
     )
   )
)

!(test (chain (eval (div 350000 5 0)) $rr $rr) 70000)
