; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/metta4_prog.metta for MeTTa-TS (Hyperon) conventions.

!(test (progn (add-atom &self (friend sam tom))
              (remove-atom &self (friend sam tom))
              (add-atom &self (friend sam tim))
              (match &self (friend sam $1) $1))
       tim)

!(test (prog1 1 2 3) 1)
!(test (progn 1 2 3) 3)
