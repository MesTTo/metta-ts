; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/state.metta for MeTTa-TS (Hyperon) conventions.

!(bind! state (new-state rest))
!(test (get-state state) rest)
!(change-state! state active)
!(test (get-state state) active)
