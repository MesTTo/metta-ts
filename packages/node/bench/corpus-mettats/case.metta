; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/case.metta for MeTTa-TS (Hyperon) conventions.

(= (casetest $x)
   (case $x ((4 42)
             ($otherpattern 44)
             ($otherother $45))))
   
!(test (casetest 5) 44)
