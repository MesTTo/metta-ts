# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 107, both pass: 95, speedup median 2.18x, geomean 2.03x
- timeout 15s, runs 2 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 176 | 76 | 2.31x | pass |
| atomops | 177 | 79 | 2.24x | pass |
| builin_types | 179 | 80 | 2.25x | pass |
| callquoteevalreduce2 | 178 | 78 | 2.29x | pass |
| case | 175 | 79 | 2.21x | pass |
| case2 | 177 | 79 | 2.24x | pass |
| caseempty | 176 | 75 | 2.36x | pass |
| chain | 177 | 77 | 2.29x | pass |
| collapse | 179 | 77 | 2.31x | pass |
| comments | 179 | 75 | 2.40x | pass |
| constanthead | 174 | 76 | 2.28x | pass |
| curry | 170 | 92 | 1.84x | pass |
| cut | 176 | 77 | 2.27x | pass |
| empty | 165 | 79 | 2.10x | pass |
| eval | 179 | 85 | 2.10x | pass |
| factorial | 175 | 77 | 2.27x | pass |
| fib | 471 | 76 | 6.17x | pass |
| fibadd | 467 | 80 | 5.86x | pass |
| fibsmart | 178 | 76 | 2.34x | pass |
| fibsmartimport | 173 | 92 | 1.89x | pass |
| foldall | 173 | 109 | 1.58x | pass |
| foldallmatch | 183 | 84 | 2.17x | pass |
| foldallspacecount | 184 | 84 | 2.19x | pass |
| forall | 173 | 108 | 1.61x | pass |
| functiontypes | 170 | 85 | 2.00x | pass |
| greedy_chess | 15139\* (timeout) | 4144\* (ran) | - | timeout/ran |
| he_assert | 180 | 81 | 2.21x | pass |
| he_atomspace | 179 | 80 | 2.25x | pass |
| he_equalreduct | 182 | 74 | 2.44x | pass |
| he_error | 178 | 77 | 2.32x | pass |
| he_evaluation | 168 | 84 | 2.00x | pass |
| he_math | 178 | 84 | 2.13x | pass |
| he_minimalmetta | 1789 | 495 | 3.61x | pass |
| he_quoting | 179 | 78 | 2.30x | pass |
| he_types | 181 | 80 | 2.27x | pass |
| holfunctions | 180 | 89 | 2.03x | pass |
| hyperpose_primes | 1101 | 1023 | 1.08x | pass |
| identity | 177 | 77 | 2.32x | pass |
| if | 174 | 79 | 2.21x | pass |
| if2 | 176 | 76 | 2.32x | pass |
| if3 | 175 | 76 | 2.30x | pass |
| if4 | 176 | 77 | 2.29x | pass |
| ifcasenondet | 176 | 81 | 2.17x | pass |
| is_alpha_member_test | 156 | 86 | 1.82x | pass |
| iter | 150 | 82 | 1.83x | pass |
| lambda | 176 | 94 | 1.86x | pass |
| let_superpose_if_case | 175 | 88 | 1.99x | pass |
| letext | 173 | 82 | 2.11x | pass |
| letlet | 176 | 80 | 2.22x | pass |
| letstar | 175 | 77 | 2.29x | pass |
| listhead | 177 | 77 | 2.28x | pass |
| matchnested | 173 | 82 | 2.12x | pass |
| matchnested2 | 179 | 82 | 2.18x | pass |
| matchsingle | 178 | 77 | 2.31x | pass |
| matchtypes | 179 | 78 | 2.28x | pass |
| matespace | 4109 | 15039\* (timeout) | - | pass/timeout |
| matespace2 | 5742 | 15035\* (timeout) | - | pass/timeout |
| matespacefast | 4212 | 15044\* (timeout) | - | pass/timeout |
| math | 184 | 85 | 2.16x | pass |
| meta_types | 159 | 76 | 2.09x | pass |
| metta4_prog | 148 | 79 | 1.86x | pass |
| multicall | 173 | 82 | 2.11x | pass |
| multiset_operations | 151 | 80 | 1.89x | pass |
| mutex_and_transaction | 177 | 86 | 2.05x | pass |
| myinterpreter | 170 | 83 | 2.04x | pass |
| nars_direct | 190 | 85\* (fail) | - | pass/fail |
| nars_tuffy | 245 | 93\* (fail) | - | pass/fail |
| nilbc | 740 | 3322 | 0.22x | pass |
| once | 151 | 80 | 1.89x | pass |
| parametric_types | 182 | 80 | 2.28x | pass |
| parse | 176 | 79 | 2.22x | pass |
| patrick_iterate_fib | 174 | 84 | 2.07x | pass |
| patrick_iterate_quad | 335 | 156 | 2.15x | pass |
| peano | 1641 | 3163 | 0.52x | pass |
| peanofast | 506 | 420 | 1.20x | pass |
| permutations | 830 | 3601 | 0.23x | pass |
| pln_direct | 177 | 82\* (fail) | - | pass/fail |
| pln_roman | 226 | 84\* (fail) | - | pass/fail |
| pln_tuffy | 206 | 119\* (fail) | - | pass/fail |
| plntest | 179 | 122 | 1.47x | pass |
| plntestdirect | 181 | 267\* (ran) | - | pass/ran |
| recursive_types | 171 | 79 | 2.18x | pass |
| recursive_types2 | 145 | 80 | 1.82x | pass |
| repr | 177 | 75 | 2.36x | pass |
| selfprog | 177 | 79\* (fail) | - | pass/fail |
| smartdispatch | 177 | 81 | 2.18x | pass |
| spacefunction | 179 | 82 | 2.18x | pass |
| spaces | 174 | 81 | 2.16x | pass |
| spaces2 | 178 | 81 | 2.20x | pass |
| spaces3 | 175 | 82 | 2.14x | pass |
| specializecyclic | 153 | 85 | 1.80x | pass |
| state | 144 | 77 | 1.88x | pass |
| streamops | 175 | 80 | 2.18x | pass |
| string | 175 | 77 | 2.26x | pass |
| supercollapse | 176 | 83 | 2.12x | pass |
| superpose_nested | 177 | 86 | 2.06x | pass |
| superpose_primes | 181 | 85 | 2.13x | pass |
| tabling_fib | 176 | 77 | 2.29x | pass |
| test_alpha_unique_atom | 181 | 96 | 1.89x | pass |
| test_string_comments | 176 | 82 | 2.14x | pass |
| tests | 146 | 89 | 1.64x | pass |
| tilepuzzle | 1564 | 15010\* (timeout) | - | pass/timeout |
| translatorrule_fib | 177 | 76 | 2.33x | pass |
| twostage | 177 | 77 | 2.30x | pass |
| types | 182 | 80 | 2.28x | pass |
| types_dependent | 180 | 79 | 2.28x | pass |
| xor | 176 | 77 | 2.27x | pass |
