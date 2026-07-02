# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 107, both pass: 97, speedup median 2.01x, geomean 2.06x
- timeout 60s, runs 3 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 166 | 76 | 2.19x | pass |
| atomops | 163 | 82 | 1.99x | pass |
| builin_types | 169 | 82 | 2.05x | pass |
| callquoteevalreduce2 | 168 | 82 | 2.04x | pass |
| case | 173 | 83 | 2.10x | pass |
| case2 | 164 | 82 | 1.99x | pass |
| caseempty | 165 | 82 | 2.02x | pass |
| chain | 165 | 82 | 2.02x | pass |
| collapse | 141 | 82 | 1.71x | pass |
| comments | 166 | 77 | 2.15x | pass |
| constanthead | 165 | 79 | 2.09x | pass |
| curry | 164 | 95 | 1.73x | pass |
| cut | 164 | 82 | 1.99x | pass |
| empty | 154 | 79 | 1.94x | pass |
| eval | 152 | 87 | 1.74x | pass |
| factorial | 166 | 76 | 2.20x | pass |
| fib | 456 | 79 | 5.76x | pass |
| fibadd | 459 | 84 | 5.46x | pass |
| fibsmart | 166 | 80 | 2.08x | pass |
| fibsmartimport | 167 | 87 | 1.92x | pass |
| foldall | 167 | 104 | 1.59x | pass |
| foldallmatch | 165 | 88 | 1.88x | pass |
| foldallspacecount | 167 | 83 | 2.03x | pass |
| forall | 189 | 115 | 1.64x | pass |
| functiontypes | 148 | 99 | 1.50x | pass |
| greedy_chess | 16024\* (timeout) | 1671\* (ran) | - | timeout/ran |
| he_assert | 173 | 86 | 2.00x | pass |
| he_atomspace | 181 | 79 | 2.28x | pass |
| he_equalreduct | 157 | 83 | 1.89x | pass |
| he_error | 172 | 82 | 2.09x | pass |
| he_evaluation | 153 | 91 | 1.67x | pass |
| he_math | 177 | 88 | 2.01x | pass |
| he_minimalmetta | 1807 | 484 | 3.74x | pass |
| he_quoting | 158 | 80 | 1.98x | pass |
| he_types | 168 | 83 | 2.02x | pass |
| holfunctions | 144 | 90 | 1.59x | pass |
| hyperpose_primes | 1100 | 1009 | 1.09x | pass |
| identity | 165 | 78 | 2.12x | pass |
| if | 168 | 79 | 2.12x | pass |
| if2 | 166 | 76 | 2.20x | pass |
| if3 | 164 | 76 | 2.17x | pass |
| if4 | 160 | 79 | 2.01x | pass |
| ifcasenondet | 173 | 85 | 2.04x | pass |
| is_alpha_member_test | 178 | 90 | 1.98x | pass |
| iter | 174 | 86 | 2.02x | pass |
| lambda | 166 | 95 | 1.75x | pass |
| let_superpose_if_case | 152 | 85 | 1.78x | pass |
| letext | 167 | 80 | 2.08x | pass |
| letlet | 166 | 82 | 2.02x | pass |
| letstar | 164 | 80 | 2.05x | pass |
| listhead | 166 | 77 | 2.14x | pass |
| matchnested | 165 | 85 | 1.93x | pass |
| matchnested2 | 147 | 84 | 1.75x | pass |
| matchsingle | 168 | 82 | 2.05x | pass |
| matchtypes | 164 | 82 | 2.01x | pass |
| matespace | 3947 | 60132\* (timeout) | - | pass/timeout |
| matespace2 | 5560 | 60209\* (timeout) | - | pass/timeout |
| matespacefast | 4258 | 1890 | 2.25x | pass |
| math | 159 | 85 | 1.86x | pass |
| meta_types | 165 | 77 | 2.13x | pass |
| metta4_prog | 167 | 105 | 1.59x | pass |
| multicall | 146 | 82 | 1.78x | pass |
| multiset_operations | 144 | 78 | 1.84x | pass |
| mutex_and_transaction | 173 | 85 | 2.03x | pass |
| myinterpreter | 168 | 84 | 2.01x | pass |
| nars_direct | 181 | 82\* (fail) | - | pass/fail |
| nars_tuffy | 252 | 245\* (fail) | - | pass/fail |
| nilbc | 713 | 399 | 1.79x | pass |
| once | 138 | 79 | 1.76x | pass |
| parametric_types | 140 | 77 | 1.83x | pass |
| parse | 142 | 77 | 1.83x | pass |
| patrick_iterate_fib | 166 | 80 | 2.07x | pass |
| patrick_iterate_quad | 306 | 149 | 2.05x | pass |
| peano | 1692 | 220 | 7.70x | pass |
| peanofast | 520 | 112 | 4.62x | pass |
| permutations | 889 | 451 | 1.97x | pass |
| pln_direct | 182 | 83\* (fail) | - | pass/fail |
| pln_roman | 215 | 123\* (fail) | - | pass/fail |
| pln_tuffy | 185 | 288\* (fail) | - | pass/fail |
| plntest | 167 | 86 | 1.94x | pass |
| plntestdirect | 154 | 277\* (ran) | - | pass/ran |
| recursive_types | 166 | 82 | 2.03x | pass |
| recursive_types2 | 166 | 80 | 2.08x | pass |
| repr | 146 | 80 | 1.83x | pass |
| selfprog | 155 | 79\* (fail) | - | pass/fail |
| smartdispatch | 165 | 84 | 1.97x | pass |
| spacefunction | 141 | 82 | 1.73x | pass |
| spaces | 164 | 84 | 1.96x | pass |
| spaces2 | 168 | 86 | 1.96x | pass |
| spaces3 | 165 | 84 | 1.96x | pass |
| specializecyclic | 167 | 82 | 2.04x | pass |
| state | 166 | 80 | 2.08x | pass |
| streamops | 167 | 81 | 2.06x | pass |
| string | 166 | 80 | 2.08x | pass |
| supercollapse | 169 | 89 | 1.90x | pass |
| superpose_nested | 166 | 86 | 1.93x | pass |
| superpose_primes | 171 | 87 | 1.96x | pass |
| tabling_fib | 167 | 81 | 2.06x | pass |
| test_alpha_unique_atom | 172 | 89 | 1.93x | pass |
| test_string_comments | 165 | 83 | 2.00x | pass |
| tests | 165 | 91 | 1.82x | pass |
| tilepuzzle | 1554 | 402 | 3.87x | pass |
| translatorrule_fib | 166 | 82 | 2.04x | pass |
| twostage | 165 | 79 | 2.10x | pass |
| types | 168 | 85 | 1.98x | pass |
| types_dependent | 165 | 82 | 2.00x | pass |
| xor | 153 | 80 | 1.91x | pass |
