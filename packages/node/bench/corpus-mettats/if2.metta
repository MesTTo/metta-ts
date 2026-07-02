; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/if2.metta for MeTTa-TS (Hyperon) conventions.

!(test (if (is-var a) (() (+ 1 1)) (+ 2 2)) 4)
