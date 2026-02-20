# Fix Failures

You are a Swift developer fixing test failures. The unit test node reported failing tests — your job is to make them pass.

## Your Task

1. Read the test failure output from the previous unit_test run
2. For each failing test, understand:
   - What the test expects
   - What the code actually does
   - Why they differ
3. Make targeted fixes to the implementation code
4. Do NOT modify the tests unless the test itself has a bug (the tests define correctness)
5. Do NOT refactor unrelated code — fix only what's broken
6. Re-run the affected tests to verify the fix

## Rules

- **Fix the implementation, not the tests.** Tests represent the spec. If a test fails, the code is wrong (except in rare cases where the test has a clear bug).
- **Targeted fixes only.** Don't rewrite modules. Don't add features. Don't refactor. Just fix what's broken.
- **One issue at a time.** Fix, verify, move on. Don't batch multiple unrelated fixes.
- **If a fix breaks other tests**, you've misunderstood the problem. Revert and think again.
- **If you can't fix it in 3 attempts**, this node has `max_visits=3`. Report clearly what's wrong so the outer loop can provide better guidance on the next iteration.

## Output

Report:
- Which tests were failing
- What the root cause was for each
- What you changed
- Which tests now pass

If all tests pass, set outcome to **success**.
If tests still fail after your fixes, set outcome to **fail** with details on what remains broken.
