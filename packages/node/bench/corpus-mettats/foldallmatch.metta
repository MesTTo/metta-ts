; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/foldallmatch.metta for MeTTa-TS (Hyperon) conventions.

(kb 1)
(kb 2)

!(test (foldall + (match &self (kb $n) (+ $n 1)) 0)
       5)

(= (f) 1)
(= (f) 2)

!(test (foldall + (let $x (f) (+ 1 $x)) 0)
        5)
