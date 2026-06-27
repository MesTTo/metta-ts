; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/multicall.metta for MeTTa-TS (Hyperon) conventions.

(= (mycalc $x $y)
   (+ $x $y))

(= (mycalc $x $y)
   (- $x $y))

!(test (collapse (mycalc 1 2))
       (3 -1))
