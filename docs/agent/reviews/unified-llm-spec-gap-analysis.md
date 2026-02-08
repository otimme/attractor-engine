# Unified LLM Spec Gap Analysis

**Date:** 2026-02-07 (updated)
**Spec:** `unified-llm-spec.md`
**Code:** `unified-llm/src/`

---

## 1. Types & Data Model (Spec 3.1-3.14)

### Conformant
- Message (3.1): role, content, name, toolCallId, convenience constructors, text accessor
- Role (3.2): all 5 roles present
- ImageData, AudioData, DocumentData, ThinkingData (3.5): all present with correct fields
- Request (3.6): all fields including reasoningEffort, metadata, providerOptions, timeout, abortSignal
- Response (3.7): all fields including warnings, rateLimit, raw, convenience accessors
- FinishReason (3.8): dual representation with reason + raw
- Usage (3.9): all fields including reasoningTokens, cache tokens, raw, addUsage() for aggregation
- ResponseFormat (3.10), Warning (3.11), RateLimitInfo (3.12): all present
- StreamEventType (3.14): all 13 event types present including STREAM_START, REASONING_*, PROVIDER_EVENT

### Gaps

1. **No explicit ContentKind enum** (spec 3.4). Kind values exist only as string literals in discriminated union interfaces. Adding a `ContentKind` constant object (like `Role`) would improve discoverability.

2. **ContentPart not extensible to arbitrary strings** (spec 3.3). Spec says `kind: ContentKind | String` for provider-specific extension. Code uses a closed discriminated union that rejects unknown kinds at the type level. Minor — a TypeScript design choice.

3. **ToolCallData missing default for `type` field** (spec 3.5). Field is `type?: string` but spec says default to `"function"`. No default is set.

4. **StreamStartEvent missing `warnings` field** (spec 3.13). Spec says STREAM_START may include warnings.

5. **ProviderEvent uses `data` instead of `raw`** (spec 3.13). Naming divergence from spec's `raw: Dict | None`.

6. **Missing test files** for stream-event, request, role, tool, response-format, model-info, timeout types.

---

## 2. Provider Adapters (Spec 2.7-2.8, 2.10, 7.1-7.10)

### Anthropic — Mostly Conformant

Correctly implements: native Messages API, authentication, system message extraction, strict alternation, max_tokens default 4096, thinking/redacted_thinking with signatures, tool choice "none" omits tools, beta headers via providerOptions, auto cache_control injection, cache usage mapping, response format fallback via prompt, finish reasons, error translation, Retry-After parsing, file path images, streaming start/delta/end lifecycle.

**Gaps:**
1. **No `reasoningTokens` populated in Usage**. Spec says "populate reasoning_tokens by summing token lengths of thinking blocks." Neither response nor stream translator sets this.
2. **`cache_control` not auto-injected on conversation prefix messages**. Only injected on system prompt, tool defs, and second-to-last message's last content block. Spec says also "conversation prefix."
3. **`errorCode` not stored on ProviderError**. Error type (e.g., `invalid_request_error`) is detected for classification but not stored.

### OpenAI — Mostly Conformant

Correctly implements: Responses API `/v1/responses`, Bearer auth, system/developer -> `instructions`, input_text/output_text distinction, function_call/function_call_output items, reasoning.effort mapping, native json_schema response format, finish reason mapping, reasoning tokens from output_tokens_details, cache_read_tokens from input_tokens_details.cached_tokens, rate limit info, image URL and base64, streaming Responses API format, error translation with ContextLengthError heuristic, Retry-After parsing.

**Gaps:**
1. **No `content_filter` finish reason mapping**. Spec maps OpenAI `content_filter` -> `content_filter`. The `mapFinishReason` only handles `completed`, `incomplete`, `failed`.
2. **`response.in_progress` streaming event not handled**. Spec lists it; stream translator ignores it (benign but not mapped).
3. **No REASONING_START/DELTA/END streaming events**. OpenAI doesn't expose reasoning text, but the spec implies these events should be emitted if available.
4. **`errorCode` not stored on ProviderError**.

### Gemini — Mostly Conformant

Correctly implements: native Gemini API with `?alt=sse`, key query param auth, systemInstruction extraction, model role mapping, synthetic tool call IDs, function name mapping for responses, string results wrapped in `{result: "..."}`, tool choice mapping, native responseSchema, finish reason mapping with tool call inference, thoughtsTokenCount -> reasoningTokens, cachedContentTokenCount -> cacheReadTokens, thinking blocks handling, streaming with REASONING events.

**Gaps:**
1. **`toolChoice: none` omits tools instead of sending `"NONE"` mode**. Spec table says Gemini none = `"NONE"`. Code omits tools entirely (like Anthropic).
2. **No ContextLengthError detection for 400 responses**. Other adapters check for "context"/"token" in message; Gemini maps all 400s to InvalidRequestError.
3. **No gRPC status code mapping**. Spec 6.4 has a dedicated table for Gemini gRPC codes (NOT_FOUND, UNAUTHENTICATED, RESOURCE_EXHAUSTED, etc.).
4. **Tool result images not supported**. Gemini request translator's tool_result translation doesn't handle imageData.
5. **`errorCode` not stored on ProviderError**.
6. **No adapter-level test file** (only translator tests exist).

### OpenAI-Compatible — Mostly Conformant

Correctly implements: Chat Completions `/v1/chat/completions`, distinct from primary OpenAI adapter, standard message format, tool choice/definition translation, finish reason mapping, usage with reasoning tokens, response format, streaming with [DONE], error translation with ContextLengthError heuristic.

**Gaps:**
1. **No file path image support**. Does NOT call `resolveFileImages()`. All three native adapters do.
2. **`request.timeout` ignored**. Uses `this.timeout` but doesn't check `request.timeout`.
3. **`errorCode` not stored on ProviderError**.

### Cross-Provider Gaps
1. **`errorCode` not stored on ProviderError** by any adapter (spec 6.2).
2. **No `PROVIDER_EVENT` stream events emitted** by any provider for unrecognized events.
3. **No `raw` field populated on stream events** (spec 3.13 defines `raw: Dict | None`).
4. **No `response` field on FINISH stream events** (spec says FINISH carries full accumulated response).

---

## 3. Client & API Layer (Spec 2.1-2.6, 4.1-4.7, 5.6-5.7)

### Conformant
- Client.fromEnv() / fromEnvSync() with all env vars including GOOGLE_API_KEY fallback
- Programmatic setup with explicit adapters
- Provider routing by provider field with defaultProvider fallback
- ConfigurationError on missing provider
- Middleware chain in correct order (request: registration, response: reverse)
- Streaming middleware via separate streamMiddleware array
- Module-level default client: getDefaultClient() (lazy) and setDefaultClient()
- Client.complete() and Client.stream() with no auto-retry
- generate() with all params: prompt, messages, system, tools, toolChoice, maxToolRounds, stopWhen, responseFormat, temperature, topP, maxTokens, stopSequences, reasoningEffort, providerOptions, maxRetries, timeout, abortSignal, client
- GenerateResult with text, reasoning, toolCalls, toolResults, finishReason, usage, totalUsage, steps, response, output
- StepResult with text, reasoning, toolCalls, toolResults, finishReason, usage, response, warnings
- stream() high-level with StreamResult: asyncIterator, response(), partialResponse(), textStream()
- generate_object() with schema validation via tool and json_schema strategies
- stream_object() with partial object updates via incremental JSON parsing
- Tool loop with maxToolRounds, parallel execution via Promise.all, ordering preserved, partial failure handled
- AbortSignal support, TimeoutConfig with total/perStep, AdapterTimeout with connect/request/streamRead

### Gaps

1. **No schema validation of parsed output in generateObject()**. Implementation parses JSON and extracts tool call arguments but never validates against the provided JSON schema. If model returns `{"name": 123}` when schema expects string, no error is thrown.

2. **streamObject() missing `object()` accessor**. Spec mentions `result.object()` for complete validated result. Implementation is bare AsyncGenerator yielding partials.

3. **No tests for stream_object()**. No `tests/api/stream-object.test.ts` file exists.

4. **Separate middleware types for complete vs stream**. Spec describes a single middleware handling both modes. Implementation requires two separate registrations (`middleware` and `streamMiddleware`).

5. **AdapterTimeout defaults not per-spec**. Spec says connect=10s, request=120s, streamRead=30s. Implementation sets all three to the same value from timeout/perStep.

6. **fromEnvSync() throws eagerly when no providers configured**. Spec implies error at request time, not client construction time.

7. **textStream() and partialResponse() are methods, not properties**. Minor API shape difference from spec.

8. **No tests for abort signal, fromEnv, or default client**.

---

## 4. Error Handling & Retry (Spec 6.1-6.7)

### Conformant
- Full error hierarchy: all 16 error classes match spec with correct inheritance
- ProviderError fields: provider, statusCode, errorCode, retryable, retryAfter, raw, cause
- Retryability classification matches spec for all error types
- RetryPolicy with maxRetries=2, baseDelay=1.0, maxDelay=60.0, backoffMultiplier=2.0, jitter=true
- Exponential backoff formula correct with +/-50% jitter
- Retry-After handling: uses provider delay when <= maxDelay, doesn't retry when > maxDelay
- onRetry callback invoked with (error, attempt, delay)
- Unknown errors default to retryable
- Rate limit info extracted from response headers

### Gaps

1. **No HTTP 408 -> RequestTimeoutError mapping** in any adapter. Falls through to generic ProviderError.
2. **No HTTP 413 -> ContextLengthError mapping** in any adapter. Falls through to generic retryable ProviderError (should be non-retryable).
3. **No HTTP 422 -> InvalidRequestError mapping** in any adapter.
4. **Gemini missing ContextLengthError detection** for 400 responses (other adapters check message body).
5. **Gemini missing gRPC status code mapping** (spec 6.4 table).
6. **No "not found"/"does not exist" message classification** in any adapter (spec 6.5).
7. **No "unauthorized"/"invalid key" message classification** in any adapter (spec 6.5).
8. **No "content filter"/"safety" message classification** in any adapter (spec 6.5).
9. **SSE parser does not handle `retry:` lines** (very low priority — no provider uses it).

---

## 5. Model Catalog (Spec 2.9)

### Conformant
- ModelInfo with all spec fields: id, provider, displayName, contextWindow, maxOutput, supportsTools, supportsVision, supportsReasoning, inputCostPerMillion, outputCostPerMillion, aliases
- Lookup functions: getModelInfo(), listModels(), getLatestModel()
- All spec models present: Claude Opus 4.6, Sonnet 4.5, GPT-5.2 series, Gemini 3 series

### Gaps

1. **Display names slightly differ**. Spec: "Gemini 3 Pro (Preview)". Code: "Gemini 3 Pro Preview" (no parentheses).
2. **Catalog not shipped as separate data file**. Spec recommends JSON file updatable independently of code.

---

## Summary by Severity

### High (significant gaps affecting correctness or completeness)
1. No `reasoningTokens` in Anthropic Usage (can't track reasoning costs)
2. No schema validation in generateObject() (invalid output silently accepted)
3. Missing HTTP status code mappings: 408, 413, 422 across all adapters
4. Gemini toolChoice "none" omits tools instead of sending NONE mode
5. OpenAI missing content_filter finish reason mapping
6. No errorCode stored on ProviderError by any adapter
7. No FINISH event carries accumulated response in any stream translator
8. OpenAI-Compatible adapter missing file path image support and request.timeout

### Medium (functional but incomplete)
9. Separate middleware types for complete vs stream (spec wants unified)
10. AdapterTimeout defaults not differentiated (connect/request/streamRead all same)
11. Gemini missing ContextLengthError and gRPC error mapping
12. No error message classification for ambiguous cases (spec 6.5)
13. streamObject() missing object() accessor
14. No PROVIDER_EVENT or raw field on stream events
15. Anthropic cache_control not on conversation prefix messages

### Low (minor naming/design differences)
16. No ContentKind enum constant
17. ContentPart not extensible to arbitrary kind strings
18. StreamStartEvent missing warnings field
19. ProviderEvent uses data vs raw naming
20. Gemini display names missing parentheses
21. Catalog hardcoded vs separate JSON file
22. textStream()/partialResponse() are methods not properties
23. Missing test coverage for stream-object, abort signal, fromEnv
