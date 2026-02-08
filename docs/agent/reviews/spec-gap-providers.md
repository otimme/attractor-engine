# Spec Gap Analysis: Provider Adapters (section 7)

## Summary

Analyzed all four provider adapters (OpenAI, Anthropic, Gemini, OpenAI-Compatible) and utility modules (SSE parser, HTTP helpers) against spec sections 7.1-7.10. The implementation is broadly solid -- all four adapters implement the ProviderAdapter interface, translate requests/responses/streams correctly for the primary cases, and handle errors. Found 11 gaps total: 2 high severity, 5 medium, 4 low.

## Gaps Found

### [GAP-PROV-001] SSE parser does not handle `retry:` lines
- **Spec reference**: section 7.7 (SSE Parsing) -- "A proper SSE parser must handle: ... `retry:` lines (reconnection interval)"
- **What spec requires**: SSE parser handles `retry:` lines (reconnection interval)
- **What code has**: `unified-llm/src/utils/sse.ts:53-68` only handles `event:` and `data:` fields. Lines with field name `retry` fall through to the "field with no value" or are silently ignored since only `event` and `data` are matched. Comment lines (`:`) and blank lines are handled correctly.
- **Severity**: Low -- `retry:` lines are almost never sent by LLM providers in practice, and the parser gracefully ignores them rather than erroring.

### [GAP-PROV-002] OpenAI Responses API: `response.output_item.done` checks `output_text` instead of `message` type
- **Spec reference**: section 7.7 (OpenAI Streaming) -- "output_item.done (text) -> TEXT_END event"
- **What spec requires**: When `output_item.done` fires for a completed text output item, emit TEXT_END.
- **What code has**: `unified-llm/src/providers/openai/stream-translator.ts:121` checks `doneType === "output_text"` but the actual Responses API output items have type `"message"` at the item level (the content within has type `"output_text"`). The code is checking the wrong field for some event shapes, though in practice the current OpenAI SSE payloads seem to include the content type directly, making this work by coincidence.
- **Severity**: Low -- works in practice with current OpenAI API behavior, but fragile if the API payload structure changes.

### [GAP-PROV-003] OpenAI adapter maps HTTP 408 to ServerError, spec says RequestTimeoutError
- **Spec reference**: section 6.4 (HTTP Status Code Mapping) -- "408 -> RequestTimeoutError (retryable: true)"
- **What spec requires**: HTTP 408 should produce a `RequestTimeoutError`
- **What code has**: `unified-llm/src/providers/openai/adapter.ts:103` maps 408 to `ServerError`. Same issue in `unified-llm/src/providers/openai-compatible/adapter.ts:101`. Anthropic adapter at `unified-llm/src/providers/anthropic/adapter.ts:76` and Gemini adapter at `unified-llm/src/providers/gemini/adapter.ts:72` also map 408 to `ServerError`.
- **Severity**: Medium -- All four adapters have this gap. `RequestTimeoutError` is a distinct error class in the hierarchy (`unified-llm/src/types/errors.ts:126-131`). Using `ServerError` still marks it retryable, but callers checking `instanceof RequestTimeoutError` for 408s will get false negatives.

### [GAP-PROV-004] No ContentFilterError or QuotaExceededError mapping in any adapter
- **Spec reference**: section 6.4 and section 6.5 -- ContentFilterError and QuotaExceededError exist in the hierarchy; section 6.5 says messages containing "content filter" or "safety" -> ContentFilterError
- **What spec requires**: Adapters should detect content filter and quota exceeded conditions via message classification (section 6.5) and raise ContentFilterError / QuotaExceededError as appropriate.
- **What code has**: `ContentFilterError` and `QuotaExceededError` classes exist in `unified-llm/src/types/errors.ts:105-124` but no adapter's `mapError` function ever instantiates them. OpenAI adapter (`adapter.ts:84-117`) checks for context length in 400 messages but not content filter or quota. Anthropic adapter checks for `invalid_request_error` + context/token in 400 messages but not content filter. Gemini adapter has no message-based classification at all.
- **Severity**: High -- These are defined error types in the spec that are never used, meaning callers cannot reliably distinguish content filter blocks or quota exhaustion from generic errors.

### [GAP-PROV-005] No message-based error classification for "not found", "unauthorized", "invalid key" patterns
- **Spec reference**: section 6.5 -- "Messages containing 'not found' or 'does not exist' -> NotFoundError", "Messages containing 'unauthorized' or 'invalid key' -> AuthenticationError"
- **What spec requires**: For ambiguous status codes, check error message for classification signals.
- **What code has**: Only the OpenAI and OpenAI-compatible adapters do message-based classification, and only for context length keywords on 400 responses. None of the adapters check for "not found", "unauthorized", "invalid key", "content filter", or "safety" keywords. Anthropic adapter checks for `invalid_request_error` error type + regex `/context|token/` for 400s but doesn't do broader message classification.
- **Severity**: Medium -- This mainly matters for ambiguous cases. Most errors map cleanly by status code already.

### [GAP-PROV-006] OpenAI Responses API finish reason mapping: no dedicated `tool_calls` from provider
- **Spec reference**: section 3.8 (FinishReason mapping) -- "OpenAI | tool_calls -> tool_calls"
- **What spec requires**: The OpenAI adapter should map provider value `tool_calls` to unified `tool_calls`.
- **What code has**: `unified-llm/src/providers/openai/response-translator.ts:8-20` maps Responses API `status` field (completed/incomplete/failed/content_filter), not the Chat Completions `finish_reason` field. The Responses API uses `status: "completed"` even when tool calls are present. The code works around this at line 83-87 by checking for tool call presence (`hasToolCalls`) and overriding the finish reason. This is correct behavior for the Responses API but differs from the spec's table which lists Chat Completions values. Not a real gap since the Responses API doesn't have a `tool_calls` status value -- the implementation correctly infers it.
- **Severity**: Low -- implementation is actually correct for the Responses API; the spec table is Chat Completions-oriented.

### [GAP-PROV-007] Gemini adapter does not handle gRPC error code mapping
- **Spec reference**: section 6.4 -- Table of gRPC status codes for Gemini (NOT_FOUND, INVALID_ARGUMENT, UNAUTHENTICATED, etc.)
- **What spec requires**: Map gRPC status codes (returned in Gemini error response body as `error.status`) to appropriate error types. E.g., `DEADLINE_EXCEEDED -> RequestTimeoutError`.
- **What code has**: `unified-llm/src/providers/gemini/adapter.ts:45-88` maps by HTTP status code only. The `errorCode` is extracted from `error.status` or `error.code` but only used as metadata -- not for classification. For example, a Gemini error with HTTP 400 and gRPC `DEADLINE_EXCEEDED` would be mapped to `InvalidRequestError` instead of `RequestTimeoutError`.
- **Severity**: Medium -- Gemini REST API usually maps gRPC codes to HTTP codes correctly, but there are edge cases where the HTTP code is generic (e.g., 400) but the gRPC code is specific.

### [GAP-PROV-008] OpenAI Responses API tool definition wrapper differs from spec
- **Spec reference**: section 7.4 (Tool Definition Translation) -- OpenAI wrapper structure: `{"type":"function","function":{...}}`
- **What spec requires**: Tool definitions should be wrapped as `{"type":"function","function":{"name":...,"description":...,"parameters":...}}`
- **What code has**: `unified-llm/src/providers/openai/request-translator.ts:233-239` produces `{"type":"function","name":...,"description":...,"parameters":...,"strict":true}` -- a flat structure with name/description/parameters at the top level alongside `type`. This is the correct format for the Responses API (`/v1/responses`), which uses a different tool schema than Chat Completions. The spec table describes the Chat Completions format.
- **Severity**: Low -- The code is correct for the Responses API. The spec table at section 7.4 appears to describe Chat Completions format. The OpenAI-compatible adapter (`openai-compatible/request-translator.ts:169-177`) correctly uses the nested `function` wrapper for Chat Completions.

### [GAP-PROV-009] Anthropic adapter: `is_error` field always sent, even when false
- **Spec reference**: section 7.3 (Anthropic Message Translation) -- `tool_result` content block includes `is_error`
- **What spec requires**: `{ "type": "tool_result", "tool_use_id": "...", "content": "...", "is_error": ... }`
- **What code has**: `unified-llm/src/providers/anthropic/request-translator.ts:82-86` always includes `is_error` in the output, even when it's `false` or `undefined`. The Anthropic API accepts this but some implementations might treat the explicit `false` differently from absent field.
- **Severity**: Low -- Functionally correct; Anthropic API handles both forms.

### [GAP-PROV-010] OpenAI stream translator missing `response.in_progress` event handling
- **Spec reference**: section 7.7 (OpenAI Streaming) -- "event: response.in_progress -- generation started"
- **What spec requires**: The `response.in_progress` event is part of the Responses API stream format.
- **What code has**: `unified-llm/src/providers/openai/stream-translator.ts:68-154` has cases for `response.created`, `response.output_text.delta`, `response.output_item.added`, `response.function_call_arguments.delta`, `response.output_item.done`, and `response.completed` but no case for `response.in_progress`. The event is silently ignored by the default case.
- **Severity**: Low -- This event doesn't map to any unified StreamEvent. Ignoring it is reasonable since `STREAM_START` is already emitted from `response.created`.

### [GAP-PROV-011] OpenAI Responses API usage fields: code reads `input_tokens`/`output_tokens` but Responses API actually returns those field names
- **Spec reference**: section 3.9 (Usage) -- provider field mapping table shows OpenAI uses `usage.prompt_tokens` and `usage.completion_tokens`
- **What spec requires**: Map `usage.prompt_tokens` -> `input_tokens` and `usage.completion_tokens` -> `output_tokens` for OpenAI.
- **What code has**: `unified-llm/src/providers/openai/response-translator.ts:28-29` reads `input_tokens` and `output_tokens`. `unified-llm/src/providers/openai/stream-translator.ts:29-30` does the same. The Responses API actually uses `input_tokens` and `output_tokens` (not `prompt_tokens`/`completion_tokens` which are Chat Completions fields). The spec's mapping table appears to describe Chat Completions. The OpenAI-compatible adapter correctly reads `prompt_tokens`/`completion_tokens` for Chat Completions.
- **Severity**: Medium -- The spec table at section 3.9 says OpenAI uses `usage.prompt_tokens` and `usage.completion_tokens`, but the code reads `input_tokens`/`output_tokens`. If the spec is authoritative and the OpenAI adapter should use `prompt_tokens`/`completion_tokens`, this is a bug. However, the Responses API genuinely uses `input_tokens`/`output_tokens`, so the code is likely correct and the spec table is Chat Completions-oriented. Either the spec needs updating or this needs clarification.

## Fully Covered

The following spec items are correctly implemented:

### section 7.1 Interface Summary
- All adapters implement `ProviderAdapter` interface with `name`, `complete()`, `stream()` (`unified-llm/src/types/provider-adapter.ts:5-13`)
- Optional `close()`, `initialize()` methods available on interface
- `supportsToolChoice()` implemented on all four adapters
- `supportsNativeJsonSchema` flag present on OpenAI, Gemini, and OpenAI-Compatible adapters

### section 7.2 Request Translation (all 7 steps)
1. **Extract system messages**: OpenAI -> `instructions` parameter (`openai/request-translator.ts:207-224`); Anthropic -> `system` parameter (`anthropic/request-translator.ts:158-167`); Gemini -> `systemInstruction` (`gemini/request-translator.ts:141-175`)
2. **Translate messages**: All adapters correctly translate messages per section 7.3
3. **Translate tools**: All adapters convert tool definitions per section 7.4
4. **Translate tool choice**: All adapters map ToolChoice correctly
5. **Set generation parameters**: temperature, top_p, max_tokens, stop_sequences mapped in all adapters
6. **Apply response format**: OpenAI uses `text.format` for Responses API; Anthropic uses prompt engineering fallback; Gemini uses `responseMimeType`/`responseSchema`; OpenAI-Compatible uses `response_format`
7. **Apply provider options**: All adapters merge `providerOptions[provider_name]` into request body

### section 7.3 Message Translation Details
- **OpenAI Responses API**: System -> `instructions`, USER -> `input_text`, ASSISTANT -> `output_text`, TOOL -> `function_call_output`, tool calls -> top-level `function_call` items (all at `openai/request-translator.ts:57-128`)
- **Anthropic**: System -> `system` param, DEVELOPER -> merged with system, TOOL -> user role with `tool_result` blocks, strict alternation via `mergeAlternatingMessages()`, thinking/redacted_thinking round-tripping, max_tokens defaults to 4096 (`anthropic/request-translator.ts:153-284`)
- **Gemini**: System -> `systemInstruction`, ASSISTANT -> "model" role, TOOL -> user role with `functionResponse`, synthetic tool call IDs via `crypto.randomUUID()`, function response wraps strings in `{result: "..."}` (`gemini/request-translator.ts:135-240`)
- **OpenAI-Compatible (Chat Completions)**: System messages in `messages` array with `system` role, standard Chat Completions format (`openai-compatible/request-translator.ts:52-128`)

### section 7.4 Tool Definition Translation
- OpenAI (Responses API): flat `{type:"function", name, description, parameters, strict}` -- correct for Responses API (`openai/request-translator.ts:232-239`)
- Anthropic: `{name, description, input_schema}` (`anthropic/request-translator.ts:121-129`)
- Gemini: `{functionDeclarations: [{name, description, parameters}]}` (`gemini/request-translator.ts:97-109`)
- OpenAI-Compatible: `{type:"function", function:{name, description, parameters}}` -- correct for Chat Completions (`openai-compatible/request-translator.ts:168-177`)

### section 7.5 Response Translation
- All adapters extract content parts, map finish reasons, extract usage, preserve raw response, extract rate limit info
- OpenAI: `openai/response-translator.ts:51-110`
- Anthropic: `anthropic/response-translator.ts:58-116`
- Gemini: `gemini/response-translator.ts:61-119`
- OpenAI-Compatible: `openai-compatible/response-translator.ts:57-120`

### section 7.6 Error Translation
- All adapters parse response body for error details, extract error message/code
- All adapters extract `Retry-After` header for 429 responses
- All adapters map HTTP status codes per section 6.4 (with the 408/ContentFilter/Quota exceptions noted in gaps above)
- All adapters preserve raw error response in the error's `raw` field

### section 7.7 Streaming Translation
- **SSE Parser**: Handles `event:` lines, `data:` lines (including multi-line), comment lines, blank line boundaries (`unified-llm/src/utils/sse.ts`)
- **OpenAI streaming**: Maps `output_text.delta` -> TEXT_DELTA, `function_call_arguments.delta` -> TOOL_CALL_DELTA, `output_item.done` -> TEXT_END/TOOL_CALL_END, `response.completed` -> FINISH with usage including reasoning tokens (`openai/stream-translator.ts`)
- **Anthropic streaming**: Maps all content_block types (text, tool_use, thinking, redacted_thinking) to correct stream events, handles message_start for input tokens, message_delta for finish reason + output tokens, message_stop for FINISH (`anthropic/stream-translator.ts`)
- **Gemini streaming**: Maps text parts -> TEXT_DELTA, functionCall parts -> TOOL_CALL_START+TOOL_CALL_END (complete in one chunk per spec), thought parts -> REASONING events, handles usage from `usageMetadata` (`gemini/stream-translator.ts`)
- **OpenAI-Compatible streaming**: Handles Chat Completions `data:` format with choices/delta/content, tool_calls delta, `[DONE]` sentinel (`openai-compatible/stream-translator.ts`)

### section 7.8 Provider Quirks
- **Authentication**: OpenAI uses Bearer token, Anthropic uses `x-api-key` header, Gemini uses `key` query parameter
- **API versioning**: OpenAI via URL path `/v1/`, Anthropic via `anthropic-version` header, Gemini via URL path `/v1beta/`
- **Anthropic strict alternation**: Handled by `mergeAlternatingMessages()` (`anthropic/request-translator.ts:136-151`)
- **Anthropic tool choice "none"**: Omits tools entirely from request (`anthropic/request-translator.ts:218-231`)
- **Anthropic max_tokens required**: Defaults to 4096 (`anthropic/request-translator.ts:199`)
- **Anthropic beta headers**: Handled via `providerOptions.anthropic.betaHeaders` and cache beta header (`anthropic/request-translator.ts:240-252`, `anthropic/adapter.ts:173-182`)
- **Anthropic prompt caching**: Automatic via `injectCacheControl()` with opt-out (`anthropic/cache.ts`, `anthropic/adapter.ts:109-111,135-137,188-194`)
- **Gemini tool call IDs**: Synthetic UUIDs generated (`gemini/response-translator.ts:43`, `gemini/stream-translator.ts:74`)
- **Gemini function response format**: Uses function name (not call ID) with dict wrapping (`gemini/request-translator.ts:57-66`)
- **Gemini streaming format**: Uses `?alt=sse` query parameter (`gemini/adapter.ts:132`)
- **OpenAI reasoning effort**: Maps to `reasoning.effort` in request body (`openai/request-translator.ts:269-271`)

### section 7.9 Adding a New Provider
- Pattern is well-established: each provider has adapter.ts, request-translator.ts, response-translator.ts, stream-translator.ts, index.ts

### section 7.10 OpenAI-Compatible Endpoints
- Separate `OpenAICompatibleAdapter` exists using Chat Completions endpoint `/v1/chat/completions` (`openai-compatible/adapter.ts:118-194`)
- Uses `messages` array format (not `input`), correct tool wrapper format
- `apiKey` is optional (for self-hosted endpoints)
- Distinct from primary OpenAI adapter (which uses Responses API)
