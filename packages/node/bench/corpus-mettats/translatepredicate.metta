; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/translatepredicate.metta for MeTTa-TS (Hyperon) conventions.

!(test (progn (translatePredicate (is $x 2))
              (translatePredicate (+ $x 40 $z)) $z)
       42)
