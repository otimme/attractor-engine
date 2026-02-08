# Unified LLM Spec Gap Analysis

**Date:** 2026-02-07 (revised)
**Spec:** `unified-llm-spec.md`
**Code:** `unified-llm/src/`

---

## Overview

The initial automated gap analysis identified 8 HIGH, 10 MEDIUM, and 10 LOW severity gaps. Upon deep manual review comparing actual spec text against actual source code, **all 8 HIGH severity findings were false positives** -- the features were implemented but the analysis agents didn't read the code thoroughly enough.

After correction, 2 real MEDIUM gaps were found and fixed. The remaining MEDIUM/LOW findings from the original report are listed below with corrected assessments.

---

## False Positives (originally rated HIGH)

| # | Claimed Gap | Reality |
|---|---|---|
| 1 | `stream_object()` missing partial parsing | `streamObject()` in `api/stream-object.ts` implements `partialJsonParse()` for both tool + json_schema strategies |
| 2 | No auto tool execution loop | `generate()` has `maxToolRounds` (default 1) with concurrent `Promise.all` execution. `stream()` has identical loop |
| 3 | `Client.from_env()` is a no-op | `Client.fromEnvSync()` reads ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENAI_COMPATIBLE_BASE_URL |
| 4 | Missing middleware `onError` hook | Middleware uses `(request, next) => Promise<Response>` pattern -- error handling is try/catch around `next()`, matching the spec's functional middleware design |
| 5 | No `providerOptions` escape hatch | `Request.providerOptions` exists as `Record<string, Record<string, unknown>>`. All 4 providers extract and pass through their options |
| 6 | Gemini `toolChoice` "required" not mapped | `translateToolChoice` maps `"required"` -> `{ mode: "ANY" }` |
| 7 | Missing `file`, `refusal`, `thinking` content types | `DocumentPart`, `AudioPart`, `ThinkingPart`, `RedactedThinkingPart` all exist. `refusal` is not in spec |
| 8 | Missing `thinking` content part | `ThinkingPart` + `RedactedThinkingPart` with full round-trip in Anthropic + Gemini |

---

## Fixed Gaps

### OpenAI stream translator missing `content_filter` finish reason
- **Severity:** MEDIUM
- **File:** `providers/openai/stream-translator.ts`
- Non-streaming `mapFinishReason` (response-translator.ts) handled `content_filter` but the streaming version mapped it to `other`
- **Fix:** Added `case "content_filter": return { reason: "content_filter", raw: status };`

### OpenAI request translator drops thinking blocks silently
- **Severity:** MEDIUM
- **File:** `providers/openai/request-translator.ts`
- `translateAssistantContentPart` only handled `text` kind. Thinking/redacted_thinking parts from cross-provider conversations (e.g., Anthropic -> OpenAI) were silently dropped with no explicit handling
- **Fix:** Added explicit skip for `thinking`/`redacted_thinking` parts per spec 3.5 (strip signatures, optionally convert)

---

## Remaining MEDIUM Findings (from original report, reassessed)

Most original MEDIUM findings were also overstated or partially wrong. Corrected assessments:

| # | Original Claim | Reassessment |
|---|---|---|
| 9 | Incomplete error hierarchy | **False positive.** 13 error classes exist matching spec: `AuthenticationError`, `RateLimitError`, `InvalidRequestError`, `NotFoundError`, `ContentFilterError`, `PermissionError`, `ServerError`, `ConnectionError`, `TimeoutError`, etc. |
| 10 | Retry missing `Retry-After` | **False positive.** `retry.ts` reads `Retry-After` header and uses it as minimum delay. Exponential backoff with jitter implemented correctly. |
| 11 | Response type missing fields | **Partially false.** `reasoningTokens` exists on `Usage`. `raw` field on Response serves as `providerMetadata`. |
| 12 | Missing `system` parameter | **Needs review.** System messages are handled via `Role.SYSTEM` in the messages array. |
| 13 | SSE parser edge cases | **Low priority.** Works correctly for all 4 provider SSE formats in practice. |
| 14 | Anthropic cache control | **False positive.** Automatic caching with opt-out via `providerOptions.anthropic.cacheControl` exists. |
| 15 | Model catalog incomplete | **Partially true.** Catalog has 7 models with costs, aliases, and lookup. Some newer models may be missing. |
| 16 | Anthropic tool result images | **Low priority.** Image-in-tool-result is an edge case. |
| 17 | OpenAI `response_format` incomplete | **False positive.** `strict: true` is passed through. Uses Responses API `text.format` shape. |
| 18 | Missing `AbortSignal` propagation | **Needs review.** Signal exists on Request type; propagation depth needs verification. |

---

## Remaining LOW Findings

These are minor naming/parameter differences that don't affect functionality:

- Stream event naming uses `StreamEventType` enum with 14 types (all spec events covered)
- `seed`, `topK`, `frequencyPenalty`, `presencePenalty` can be passed via `providerOptions`
- `stopSequences` field correctly named in `Request` type
- Gemini streaming works correctly despite not using `?alt=sse` query param

---

## Summary

| Category | Count |
|----------|-------|
| False positive HIGHs | 8 |
| Real gaps fixed | 2 |
| Needs review | 2 |
| Low priority | ~5 |
| Non-issues | ~11 |
