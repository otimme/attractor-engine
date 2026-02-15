# Provenance Tracking

## Overview

Attractor pipelines produce artifacts (prompts, responses, status files) that show *what* happened at each node, but there is no structured way to trace *why* — which upstream requirement, blueprint section, or earlier node output drove a particular prompt or decision. When a downstream implementation is wrong, debugging requires manually reading through the full artifact chain to find the root cause.

This feature adds a lightweight provenance chain so that each node's outcome records which upstream sources informed it, enabling bidirectional traceability from requirements through to implementation.

## Terminology

- **Provenance** — A record of the upstream sources (files, nodes, context keys) that informed a node's execution.
- **Reference** — A single provenance entry pointing to a source file, section, or upstream node.
- **Provenance chain** — The accumulated set of references across a pipeline run, linking each node's output back to its inputs.

## Motivation

The 8090.ai Planner maintains bidirectional links between requirements, blueprints, and work orders via a knowledge graph. Any work order can be traced back to the requirement that motivated it. Attractor's `status.json` artifacts and context store provide forward traceability (you can replay what happened), but when a downstream node produces incorrect output, there is no structured path back to the source.

The factory pipelines have an implicit traceability chain: `specify/require.md` produces requirements, `architect/blueprint.md` reads them and produces blueprints, `implement/plan.md` reads both. But this chain is encoded only in prompt text ("Read the feature blueprint matching $goal..."). Nothing in the pipeline output records which specific files or sections were actually consumed.

### Current state

- `status.json` records Outcome fields: status, notes, failure_reason, context_updates (spec Section 4.5, line 697)
- Context carries data forward but does not track where values originated (spec Section 5.1)
- The `last_stage` and `last_response` context keys (spec Section 5.1, lines 1087-1088) provide minimal forward linkage
- Prompt files are written to `{logs_root}/{node_id}/prompt.md` but don't record which source files were read to build them
- The factory prompts reference upstream docs by convention ("Read the feature blueprint matching $goal") but the pipeline output doesn't record which files were actually found and read

### References

- Spec Section 4.5: CodergenHandler writes prompt.md, response.md, status.json
- Spec Section 5.1: Context model, built-in keys, namespace conventions
- Spec Section 5.2: Outcome model (no provenance field)
- Spec Section 5.3: Checkpoint and artifacts directory structure
- 8090.ai Planner: bidirectional knowledge graph links between requirements, blueprints, and work orders
- Factory prompts: `implement/plan.md` reads requirements and blueprints by convention

## Requirements

### REQ-PT-001: Provenance field on Outcome

**User Story:** As a pipeline debugger, I want each node's outcome to record which sources informed it, so that I can trace incorrect output back to its root cause.

**Acceptance Criteria:**

- AC-PT-001.1: When a handler returns an Outcome, it may include a `provenance` field containing a list of References.
- AC-PT-001.2: When `provenance` is present, it is serialized into `status.json` alongside existing Outcome fields.
- AC-PT-001.3: When `provenance` is absent or empty, `status.json` is unchanged from current behavior.

### REQ-PT-002: Reference model

**User Story:** As a pipeline debugger, I want provenance references to identify the source type, location, and relevant section, so that I can navigate directly to the upstream source.

**Acceptance Criteria:**

- AC-PT-002.1: When a Reference has `kind="file"`, it includes `path` (file path) and optionally `section` (heading or line range).
- AC-PT-002.2: When a Reference has `kind="node"`, it includes `node_id` (upstream node that produced the input).
- AC-PT-002.3: When a Reference has `kind="context"`, it includes `key` (the context key that was read).

### REQ-PT-003: Provenance in CodergenBackend

**User Story:** As a backend implementor, I want the backend interface to support returning provenance, so that LLM-backed agents can report which files they read.

**Acceptance Criteria:**

- AC-PT-003.1: When `CodergenBackend.run()` returns an Outcome, the Outcome's `provenance` field is preserved by the CodergenHandler.
- AC-PT-003.2: When `CodergenBackend.run()` returns a plain String, the CodergenHandler sets provenance to an empty list.

### REQ-PT-004: Provenance summary in run output

**User Story:** As a pipeline operator, I want a summary of the full provenance chain after a run completes, so that I can audit the traceability of the pipeline's decisions.

**Acceptance Criteria:**

- AC-PT-004.1: When a pipeline run completes, the engine writes `{logs_root}/provenance.json` containing each node's provenance references.
- AC-PT-004.2: When a node has no provenance, it appears in `provenance.json` with an empty references list.
- AC-PT-004.3: When `provenance.json` is read, it is possible to reconstruct the full dependency graph from any node back to its sources.

### REQ-PT-005: Context provenance namespace

**User Story:** As a downstream node, I want to read upstream provenance from context, so that I can include it in my own output or decisions.

**Acceptance Criteria:**

- AC-PT-005.1: When a node completes with provenance, the engine sets `context.provenance.<node_id>` to the list of References.
- AC-PT-005.2: When a prompt references `$provenance.<node_id>`, it expands to a human-readable summary of that node's sources.

## Out of Scope

- Automatic provenance extraction from LLM responses. The backend must explicitly report which files it read; the engine does not parse LLM output to infer sources.
- Bidirectional linking in source files. Provenance is recorded in pipeline artifacts only, not written back into requirements or blueprint files.
- Provenance-based cache invalidation. Knowing that inputs changed is the domain of the Input Freshness feature, not provenance tracking.
- UI or visualization for provenance graphs. This feature defines the data model and file output; rendering is a separate tooling concern.
- Mandatory provenance. Handlers are not required to return provenance. It is opt-in and additive.

## Feature Behavior & Rules

- Provenance is append-only within a run. Once written, a node's provenance is not modified by later nodes.
- The `provenance.json` file is written after the final node completes (or on pipeline failure), not incrementally.
- Provenance references are informational. They do not affect edge selection, retry logic, or any execution behavior.
- The engine does not validate that provenance references point to real files or nodes. Backends are trusted to report accurate provenance.
- When a node is retried, each attempt's provenance is recorded separately. The final attempt's provenance is what appears in `provenance.json`.
