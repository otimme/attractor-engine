# Spec Gap Analysis: Generation, Streaming & Tools (SS4-5)

## Summary

Coverage is strong. The core generate/stream/generate_object/stream_object functions, tool execution loop, parallel tool execution, StepResult/GenerateResult/StreamResult types, StreamAccumulator, retry, timeouts, and ToolChoice translations are all implemented. 8 gaps found, mostly around missing validation, missing context injection in tool handlers, and a missing `object()` accessor on `stream_object()` output.

## Gaps Found

### [GAP-GEN-001] OpenAI named tool_choice format is wrong
- **Spec reference**: SS5.3 -- ToolChoice provider mapping table
- **What spec requires**: OpenAI named mode must send `{"type":"function","function":{"name":"..."}}` (nested `function` key).
- **What code has**: `unified-llm/src/providers/openai/request-translator.ts:190` sends `{ type: "function", name: toolChoice.toolName }` -- flat, no nested `function` key. The OpenAI Responses API may accept this format, but the spec explicitly defines the nested format. Note: the openai-compatible adapter at `unified-llm/src/providers/openai-compatible/request-translator.ts:144` correctly uses `{ type: "function", function: { name: toolChoice.toolName } }`.
- **Severity**: Medium (may work with new Responses API but deviates from spec)

### [GAP-GEN-002] No tool name validation at definition time
- **Spec reference**: SS5.1 -- "Names must be valid identifiers: alphanumeric characters and underscores, starting with a letter. Maximum 64 characters. The library validates names at definition time."
- **What spec requires**: Tool names are validated against `[a-zA-Z][a-zA-Z0-9_]*` max 64 chars when a Tool/ToolDefinition is created.
- **What code has**: `unified-llm/src/types/tool.ts` -- `ToolDefinition` is a plain interface with `name: string`. No validation function exists. No regex check anywhere in the codebase.
- **Severity**: Medium

### [GAP-GEN-003] No tool call validation against parameter schema before execution
- **Spec reference**: SS5.8 -- "Before passing arguments to the execute handler, the library: 1. Parses the JSON argument string. 2. Optionally validates against the tool's parameter schema."
- **What spec requires**: Arguments should be validated against the tool's `parameters` JSON Schema before calling `execute`.
- **What code has**: `unified-llm/src/api/generate.ts:165` -- arguments are parsed from string to object, but never validated against `tool.parameters` schema. The `validateJsonSchema` utility exists in `unified-llm/src/utils/validate-json-schema.ts` but is only used for `generate_object`/`stream_object`.
- **Severity**: Low (spec says "optionally")

### [GAP-GEN-004] No repair_tool_call support
- **Spec reference**: SS5.8 -- "If validation fails and a `repair_tool_call` function is provided, attempts repair"
- **What spec requires**: Optional `repair_tool_call` callback for attempting to fix invalid tool arguments.
- **What code has**: No `repairToolCall` parameter anywhere in `GenerateOptions`, `generate()`, or `stream()`. No repair mechanism exists.
- **Severity**: Low (spec implies this is optional)

### [GAP-GEN-005] No tool context injection in execute handlers
- **Spec reference**: SS5.2 -- "Handlers can optionally receive injected context. The library inspects the handler's signature and injects recognized keyword arguments: messages, abort_signal, tool_call_id"
- **What spec requires**: The library should inspect execute handler signatures and inject `messages`, `abort_signal`, and `tool_call_id` as recognized keyword arguments.
- **What code has**: `unified-llm/src/api/generate.ts:166` calls `toolDef.execute(args)` with only the parsed arguments. No signature inspection or context injection. The handler type in `tool.ts:5` is `(args: Record<string, unknown>) => Promise<unknown> | unknown` which doesn't support additional context parameters.
- **Severity**: Medium

### [GAP-GEN-006] stream_object() missing object() accessor
- **Spec reference**: SS4.6 -- "final = result.object()  -- the complete, validated object"
- **What spec requires**: `stream_object()` should return a result with an `object()` method that returns the final validated object after iteration.
- **What code has**: `unified-llm/src/api/stream-object.ts` -- `streamObject()` is an `AsyncGenerator<unknown>` that yields partial objects. There is no wrapper type with an `object()` method. Consumers must track the last yielded value themselves. The function validates at the end but doesn't expose the final object via a dedicated accessor.
- **Severity**: Medium

### [GAP-GEN-007] UnsupportedToolChoiceError not implemented
- **Spec reference**: SS5.3 -- "If a provider does not support a particular mode, the adapter raises `UnsupportedToolChoiceError`."
- **What spec requires**: An `UnsupportedToolChoiceError` error class and adapters that raise it for unsupported modes.
- **What code has**: No `UnsupportedToolChoiceError` class in `unified-llm/src/types/errors.ts`. The `supportsToolChoice(mode)` method exists on `ProviderAdapter` interface (`unified-llm/src/types/provider-adapter.ts:11`) but no adapter raises an error for unsupported modes -- they silently return `undefined` from `translateToolChoice` instead.
- **Severity**: Low

### [GAP-GEN-008] Gemini none mode sends both NONE config and omits tools
- **Spec reference**: SS5.3 -- Gemini none mode should send `"NONE"`
- **What spec requires**: Gemini none mode maps to `"NONE"` in `functionCallingConfig`.
- **What code has**: `unified-llm/src/providers/gemini/request-translator.ts:209-222` -- When mode is "none", the code omits tools from the request body (line 212: `!isNoneMode`) AND sets `toolConfig: { functionCallingConfig: { mode: "NONE" } }` (line 82 + 217-219). Sending `toolConfig` with `NONE` but without any `tools` array may cause Gemini API errors since there are no tools to apply the config to. The spec table only says to send `"NONE"` -- it does not say to omit tools. Omitting tools is the Anthropic behavior; Gemini should just send `NONE`.
- **Severity**: Medium

## Fully Covered

- **SS4.1 Client.complete()**: Correctly implemented in `unified-llm/src/client/client.ts:55-63`. Routes to resolved provider adapter, blocks until complete, returns Response, raises on error, does NOT retry.
- **SS4.2 Client.stream()**: Correctly implemented in `unified-llm/src/client/client.ts:65-74`. Returns async generator of StreamEvent, terminates naturally.
- **SS4.3 generate()**: Full implementation in `unified-llm/src/api/generate.ts:84-223`. Prompt standardization (prompt vs messages mutual exclusion), system message handling, tool execution loop, max_tool_rounds semantics, retry with exponential backoff, timeout support, abort signal passthrough.
- **SS4.3 GenerateResult**: All fields present in `unified-llm/src/api/types.ts:21-32`: text, reasoning, toolCalls, toolResults, finishReason, usage, totalUsage, steps, response, output.
- **SS4.3 StepResult**: All fields present in `unified-llm/src/api/types.ts:10-19`: text, reasoning, toolCalls, toolResults, finishReason, usage, response, warnings.
- **SS4.3 StopCondition**: Implemented as `(steps: StepResult[]) => boolean` in `unified-llm/src/api/types.ts:34`.
- **SS4.4 stream()**: Full implementation in `unified-llm/src/api/stream.ts:110-304`. Same parameters as generate, tool execution loop with step_finish events, retry on initial connection.
- **SS4.4 StreamResult**: Correctly defined in `unified-llm/src/api/types.ts:36-41` with `[Symbol.asyncIterator]`, `response()`, `partialResponse()`, `textStream()`.
- **SS4.4 StreamAccumulator**: Full implementation in `unified-llm/src/utils/stream-accumulator.ts:14-174`. Processes all event types, accumulates text/reasoning/tool calls, produces complete Response.
- **SS4.5 generate_object()**: Implemented in `unified-llm/src/api/generate-object.ts:20-69`. Strategy resolution (auto/tool/json_schema), tool extraction strategy for Anthropic, json_schema strategy for OpenAI/Gemini, schema validation, NoObjectGeneratedError.
- **SS4.6 stream_object()**: Partial object streaming implemented in `unified-llm/src/api/stream-object.ts:37-86` using `partialJsonParse`. Both tool and json_schema strategies.
- **SS4.7 Abort signals**: Passed through via `abortSignal` on Request and GenerateOptions. `AbortError` in errors.ts.
- **SS4.7 TimeoutConfig**: Implemented in `unified-llm/src/types/timeout.ts` with `total` and `perStep`. `AdapterTimeout` with `connect`, `request`, `streamRead`.
- **SS4.7 Total timeout**: Enforced in generate() loop at `unified-llm/src/api/generate.ts:113-121` and stream() loop at `unified-llm/src/api/stream.ts:139-145`.
- **SS5.1 Tool definition**: `ToolDefinition` in `unified-llm/src/types/tool.ts:1-6` with name, description, parameters, optional execute.
- **SS5.2 Execute handlers**: Sync/async support via `Promise<unknown> | unknown` return type. Error handling catches exceptions and sends `isError: true` results.
- **SS5.3 ToolChoice**: Discriminated union in `unified-llm/src/types/tool.ts:21-25` with auto/none/required/named modes. Provider translations correct for Anthropic (auto -> `{type:"auto"}`, required -> `{type:"any"}`, named -> `{type:"tool",name:"..."}`), Gemini (auto -> AUTO, none -> NONE, required -> ANY, named -> ANY with allowedFunctionNames).
- **SS5.3 Anthropic none mode**: Correctly omits tools from request body when mode is "none" at `unified-llm/src/providers/anthropic/request-translator.ts:218-231`.
- **SS5.4 ToolCall and ToolResult**: Both defined in `unified-llm/src/types/tool.ts:8-19` matching spec fields including rawArguments.
- **SS5.5 Active vs passive tools**: Active tools (with execute) auto-execute in generate/stream loops. Passive tools (no execute) return tool calls to caller. Handled at `unified-llm/src/api/generate.ts:155-161`.
- **SS5.6 Multi-step tool loop**: Correctly implements the loop in `unified-llm/src/api/generate.ts:112-205`. Conversation building with assistant message + tool result messages. Stop condition checking.
- **SS5.7 Parallel tool execution**: All tool calls launched concurrently via `Promise.all` at `unified-llm/src/api/generate.ts:154-183`. Results preserve order. Partial failures handled gracefully (individual try/catch per tool).
- **SS5.8 Unknown tool handling**: When model calls unknown tool, error result sent (not exception raised) at `unified-llm/src/api/generate.ts:157-161`.
- **SS5.9 Streaming with tools**: step_finish events emitted between tool rounds at `unified-llm/src/api/stream.ts:240-244`.
- **SS5.10 Tool result handling**: Tool results appended as `toolResultMessage` in conversation at `unified-llm/src/api/generate.ts:194-197`. Provider-specific translation handled by each adapter's request translator.
