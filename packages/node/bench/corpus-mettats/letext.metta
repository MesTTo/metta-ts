; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/letext.metta for MeTTa-TS (Hyperon) conventions.

!(test (let ($x (42 (if (== $x 2) 43 44))) (3 (42 $z)) (+ $x $z)) 47)
