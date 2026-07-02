; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/caseempty.metta for MeTTa-TS (Hyperon) conventions.

(= (wu) (case (empty)
              ((1 2)
               (Empty 42))))

(= (f) 42)

(= (wu2) (case (f)
               ((42 ok)
                (Empty nok))))

!(test (wu) 42)
!(test (wu2) ok)
