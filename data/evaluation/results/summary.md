# Evaluation summary (generated)

## Retrieval (k=5, min similarity 0.66)

| Slice | Cases | P@5 | P@5 ceiling | P@5 / ceiling | Evidence R@5 | Source R@5 | MRR | Success |
|---|---|---|---|---|---|---|---|---|
| all | 23 | 0.548 | 0.643 | 0.87 | 0.749 | 0.935 | 0.924 | 1.0 |
| en | 18 | 0.533 | 0.622 | 0.875 | 0.767 | 0.944 | 0.931 | 1.0 |
| hi | 5 | 0.6 | 0.72 | 0.85 | 0.686 | 0.9 | 0.9 | 1.0 |

Out-of-scope/abstain cases with chunks above threshold: abstain-passport-fee-en, abstain-aadhaar-time-hi

### Threshold sweep (k=5)

| Min similarity | P@5 | Evidence R@5 | MRR | Success | Abstain cases with results |
|---|---|---|---|---|---|
| 0.5 | 0.548 | 0.749 | 0.924 | 1.0 | 3 |
| 0.6 | 0.548 | 0.749 | 0.924 | 1.0 | 3 |
| 0.65 | 0.548 | 0.749 | 0.924 | 1.0 | 3 |
| 0.66 | 0.548 | 0.749 | 0.924 | 1.0 | 2 |
| 0.68 | 0.548 | 0.749 | 0.924 | 1.0 | 2 |
| 0.7 | 0.513 | 0.684 | 0.891 | 0.913 | 1 |
| 0.72 | 0.417 | 0.605 | 0.87 | 0.87 | 1 |

## Answers

| System | Cases | Behaviour acc. | Abstention acc. | Mention coverage | Cited answers | Citation precision | Unsupported specifics | Next-action acc. | Dependency exact | Invented deps | Median latency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GovPath (proposed) | 19 | 0.842 | 1.0 | 0.941 | 1.0 | 0.836 | 0 | None | 1.0 | 0 | 5423 ms |

| System | Schema errors | Names the next-action service | EN behaviour | HI behaviour | EN coverage | HI coverage |
|---|---|---|---|---|---|---|
| GovPath (proposed) | 0 | None | 0.8 | 1.0 | 0.962 | 0.875 |

## English/Hindi pairs

| System | Pairs | Same evidence status | Same first action | Cited-source Jaccard |
|---|---|---|---|---|
| GovPath (proposed) | 4 | 1.0 | 1.0 | 0.75 |
