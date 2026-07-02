; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/chain.metta for MeTTa-TS (Hyperon) conventions.

; Chain example tests
!(test (chain (+ 2 4) $n (* 3 $n)) 
       18)

!(test (chain (+ 1 3) $n (chain (* 2 $n) $m (+ $n $m))) 
       12)