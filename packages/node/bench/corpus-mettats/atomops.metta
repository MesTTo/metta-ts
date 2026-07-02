; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/atomops.metta for MeTTa-TS (Hyperon) conventions.

!(test (cons-atom 0 (1 2 3))
       (0 1 2 3))

!(test (car-atom (1 2 3))
       1)

!(test (cdr-atom (1 2 3))
       (2 3))

!(test (index-atom (1 2 3) 1)
       2)

!(test (id 5) 5)

!(test (=alpha (Father $X) (Father $Y)) True)

!(test (=alpha (Father $X) (Son $X)) False)

!(test (first-from-pair (A B)) A)

!(test (second-from-pair (A B)) B)
