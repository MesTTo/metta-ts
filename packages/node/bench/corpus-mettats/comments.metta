; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/comments.metta for MeTTa-TS (Hyperon) conventions.

;let's comment
(= (f) ;with a comment
   ;this is a line with just a comment
   42) ;overall we tested systematically several comments

!(test (f) 42);and added an evil comment for fun
;anything else to comment?
