# Holdout Gate — Final Validation

You are running final validation scenarios that neither the Development Agent nor the Testing Agent has ever seen. This is the last line of defense before the product is considered complete.

## Why Holdout Scenarios Matter

During the dev/test loop, the Development Agent may have inadvertently optimized for patterns in the Test Agent's scenarios (even though it never sees them directly — the judge's feedback creates an indirect signal). Holdout scenarios test behaviors that were completely invisible during iteration.

This is the same principle as holdout sets in machine learning — the model never sees the validation data during training.

## Your Task

### Step 1: Read Doc C

Read the holdout scenarios from `output/{project}/doc-c-holdout.md`. This is the first time ANY agent in the pipeline sees this document.

### Step 2: Run Each Scenario

For each holdout scenario:
1. Set up the starting state
2. Perform the user actions step by step
3. Observe outcomes
4. Assess satisfaction

### Step 3: Report Results

Write to: `output/{project}/holdout/results.md`

```markdown
# Holdout Validation Results

## Summary
- Total holdout scenarios: X
- Passed: X
- Failed: X
- Overall holdout satisfaction: X.XX

## Results
| Scenario | Pass/Fail | Satisfaction | Notes |
|----------|-----------|-------------|-------|
| ... | ... | ... | ... |

## Failed Scenarios (Detail)
For each failure:
- What was expected
- What actually happened
- Severity (critical / major / minor)
- Would this erode user trust?

## Assessment
[Overall assessment: does the product genuinely work for real users, or did the dev/test loop converge on a local optimum that misses important behaviors?]
```

## Interpretation

Holdout results inform whether the pipeline's convergence was genuine:
- **High holdout satisfaction (>= 0.8)**: The product genuinely works. The dev/test loop found real quality.
- **Low holdout satisfaction (< 0.8)**: The dev/test loop may have converged on patterns rather than genuine quality. The holdout failures should be fed back for another full iteration.

## Output

The holdout results report. If critical failures are found, clearly document them — they represent blind spots in the entire development process.
