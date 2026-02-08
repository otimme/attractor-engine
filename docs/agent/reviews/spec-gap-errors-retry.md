# Spec Gap Analysis: Error Handling & Retry (SS6)

## Summary

Error handling and retry infrastructure is well-implemented overall. The error taxonomy, retry policy, and adapter-level error mapping are largely correct. **5 gaps found** -- 2 high severity, 2 medium, 1 low.

## Gaps Found

### [GAP-ERR-001] Anthropic adapter maps 408 to ServerError instead of RequestTimeoutError
- **Spec reference**: SS6.4 - HTTP Status Code Mapping table
- **What spec requires**: HTTP 408 should map to `RequestTimeoutError` (retryable: true)
- **What code has**: `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/anthropic/adapter.ts:76` maps 408 to `new ServerError(message, provider, errorType, 408, body)`. The same issue exists in OpenAI (`adapter.ts:103`), Gemini (`adapter.ts:73`), and OpenAI-compatible (`adapter.ts:101`).
- **Severity**: Medium -- Both are retryable so the functional impact is limited, but the error type is wrong, which could affect error-handling logic downstream that checks `instanceof RequestTimeoutError`. Note: `RequestTimeoutError` extends `SDKError` not `ProviderError`, so the adapter would need to be restructured slightly or `RequestTimeoutError` needs a provider variant to carry `statusCode`/`provider` fields.

### [GAP-ERR-002] Gemini adapter has no gRPC status code mapping
- **Spec reference**: SS6.4 - gRPC status code mapping table for Gemini
- **What spec requires**: Gemini adapter should map gRPC status codes (NOT_FOUND, INVALID_ARGUMENT, UNAUTHENTICATED, PERMISSION_DENIED, RESOURCE_EXHAUSTED, UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL) to the corresponding error types.
- **What code has**: `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/gemini/adapter.ts:45-88` -- The `mapError` function only handles HTTP status codes. There is no gRPC status code inspection. A search for gRPC-related terms (NOT_FOUND, INVALID_ARGUMENT, etc.) across the entire `src/` directory returned zero matches.
- **Severity**: High -- Gemini can return gRPC-style errors, especially in non-REST transport modes. Without this mapping, gRPC errors would fall through to the generic `ProviderError` in `http.ts:109-117` with `retryable: true`, which could cause incorrect retry behavior for non-retryable gRPC errors like UNAUTHENTICATED.

### [GAP-ERR-003] Error message classification missing for most adapters
- **Spec reference**: SS6.5 - Error Message Classification
- **What spec requires**: For ambiguous cases, adapters should check the error message body for: "not found" / "does not exist" -> NotFoundError; "unauthorized" / "invalid key" -> AuthenticationError; "context length" / "too many tokens" -> ContextLengthError; "content filter" / "safety" -> ContentFilterError.
- **What code has**: Only partial implementation. OpenAI adapter (`adapter.ts:86-91`) and OpenAI-compatible adapter (`adapter.ts:84-89`) check for "context length" / "too many tokens" / "maximum context" on 400 errors. Anthropic adapter (`adapter.ts:66`) checks for "context" / "token" on 400 errors. But **no adapter** checks for: "not found" / "does not exist", "unauthorized" / "invalid key", "content filter" / "safety". These message-based classifications are spec-required for ambiguous status codes.
- **Severity**: High -- Without "content filter" / "safety" classification, safety-filtered responses would not be correctly typed as `ContentFilterError`. Without "unauthorized" / "invalid key" classification, some 400-level auth errors from providers that don't use 401 would be misclassified.

### [GAP-ERR-004] Unknown errors default to retryable only in http.ts fallback, not explicitly documented in retry logic
- **Spec reference**: SS6.3 - "Unknown errors default to retryable"
- **What spec requires**: Errors that don't match any known type should default to `retryable = true`.
- **What code has**: In `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/utils/http.ts:109-117`, when `mapError` returns `undefined` (no match), the fallback creates a `ProviderError` with `retryable: true`. In `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/utils/retry.ts:58`, only `SDKError` instances are checked for `retryable`; non-SDKError errors are re-thrown immediately without retry. This means unknown non-SDKError exceptions (e.g. from middleware, JSON parsing, etc.) are NOT retried.
- **Severity**: Medium -- The spec says "unknown errors default to retryable" but the retry function treats non-SDKError exceptions as non-retryable (they are thrown immediately at line 49). This is a reasonable safety choice but differs from spec. The http layer correctly defaults unknown HTTP errors to retryable.

### [GAP-ERR-005] stream() retry does not call onRetry callback
- **Spec reference**: SS6.6 - RetryPolicy `on_retry` field: "called before each retry with (error, attempt, delay)"
- **What spec requires**: The `onRetry` callback should be invoked before each retry attempt.
- **What code has**: In `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/api/stream.ts:179-207`, the stream retry loop manually implements retry logic (duplicated from `retry()` utility) but does NOT call any `onRetry` callback. The `retryPolicy` object constructed at line 171-177 does not include an `onRetry` field. The `generate()` function at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/api/generate.ts:141` also hardcodes the retry policy without passing through any user-supplied `onRetry`. Neither `GenerateOptions` nor `StreamOptions` expose an `onRetry` option.
- **Severity**: Low -- The `RetryPolicy` type supports `onRetry` and the `retry()` utility calls it, but the high-level API functions don't expose it. Users of the standalone `retry()` utility can use it, but `generate()` and `stream()` users cannot.

## Fully Covered

The following spec items are correctly implemented:

- **SS6.1 Error Taxonomy**: All 14 error classes exist in `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/types/errors.ts` with correct inheritance hierarchy: `SDKError` base with `ProviderError` subtree (AuthenticationError, AccessDeniedError, NotFoundError, InvalidRequestError, RateLimitError, ServerError, ContentFilterError, ContextLengthError, QuotaExceededError) plus direct SDKError children (RequestTimeoutError, AbortError, NetworkError, StreamError, InvalidToolCallError, NoObjectGeneratedError, ConfigurationError).

- **SS6.1 SDKError base fields**: `SDKError` has `message` (inherited from `Error`) and `cause` (via `ErrorOptions`). The `retryable` field is present on SDKError itself.

- **SS6.2 ProviderError fields**: All six spec fields are present: `provider`, `statusCode`, `errorCode`, `retryable` (inherited), `retryAfter`, `raw`. Types match spec (statusCode optional number, errorCode optional string, retryAfter optional number, raw optional unknown).

- **SS6.3 Retryability Classification**: All non-retryable errors (AuthenticationError, AccessDeniedError, NotFoundError, InvalidRequestError, ContextLengthError, QuotaExceededError, ContentFilterError, ConfigurationError) correctly set `retryable: false`. All retryable errors (RateLimitError, ServerError, RequestTimeoutError, NetworkError, StreamError) correctly set `retryable: true`. AbortError is correctly non-retryable.

- **SS6.4 HTTP Status Code Mapping**: Status codes 400, 401, 403, 404, 413, 422, 429, 500+ are correctly mapped across all four adapters. The Anthropic adapter also handles 529 (overloaded). Each adapter extracts Retry-After headers for 429 responses.

- **SS6.6 RetryPolicy record**: `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/utils/retry.ts:3-10` -- all fields match spec: `maxRetries` (default 2), `baseDelay` (default 1.0), `maxDelay` (default 60.0), `backoffMultiplier` (default 2.0), `jitter` (default true), `onRetry` callback.

- **SS6.6 Exponential Backoff with Jitter**: `computeDelay()` at `retry.ts:20-36` correctly implements `MIN(base_delay * (backoff_multiplier ^ n), max_delay)` with `delay * (0.5 + random * 1.0)` jitter, matching the spec's +/- 50% jitter range.

- **SS6.6 Retry-After Header**: `computeDelay()` at `retry.ts:21-26` correctly uses `retryAfter` when present, and returns -1 (abort) when `retryAfter > maxDelay`, matching the spec requirement to not retry when Retry-After exceeds max_delay.

- **SS6.6 What Gets Retried -- generate()**: `generate()` at `generate.ts:139-142` wraps each step's LLM call in `retry()`, so retries are per-step, not per-operation. Correct per spec.

- **SS6.6 What Gets Retried -- stream()**: `stream()` at `stream.ts:179-207` retries only the initial connection (stream creation + first event), then yields remaining events without retry. Correct per spec.

- **SS6.6 What Gets Retried -- generate_object()**: `generateObject()` delegates to `generate()` which handles retry. Schema validation failures throw `NoObjectGeneratedError` (non-retryable), not retried. Correct per spec.

- **SS6.6 Adapter-level retry**: `Client.complete()` and `Client.stream()` at `client.ts:55-74` do NOT retry. Retry lives in the high-level API layer (`generate.ts`, `stream.ts`). The standalone `retry()` utility is exported for low-level API users. Correct per spec.

- **SS6.6 Disabling retries**: `generate()` at `generate.ts:100` reads `maxRetries` from options (default 2), passes it to `retry()`. Setting `maxRetries: 0` would cause `retry()` loop to execute exactly once (attempt 0 only), effectively disabling retries. Correct per spec.

- **SS6.7 Rate Limit Handling**: All four adapters extract `Retry-After` header on 429 responses and create `RateLimitError` with `retryable: true` and `retryAfter` set. The retry logic respects `retryAfter` via `computeDelay()`. Correct per spec.

- **SS6.7 Proactive rate limiting via middleware**: The Client supports middleware via `buildMiddlewareChain` at `client.ts:61`. The spec suggests middleware for proactive rate limiting, and the middleware interface supports this pattern.
