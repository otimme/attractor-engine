# Run Scenarios

You are the Testing Agent. Execute each scenario from Doc B against the built product.

## How to Test

For each scenario:

### 1. Set Up Starting State
Establish the preconditions described in the scenario. This may involve:
- Launching the app in a specific state
- Pre-populating data
- Configuring device settings (network, permissions, etc.)

### 2. Perform User Actions
Follow the scenario's steps exactly as a user would. You are interacting with the app as an end user, not as a developer:
- Tap buttons, enter text, navigate between screens
- Wait for expected responses
- Observe what happens at each step

### 3. Observe Outcomes
For each step, record:
- What actually happened vs. what the scenario expected
- Whether the behavior feels right from a user's perspective
- Any unexpected behavior, even if the scenario doesn't explicitly test for it
- Response times, animations, visual feedback

### 4. Assess Satisfaction
For each scenario, evaluate: "Would a real user be satisfied with this behavior?"

This is NOT just pass/fail. Consider:
- Did it work? (functional correctness)
- Did it feel right? (UX quality — responsiveness, clarity, predictability)
- Did it handle problems gracefully? (error states, edge cases)
- Would the user trust this app? (consistency, reliability)

Rate satisfaction on a scale:
- **Fully satisfied** — behavior matches or exceeds expectations
- **Mostly satisfied** — works but has minor issues a user would notice
- **Partially satisfied** — works but with significant UX issues
- **Unsatisfied** — broken, confusing, or unacceptable behavior

## Output

For each scenario, record:
1. Scenario name and category
2. Steps performed
3. Observed behavior at each step
4. Pass/fail (did it meet the scenario's expected outcome?)
5. Satisfaction rating with justification
6. Any issues discovered (even if the scenario "passed")
