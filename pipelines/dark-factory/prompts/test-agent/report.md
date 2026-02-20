# Report Results

You are the Testing Agent. Compile your scenario test results into a structured report for the Judge.

## Report Format

Write to: `output/{project}/test/scenario-results/iteration-{n}.md`

```markdown
# Scenario Test Results — Iteration {n}

## Summary
- Total scenarios: X
- Passed: X
- Failed: X
- Overall satisfaction: X.XX (0.0-1.0)

## Results by Category

### Happy Path Scenarios
| Scenario | Pass/Fail | Satisfaction | Notes |
|----------|-----------|-------------|-------|
| ... | ... | ... | ... |

### Edge Case Scenarios
| ... |

### Failure Recovery Scenarios
| ... |

### Stress Scenarios
| ... |

### Security Scenarios
| ... |

### State Transition Scenarios
| ... |

### Data Boundary Scenarios
| ... |

### Concurrent Use Scenarios
| ... |

## Failed Scenarios (Detail)
For each failed scenario:
- What was expected
- What actually happened
- Steps to reproduce
- Severity (blocks usage / degrades experience / cosmetic)

## Satisfaction Assessment
"Of all observed trajectories through all scenarios, what fraction likely satisfies the user?"

Overall satisfaction score: X.XX

Justification: [explain how you arrived at this score]

## Issues Discovered
Any problems found during testing that weren't covered by specific scenarios.
```

## Calculating Overall Satisfaction

Weight scenarios by category importance:
- Happy path: weight 3 (most important — core functionality must work)
- Security: weight 3 (security failures are critical)
- Edge cases: weight 2
- Failure recovery: weight 2
- State transitions: weight 2
- Stress: weight 1
- Data boundaries: weight 1
- Concurrent use: weight 1

Overall = weighted average of per-scenario satisfaction scores (Fully=1.0, Mostly=0.75, Partially=0.5, Unsatisfied=0.0).

## Output

The report file written to the output directory. The Judge will read this to determine if the dev/test loop has converged.
