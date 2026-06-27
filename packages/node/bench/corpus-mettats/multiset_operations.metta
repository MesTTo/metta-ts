; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/multiset_operations.metta for MeTTa-TS (Hyperon) conventions.

!(test (unique-atom (a b c d d)) (a b c d))
!(test (union-atom (a b b c) (b c c d)) (a b b c b c c d))
!(test (intersection-atom (a b c c) (b c c c d)) (b c c))
!(test (subtraction-atom (a b b c) (b c c d)) (a b))
