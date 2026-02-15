# Decomposition Strategy Selection

## Overview

When a codergen node acts as a planner — decomposing a goal into sub-tasks for downstream nodes — the decomposition approach is currently hard-coded in the prompt text. Different projects and domains benefit from different strategies (feature-slice, layer-by-layer, embarrassingly parallel, sequential), but the human operator has no way to choose.

This feature adds a `wait.human` gate before the planning node in the implement pipeline, letting the human select a decomposition strategy. The selection flows through context (`$context.human.gate.label`) into the plan prompt, which adapts its approach accordingly.

## Terminology

- **Decomposition strategy** — The approach used to break a high-level goal into discrete implementation steps. Four options: layer-by-layer (horizontal: DB → API → UI), feature slice (vertical: one end-to-end capability per step), embarrassingly parallel (independent steps that can run concurrently), sequential/linear (strictly ordered one-at-a-time).

## Motivation

The `implement/plan.md` factory prompt hard-codes a layer-by-layer decomposition order (migrations, models, API, UI, tests). This works for CRUD features but is wrong for cross-cutting concerns, refactors, or infrastructure work. The 8090.ai Planner solves this with a configurable "extraction strategy" set at the project level. We can achieve the same using existing `wait.human` mechanics — no spec changes needed.

### Current state

- The factory `implement/plan.md` prompt hard-codes a 5-step layer-by-layer decomposition order
- The `wait.human` handler already stores the selected label in `context.human.gate.label` (spec Section 4.6)
- Context variable expansion (`$context.*`) is available in prompts (spec Section 4.5)
- No human decision point exists in the implement pipeline before planning begins

### References

- Spec Section 4.6: Wait.human handler, `context.human.gate.label`
- `pipelines/factory/implement.dot`: current pipeline (start → plan → implement → validate)
- `pipelines/factory/prompts/implement/plan.md`: hard-coded decomposition order
- 8090.ai Planner: configurable extraction strategy (feature-slice vs. specialist-oriented)

## Requirements

### REQ-DS-001: Strategy selection gate

**User Story:** As a pipeline operator, I want to choose a decomposition strategy before planning begins, so that the plan matches the nature of the work.

**Acceptance Criteria:**

- AC-DS-001.1: When the implement pipeline runs, a `wait.human` gate presents four strategy options before the plan node executes.
- AC-DS-001.2: When the operator selects a strategy, the selection is stored in `context.human.gate.label`.
- AC-DS-001.3: When the operator selects any of the four options, execution proceeds to the plan node.

### REQ-DS-002: Strategy-aware plan prompt

**User Story:** As an AI planner, I want to know which decomposition strategy the human chose, so that I structure the implementation steps accordingly.

**Acceptance Criteria:**

- AC-DS-002.1: When the plan prompt executes, it includes the selected strategy from `$context.human.gate.label`.
- AC-DS-002.2: When "Layer-by-layer" is selected, the plan groups steps by technical layer (database, models, API, UI, tests).
- AC-DS-002.3: When "Feature slice" is selected, the plan groups steps by user-facing capability, each delivering a vertical slice.
- AC-DS-002.4: When "Embarrassingly parallel" is selected, the plan identifies independent steps and marks dependency ordering explicitly.
- AC-DS-002.5: When "Sequential / linear" is selected, the plan produces one step per logical change, strictly ordered.

### REQ-DS-003: Strategy options

**User Story:** As a pipeline operator, I want clear, distinct strategy options with accelerator keys, so that I can quickly select the right approach.

**Acceptance Criteria:**

- AC-DS-003.1: The gate presents exactly four options: `[L] Layer-by-layer`, `[F] Feature slice`, `[P] Embarrassingly parallel`, `[S] Sequential / linear`.
- AC-DS-003.2: Each option has a unique single-character accelerator key.
- AC-DS-003.3: The gate label reads "Choose decomposition strategy:".

## Out of Scope

- New spec-level attributes or variable expansion. This uses existing `wait.human` and context mechanisms.
- Automatic strategy selection. The human always chooses; `AutoApproveInterviewer` picks the first option (Layer-by-layer) as default.
- Strategy affecting graph topology. The graph structure (linear vs. parallel fan-out) is fixed by the pipeline author. Strategy only changes how the *plan prompt* organizes steps.
- Adding strategy gates to other pipelines (expand, sync). Only the implement pipeline gets this gate. Other pipelines can add it later if needed.
- Custom or user-defined strategy options. The four options are fixed in the pipeline definition.

## Feature Behavior & Rules

- The strategy gate is a standard `wait.human` node (shape=hexagon). No new handler or spec change is needed.
- Under `AutoApproveInterviewer`, the first option (Layer-by-layer) is selected automatically, preserving backward compatibility with the previous hard-coded behavior.
- The plan prompt includes descriptions of all four strategies so the LLM understands the chosen approach even though only one label is passed via context.
- The strategy selection does not persist across pipeline runs. Each run gets a fresh choice.
