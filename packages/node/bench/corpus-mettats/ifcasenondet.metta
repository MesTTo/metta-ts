; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/ifcasenondet.metta for MeTTa-TS (Hyperon) conventions.

(= (if-nondet $y)
  (if (superpose $y) a b))
  
(= (case-nondet $y)
   (case (superpose $y)
         ((True a)
          (False b))))

!(test (collapse (if-nondet (True False True))) (a b a))

!(test (collapse (case-nondet (True False True))) (a b a))
