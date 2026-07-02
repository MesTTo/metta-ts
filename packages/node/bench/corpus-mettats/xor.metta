; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/xor.metta for MeTTa-TS (Hyperon) conventions.

(= (check_xor $source $destination)
   (if (xor (== $source $destination)
            (> $source $destination))
            42
            0))

!(test (check_xor 2 2) 42)
!(test (check_xor 4 2) 42)
