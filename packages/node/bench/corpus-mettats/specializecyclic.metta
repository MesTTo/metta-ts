; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/specializecyclic.metta for MeTTa-TS (Hyperon) conventions.

(= (f1 $f $a) (if (< $a 0)
                  ($f nevercalled 42)
                  (if (== $a 0) 
                      (f2 $f (- $a 1))
                      finish)))
(= (f2 $f $a) (if (< $a 0)
                  ($f nevercalled 42)
                  (f1 $f $a)))

!(test (f1 + 2) finish)

(= (f3 $f $n) (if (== $n 0) finish (f4 $f $n)))
(= (f4 $f $n) (f3 $f (- $n 1)))

!(test (f3 + 1) finish)
