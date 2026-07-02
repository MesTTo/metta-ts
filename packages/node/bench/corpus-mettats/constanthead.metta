; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/constanthead.metta for MeTTa-TS (Hyperon) conventions.

;h just expects a structure:
(= (h (justdata haha $B) $C)
   (+ $B $C))

;just structure matching (check out listhead.metta for list structure matching)
!(test (h (justdata haha 30) 40) 70)

;Please see listhead.metta next!
