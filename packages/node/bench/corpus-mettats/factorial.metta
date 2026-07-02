; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/factorial.metta for MeTTa-TS (Hyperon) conventions.

(= (facF $n)
   (if (== $n 0)
       1
       (* $n (facF (- $n 1)))))

!(test (facF 10) 3628800)
