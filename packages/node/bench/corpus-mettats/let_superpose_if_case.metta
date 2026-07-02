; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/let_superpose_if_case.metta for MeTTa-TS (Hyperon) conventions.

(= (f $x) 42)

(= (progme) 
   (let $y (superpose (2 3 4 5))
                  (if (> $y 2)
                      (case (1 $y) (((1 3) (f 0))
                                    ((1 4) (42 42))
                                    ($else (42 42 42))))
                      answertoeverything)))

!(test (collapse (progme))
       (answertoeverything 42 (42 42) (42 42 42)))
