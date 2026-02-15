# Input Freshness Detection

## Overview

Long-running pipelines — especially those with `wait.human` gates that pause for hours or days — can resume execution with stale assumptions. Files referenced in prompts may have changed while the pipeline was paused, but the engine has no mechanism to detect this. Downstream nodes proceed with outdated context, producing work that conflicts with the current state of the codebase or docs.

This feature adds optional freshness checking so the engine can detect when a node's input files have changed since the pipeline started (or since the node was last executed), and route accordingly.

## Terminology

- **Source files** — Files or globs that a node's prompt depends on. If these change, the node's output may be stale.
- **Freshness baseline** — The file modification timestamps (or content hashes) captured when the pipeline starts or when a node first executes.
- **Stale input** — A source file whose current state differs from the freshness baseline.

## Motivation

The 8090.ai Planner monitors upstream blueprint changes and flags downstream work orders as outdated, proposing updates. Attractor has no equivalent. The `sync.dot` pipeline detects drift *between runs*, but nothing detects drift *within a run*. A `wait.human` gate can pause a pipeline for hours; when the human resumes, all downstream nodes trust that the context is still valid.

### Current state

- The engine captures no file state at pipeline start (spec Section 3.2)
- Checkpoints (spec Section 3.5) save `current_node`, `completed_nodes`, `context`, and retry counts — but not file checksums
- The `sync.dot` factory pipeline detects doc/code/architecture drift across runs, not within a run
- `wait.human` gates can pause execution indefinitely (spec Section 4.6)
- Variable expansion reads file contents at execution time but does not compare against a baseline

### References

- Spec Section 3.2: Execution loop (no file state tracking)
- Spec Section 3.5: Checkpoint model (no file checksums)
- Spec Section 4.6: Wait.human handler (indefinite pause)
- Spec Section 5.1: Context model and built-in keys
- `pipelines/factory/sync.dot`: cross-run drift detection
- 8090.ai Planner: background agents monitor blueprint changes, flag outdated work orders

## Requirements

### REQ-IF-001: Source files node attribute

**User Story:** As a pipeline author, I want to declare which files a node depends on, so that the engine can detect when those files change during a run.

**Acceptance Criteria:**

- AC-IF-001.1: When a node declares `source_files="src/models/*.ts,docs/spec.md"`, the engine records the attribute as a comma-separated list of file paths or globs.
- AC-IF-001.2: When `source_files` is not set, no freshness checking occurs for that node.
- AC-IF-001.3: When `source_files` contains glob patterns, they resolve against the working directory at baseline capture time.

### REQ-IF-002: Freshness baseline capture

**User Story:** As a pipeline operator, I want the engine to snapshot file state at pipeline start, so that changes during execution are detectable.

**Acceptance Criteria:**

- AC-IF-002.1: When a pipeline starts, the engine resolves all `source_files` across all nodes and records a content hash for each resolved file.
- AC-IF-002.2: When a pipeline resumes from checkpoint, the engine re-captures baselines for nodes not yet executed.
- AC-IF-002.3: When a `source_files` glob matches no files, the baseline records an empty set (not an error).

### REQ-IF-003: Freshness check before node execution

**User Story:** As a pipeline operator, I want the engine to check file freshness before executing a node, so that stale inputs are caught before the LLM processes them.

**Acceptance Criteria:**

- AC-IF-003.1: When a node with `source_files` is about to execute, the engine re-hashes the resolved files and compares against the baseline.
- AC-IF-003.2: When all files match, execution proceeds normally.
- AC-IF-003.3: When one or more files differ and `freshness="warn"`, the engine emits a `STALE_INPUT` event and proceeds.
- AC-IF-003.4: When one or more files differ and `freshness="block"`, the engine returns `Outcome(status=RETRY, failure_reason="stale input: <files>")` without executing the handler.
- AC-IF-003.5: When `freshness` is not set or is `"ignore"`, no check is performed regardless of `source_files`.

### REQ-IF-004: Stale input context reporting

**User Story:** As a downstream node or condition expression, I want to know which files were stale, so that I can branch or adjust behavior.

**Acceptance Criteria:**

- AC-IF-004.1: When stale files are detected, the engine sets `context.freshness.<node_id>.stale_files` to the list of changed file paths.
- AC-IF-004.2: When no stale files are detected, the context key is not set.
- AC-IF-004.3: When an edge condition references `context.freshness.<node_id>.stale_files`, it evaluates correctly (non-empty = truthy).

## Out of Scope

- Automatic re-execution of upstream nodes when staleness is detected. The engine reports staleness; the graph topology determines what happens next (via conditions or retry targets).
- File watching or daemon mode. Freshness is checked at node execution time, not continuously.
- Content-aware diffing (semantic comparison). Freshness uses content hashes only — any byte change counts as stale.
- Cross-run freshness. This feature operates within a single pipeline run. Cross-run drift detection is handled by the existing `sync.dot` pipeline.
- Freshness checking for context values. Only file-system inputs are tracked, not context keys set by other nodes.

## Feature Behavior & Rules

- The `freshness` attribute is a node-level attribute with values `"ignore"` (default), `"warn"`, or `"block"`.
- `source_files` and `freshness` are independent: `source_files` without `freshness` (or `freshness="ignore"`) records baselines but never checks them. This allows future tooling to use baselines for auditing without affecting execution.
- Content hashing uses a fast hash (e.g., xxHash). Cryptographic strength is not required.
- Freshness checks happen after retry delay but before handler execution, so a stale-input RETRY consumes a retry attempt.
- The `STALE_INPUT` event is a new pipeline event type, emitted alongside the existing event stream.
