; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/library.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self (library lib_roman))

!(test (map-flat (+ 1) (1 2 3)) (2 3 4))
