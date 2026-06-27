; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/if4.metta for MeTTa-TS (Hyperon) conventions.

!(test (if (if (== 42 42) True False)
           (if True 42 lol) 
           (+ 2 2)) 42)
