; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/parse.metta for MeTTa-TS (Hyperon) conventions.

!(test (parse "A") A)
!(test (parse "(R A B)") (R A B))
!(test (parse "(R A (S B C))") (R A (S B C)))
; @metta-ts's parse returns the parsed atom as plain data, so a parsed call evaluates in the test's
; actual position: (parse "(* 2 21)") gives (* 2 21), which reduces to 42. (PeTTa auto-quotes parse
; output to hold it as data.) The expected side reduces the same way, so the test stays meaningful.
!(test (parse "(* 2 21)") (* 2 21))
!(test (parse "\"42\"") "42")
