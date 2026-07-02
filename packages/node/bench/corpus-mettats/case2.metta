; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/case2.metta for MeTTa-TS (Hyperon) conventions.

(= (compile $stmt)
   (case $stmt
         (($stmt (superpose (what what2))))))

!(test (collapse (compile wat))
       (what what2))
