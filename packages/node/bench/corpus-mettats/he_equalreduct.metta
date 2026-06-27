; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_equalreduct.metta for MeTTa-TS (Hyperon) conventions.


(= (add 1 2) 3)

!(test (id 5) 5)

!(test (=alpha (Father $X) (Father $Y)) True)

!(test (=alpha (Father $X) (Son $X)) False)

!(test (if-equal 1 1 "Equal" "Not Equal") "Equal")
