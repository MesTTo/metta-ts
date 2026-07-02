; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/patrick_test.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self (library lib_patrick))

(= (mirror (@ $L (cons $head $tail)))
   (append (reverse $L) $tail))

!(test (mirror (h a n n e s)) (s e n n a h a n n e s))

!(test (collapse (for $x (1 2 3 4 5 6)
                      (if (> $x 3) $x)))
       (4 5 6))
      
!(test (iterate 0 10
                1 (|-> ($i $x)
                       (+ $x $i)))
       46)
