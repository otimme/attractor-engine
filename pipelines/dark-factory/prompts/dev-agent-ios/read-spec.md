# Read Spec

You are the first node in the iOS Development Agent pipeline. Your job is to read and internalize the product specification.

## Your Task

Read Doc A (the product specification) from the project output directory. This is the ONLY source of truth for what to build.

## Information Barrier

You have access ONLY to Doc A. Do NOT look for or reference any scenario tests, holdout tests, or test agent output. The existence of separate testing processes is intentional — you must build from the spec alone, not from test expectations.

## What to Extract

As you read, identify and summarize:
1. **Core purpose** — What problem does this solve? For whom?
2. **Key features** — Every action a user can take
3. **Data model** — Core entities, relationships, storage requirements
4. **Tech stack** — Languages, frameworks, platform targets
5. **Acceptance criteria** — Every measurable "done" condition
6. **Boundaries** — Always/Ask First/Never rules
7. **Non-goals** — What we are explicitly NOT building
8. **Non-functional requirements** — Performance thresholds, accessibility, security

## Output

Produce a structured summary of the spec that subsequent pipeline nodes can reference. Flag any ambiguities, contradictions, or gaps you notice — these should be noted but should not block progress.
