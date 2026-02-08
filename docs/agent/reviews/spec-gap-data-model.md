# Spec Gap Analysis: Data Model (section 3)

## Summary

The data model types in `unified-llm/src/types/` are largely faithful to spec section 3. Most records, enums, fields, and convenience functions are present with correct semantics. **8 gaps** found, ranging from a missing enum to return type mismatches and a missing extensibility mechanism.

## Gaps Found

### [GAP-DM-001] Missing ContentKind enum
- **Spec reference**: section 3.4 - ContentKind enum with 8 values (TEXT, IMAGE, AUDIO, DOCUMENT, TOOL_CALL, TOOL_RESULT, THINKING, REDACTED_THINKING)
- **What spec requires**: A standalone `ContentKind` enum that enumerates all valid content kinds.
- **What code has**: No `ContentKind` enum exists anywhere in `unified-llm/src/`. The kind values are inlined as string literal types in the individual part interfaces (`TextPart`, `ImagePart`, etc.) inside `unified-llm/src/types/content-part.ts:42-90`. The discriminant values match the spec, but there is no reusable enum constant object (like `Role` in `role.ts`).
- **Severity**: Low -- The semantics are correct via the discriminated union. A standalone enum would improve discoverability and enable programmatic iteration over content kinds.

### [GAP-DM-002] ContentPart kind field does not accept arbitrary strings
- **Spec reference**: section 3.3 - `kind : ContentKind | String -- discriminator tag`
- **What spec requires**: The `kind` field accepts both the enum values AND arbitrary strings, to allow extension for provider-specific content kinds without modifying the core enum.
- **What code has**: `ContentPart` in `unified-llm/src/types/content-part.ts:82-90` is a closed discriminated union of 8 specific interfaces. There is no way to represent a `ContentPart` with an arbitrary `kind` string (e.g., a provider-specific kind like `"server_tool_use"`). Adding one would require a catch-all variant (e.g., `{ kind: string; raw?: unknown }`).
- **Severity**: Medium -- This prevents the extensibility the spec explicitly calls for. Provider-specific content types cannot be represented in the unified model.

### [GAP-DM-003] responseReasoning returns string instead of string | undefined
- **Spec reference**: section 3.7 - `response.reasoning -> String | None`
- **What spec requires**: The reasoning accessor returns `None` (undefined) when no reasoning/thinking content exists.
- **What code has**: `responseReasoning()` in `unified-llm/src/types/response.ts:84-89` always returns `string` (empty string `""` when no thinking parts exist, via `.join("")`).
- **Severity**: Low -- Callers testing truthiness (`if (reasoning)`) get the same result for `""` and `undefined`. But callers distinguishing "model did no reasoning" from "model reasoned but produced empty text" cannot.

### [GAP-DM-004] ToolCallData.type has no default value of "function"
- **Spec reference**: section 3.5 (ToolCallData) - `type : String -- "function" (default) or "custom"`
- **What spec requires**: The `type` field defaults to `"function"`.
- **What code has**: `ToolCallData.type` in `unified-llm/src/types/content-part.ts:25` is `type?: string` (optional, no default). Consumers receive `undefined` unless explicitly set.
- **Severity**: Low -- In practice, all tool calls are function calls and adapters set this. But the spec says the default should be `"function"`.

### [GAP-DM-005] StreamEvent uses individual typed interfaces instead of single flat record
- **Spec reference**: section 3.13 - Single `RECORD StreamEvent` with all optional fields and a `type` discriminator
- **What spec requires**: One flat `StreamEvent` record with optional fields (`delta`, `text_id`, `reasoning_delta`, `tool_call`, `finish_reason`, `usage`, `response`, `error`, `raw`).
- **What code has**: `unified-llm/src/types/stream-event.ts:23-114` defines 14 separate typed interfaces (`StreamStartEvent`, `TextDeltaEvent`, `FinishEvent`, etc.) combined into a discriminated union. Each interface only contains the fields relevant to that event type.
- **Severity**: Low -- The code's approach is actually superior for TypeScript (better type narrowing). The semantics match. This is a structural difference, not a semantic gap. The spec's flat record is language-neutral notation.

### [GAP-DM-006] StreamEvent missing tool_call field (uses separate fields instead)
- **Spec reference**: section 3.13 - `tool_call : ToolCall | None -- partial or complete tool call`
- **What spec requires**: A `tool_call` field on stream events carrying a `ToolCall` object.
- **What code has**: `ToolCallStartEvent` (`stream-event.ts:59-63`) has `toolCallId` and `toolName` as separate fields. `ToolCallDeltaEvent` (`stream-event.ts:65-69`) has `toolCallId` and `argumentsDelta`. There is no unified `toolCall` object on these events.
- **Severity**: Medium -- Consumers that want a `ToolCall` object from stream events must assemble it themselves from the separate fields. The spec envisions the event carrying a (partial or complete) ToolCall object.

### [GAP-DM-007] StreamEvent missing raw field for passthrough
- **Spec reference**: section 3.13 - `raw : Dict | None -- raw provider event for passthrough`
- **What spec requires**: A `raw` field on `StreamEvent` for raw provider event data passthrough.
- **What code has**: `ProviderEvent` in `stream-event.ts:94-98` has `eventType: string` and `data: unknown`, but other event types have no `raw` field. The `ProviderEvent` type uses `data` (not `raw`) and adds an `eventType` field not in spec.
- **Severity**: Low -- The `ProviderEvent` serves the same purpose but with different field names. Other event types cannot carry raw provider data.

### [GAP-DM-008] StepFinishEvent not in spec section 3.14 StreamEventType enum
- **Spec reference**: section 3.14 - StreamEventType enum lists 12 values
- **What spec requires**: The enum in section 3.14 does NOT include `STEP_FINISH`. It is mentioned elsewhere in the spec (sections 4.3, 5.6) as a streaming behavior.
- **What code has**: `StreamEventType` in `stream-event.ts:14` includes `STEP_FINISH: "step_finish"` and there is a `StepFinishEvent` interface (`stream-event.ts:76-80`).
- **Severity**: Low -- The event is spec-consistent (mentioned in sections 4.3 and 5.6) but is missing from the section 3.14 enum definition. This appears to be a spec omission rather than a code gap.

## Fully Covered

The following spec items are correctly implemented:

- **section 3.1 Message** -- `Message` interface (`message.ts:6-11`) has all 4 fields: `role`, `content`, `name`, `toolCallId`. Field names use camelCase equivalents correctly.
- **section 3.1 Convenience constructors** -- All 4 factory functions exist: `systemMessage()`, `userMessage()`, `assistantMessage()`, `toolResultMessage()` (`message.ts:13-49`). The `toolResultMessage` accepts `toolCallId`, `content`, and `isError` parameters matching spec.
- **section 3.1 Text accessor** -- `messageText()` (`message.ts:51-56`) concatenates text from all text parts, returns empty string if none. Matches spec.
- **section 3.2 Role** -- All 5 roles present: SYSTEM, USER, ASSISTANT, TOOL, DEVELOPER (`role.ts:1-9`).
- **section 3.3 ContentPart** -- Discriminated union with all 8 part types (`content-part.ts:82-90`). Each part interface has the correct `kind` discriminant and data field.
- **section 3.5 ImageData** -- All 4 fields: `url`, `data` (as `Uint8Array`), `mediaType`, `detail` (`content-part.ts:1-6`).
- **section 3.5 AudioData** -- All 3 fields: `url`, `data`, `mediaType` (`content-part.ts:8-12`).
- **section 3.5 DocumentData** -- All 4 fields: `url`, `data`, `mediaType`, `fileName` (`content-part.ts:14-19`).
- **section 3.5 ToolCallData** -- All 4 fields: `id`, `name`, `arguments` (as `Record<string, unknown> | string`), `type` (`content-part.ts:21-26`).
- **section 3.5 ToolResultData** -- All 5 fields: `toolCallId`, `content`, `isError`, `imageData`, `imageMediaType` (`content-part.ts:28-34`).
- **section 3.5 ThinkingData** -- All 3 fields: `text`, `signature`, `redacted` (`content-part.ts:36-40`).
- **section 3.6 Request** -- All 12 spec fields present plus 2 extras (`timeout`, `abortSignal`) that are consistent with other spec sections (`request.ts:6-22`).
- **section 3.7 Response** -- All 8 fields present: `id`, `model`, `provider`, `message`, `finishReason`, `usage`, `raw`, `warnings`, `rateLimit` (`response.ts:39-49`).
- **section 3.7 Convenience accessors** -- `responseText()`, `responseToolCalls()`, `responseReasoning()` all exist (`response.ts:71-89`). Note: `responseReasoning` return type differs (see GAP-DM-003).
- **section 3.8 FinishReason** -- Both fields present: `reason` (with all 6 values as union literal type), `raw` (`response.ts:5-14`).
- **section 3.9 Usage** -- All 7 fields present: `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens`, `raw` (`response.ts:16-24`).
- **section 3.9 Usage addition** -- `addUsage()` (`response.ts:51-69`) correctly sums integer fields and handles optional fields (None + None = None, None + value = value).
- **section 3.10 ResponseFormat** -- All 3 variants: `text`, `json`, `json_schema` with `jsonSchema` and `strict` fields (`response-format.ts:1-8`).
- **section 3.11 Warning** -- Both fields: `message`, `code` (`response.ts:26-29`).
- **section 3.12 RateLimitInfo** -- All 5 fields: `requestsRemaining`, `requestsLimit`, `tokensRemaining`, `tokensLimit`, `resetAt` (`response.ts:31-37`).
- **section 3.14 StreamEventType** -- All 12 spec values present plus `STEP_FINISH` (see GAP-DM-008) (`stream-event.ts:3-18`).
- **Type guard functions** -- 8 type guards (`isTextPart`, `isImagePart`, etc.) for all content part types (`content-part.ts:92-124`). Not in spec but valuable TypeScript additions.
