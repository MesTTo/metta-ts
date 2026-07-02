; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/booleansolver.metta for MeTTa-TS (Hyperon) conventions.

!(test (if (and (or $x True) $y) ($x $y))
       ((True True) (False True)))
