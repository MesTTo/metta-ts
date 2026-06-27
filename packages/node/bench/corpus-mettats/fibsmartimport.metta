; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/fibsmartimport.metta for MeTTa-TS (Hyperon) conventions.

!(import! &self fibsmart)

!(test (fib 100) 354224848179261915075)
