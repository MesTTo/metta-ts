; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/repr.metta for MeTTa-TS (Hyperon) conventions.

!(test (repr 42) "42")
!(test (repr "42") "\"42\"")
!(test (repr (A (B C))) "(A (B C))")
!(test (repr (A (, B , C ,))) "(A (, B , C ,))")
!(test (repr 2025_12_12) "2025_12_12")
!(test (repr ()) "()")
