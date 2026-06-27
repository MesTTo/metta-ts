; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/test_string_comments.metta for MeTTa-TS (Hyperon) conventions.

; Test that semicolons inside strings are NOT treated as comments
; This was broken before the string-aware comment stripper fix

; Test 0: comment separator and parentheses in strings:
!(test ")" ")")
!(test "(" "(")
!(test ";" ";")

; Test 1: Semicolon constant (from set.mm). `quote` holds its argument as data (NotReducible) in Hyperon,
; so (quote ";") stays (quote ";") — the point being the ";" string is parsed intact, not cut as a comment.
!(test (quote ";") (quote ";"))

; Test 2: String with semicolon in the middle
!(test "foo;bar" "foo;bar")

; Test 3: Multiple semicolons in string
!(test ";;;" ";;;")

; Test 4: Semicolon at start of string
!(test ";start" ";start")

; Test 5: Semicolon at end of string
!(test "end;" "end;")

; Test 6: Escaped characters still work
!(test "quote: \"" "quote: \"")

; Test 7: Backslash escape
!(test "path\\file" "path\\file")

; Test 8: Comments outside strings still work
(= (test-func) result) ; This comment should be stripped
!(test (test-func) result)
