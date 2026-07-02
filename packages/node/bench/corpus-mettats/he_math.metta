; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/he_math.metta for MeTTa-TS (Hyperon) conventions.

!(test (pow-math 2 3) 8.0)
!(test (sqrt-math 9) 3.0)
!(test (abs-math -5) 5)
!(test (log-math 10 100) 2.0)
!(test (trunc-math 5.6) 5.0)
!(test (ceil-math 5.2) 6.0)
!(test (floor-math 5.8) 5.0)
!(test (round-math 5.4) 5.0)
!(test (round-math 5.6) 6.0)
!(test (sin-math 0) 0.0)
!(test (asin-math 0) 0.0)
!(test (cos-math 0) 1.0)
!(test (acos-math 1) 0.0)
!(test (tan-math 0) 0.0)
!(test (atan-math 0) 0.0)
!(test (isnan-math 0.0) False)
!(test (isinf-math 0.0) False)
!(test (min-atom (2 6 7 4 9 3)) 2.0)
!(test (max-atom (2 6 7 4 9 3)) 9.0)
