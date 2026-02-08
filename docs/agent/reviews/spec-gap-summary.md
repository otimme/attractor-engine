# Unified-LLM Spec Gap Analysis — Consolidated Summary

**Date**: 2026-02-08
**Spec**: `unified-llm-spec.md` (sections 2–7)
**Analyzed by**: 5-agent swarm (data-model, architecture, providers, generation/tools, errors/retry)

---

## Overview

| Severity | Count |
|----------|-------|
| High     | 4     |
| Medium   | 12    |
| Low      | 15    |
| **Total**| **31**|

The codebase is well-implemented overall. The high-severity gaps cluster around **error classification** (content filter, quota, gRPC codes) and **OpenAI tool_choice format**. Medium gaps are mostly missing validations and minor translation issues.

---

## High Severity Gaps

### 1. ContentFilterError / QuotaExceededError never instantiated (GAP-PROV-004)
- **Spec**: §6.1, §7.6 — error taxonomy requires 5 distinct error kinds
- **Code**: Classes exist in `errors.ts` but no adapter ever constructs them
- **Impact**: Callers cannot distinguish content blocks or quota exhaustion from generic errors

### 2. Gemini adapter missing gRPC status code mapping (GAP-ERR-002 / GAP-PROV-007)
- **Spec**: §6.4 — map gRPC codes (NOT_FOUND, UNAUTHENTICATED, RESOURCE_EXHAUSTED, etc.)
- **Code**: Gemini adapter only does HTTP status mapping; ignores `status` field in error body
- **Impact**: gRPC errors misclassified; non-retryable errors may be retried

### 3. Incomplete error message classification (GAP-ERR-003 / GAP-PROV-005)
- **Spec**: §6.5 — classify by keywords: "not found", "unauthorized", "content filter", "safety"
- **Code**: Only checks "context length"/"too many tokens" on 400s
- **Impact**: Content filter blocks not surfaced as ContentFilterError; auth errors not distinguished

### 4. OpenAI named tool_choice format wrong (GAP-GEN-001)
- **Spec**: §5.3 — `{ type: "function", function: { name: ... } }`
- **Code**: `request-translator.ts:190` sends `{ type: "function", name: ... }`
- **Impact**: Named tool_choice may not work correctly with OpenAI API
- **Note**: The openai-compatible adapter has it right; only the OpenAI (Responses API) adapter is wrong

---

## Medium Severity Gaps

### 5. HTTP 408 mapped to ServerError instead of RequestTimeoutError (GAP-ERR-001 / GAP-PROV-003)
All 4 adapters. Functional impact limited (both retryable) but `instanceof` checks fail.

### 6. Model catalog embedded in source, not separate JSON (GAP-ARCH-003)
Spec says catalog should be an independently updatable JSON data file.

### 7. ContentPart `kind` is a closed union (GAP-DM-002)
Spec requires accepting arbitrary strings for provider-specific extension.

### 8. Stream tool call events use flat fields instead of ToolCall object (GAP-DM-006)
Uses `toolCallId`/`toolName`/`argumentsDelta` instead of `toolCall: ToolCall`.

### 9. No tool name validation (GAP-GEN-002)
Spec requires `[a-zA-Z][a-zA-Z0-9_]*` max 64 chars at definition time.

### 10. No tool context injection in execute handlers (GAP-GEN-005)
Spec says inject `messages`, `abort_signal`, `tool_call_id` into execute handlers.

### 11. stream_object() missing object() accessor (GAP-GEN-006)
Spec says result should have `object()` for final validated object; currently just AsyncGenerator.

### 12. Gemini tool_choice "none" mode double-handling (GAP-GEN-008)
Omits tools AND sends NONE config. Spec says just send NONE (omitting tools is the Anthropic pattern).

### 13. Non-SDKError exceptions not retried (GAP-ERR-004)
Spec says unknown errors default to retryable; code throws immediately.

### 14. Gemini provider_options lacks explicit safety settings handling (GAP-ARCH-002)
Passthrough works generically but no validation for safety settings or cached content.

### 15. UnsupportedToolChoiceError not implemented (GAP-GEN-007)
Error class missing; adapters silently return undefined for unsupported modes.

### 16. OpenAI usage field names may need spec update (GAP-PROV-011)
Code reads `input_tokens`/`output_tokens` (correct for Responses API); spec table says `prompt_tokens`/`completion_tokens`.

---

## Low Severity Gaps

| # | ID | Description |
|---|-----|-------------|
| 17 | GAP-ARCH-001 | `fromEnvSync()` throws when no keys; spec implies zero-provider OK |
| 18 | GAP-DM-001 | No standalone ContentKind enum (values inlined) |
| 19 | GAP-DM-003 | `responseReasoning()` returns `""` not `undefined` |
| 20 | GAP-DM-004 | `ToolCallData.type` has no default of `"function"` |
| 21 | GAP-DM-005 | StreamEvent uses typed interfaces vs flat record |
| 22 | GAP-DM-007 | `ProviderEvent` uses `data` vs `raw`; others lack `raw` |
| 23 | GAP-DM-008 | `STEP_FINISH` in code but missing from spec §3.14 |
| 24 | GAP-GEN-003 | No tool call arg validation before execution |
| 25 | GAP-GEN-004 | No repair_tool_call support |
| 26 | GAP-ERR-005 | onRetry callback not wired through high-level API |
| 27 | GAP-PROV-001 | SSE parser ignores `retry:` lines |
| 28 | GAP-PROV-002 | OpenAI stream output_item.done type check fragility |
| 29 | GAP-PROV-006 | OpenAI finish reason mapping (correct for Responses API) |
| 30 | GAP-PROV-009 | Anthropic always sends is_error even when false |
| 31 | GAP-PROV-010 | Missing response.in_progress event handler |

---

## Detailed Reports

- [Data Model (§3)](spec-gap-data-model.md)
- [Architecture (§2)](spec-gap-architecture.md)
- [Provider Adapters (§7)](spec-gap-providers.md)
- [Generation, Streaming & Tools (§4-5)](spec-gap-generation-tools.md)
- [Error Handling & Retry (§6)](spec-gap-errors-retry.md)
