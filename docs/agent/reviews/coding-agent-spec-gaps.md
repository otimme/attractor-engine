# Coding Agent Spec Gap Analysis

Comparison of `coding-agent/src/` against `coding-agent-loop-spec.md`. Organized by severity.

---

## HIGH -- Missing or Wrong Functionality

### 1. `maxToolRoundsPerInput` default is 50, spec says 200
- **Spec (2.2):** `max_tool_rounds_per_input: Integer = 200`
- **Code (`types/session.ts:33`):** `maxToolRoundsPerInput: 50`
- **Impact:** Agent stops 4x sooner than spec intends

### 2. `defaultCommandTimeoutMs` default is 120s, spec says 10s
- **Spec (2.2):** `default_command_timeout_ms: Integer = 10000` (10 seconds)
- **Code (`types/session.ts:34`):** `defaultCommandTimeoutMs: 120_000` (120 seconds)
- **Note:** The Anthropic profile correctly overrides to 120s per Claude Code convention (spec 3.5), but the *session-level default* should be 10s. Other profiles (OpenAI, Gemini) rely on the session default and currently inherit 120s instead of 10s.

### 3. `loopDetectionWindow` default is 5, spec says 10
- **Spec (2.2):** `loop_detection_window: Integer = 10`
- **Code (`types/session.ts:40`):** `loopDetectionWindow: 5`
- **Impact:** Loop detection triggers at half the intended window

### 4. `Session.subagents` field missing
- **Spec (2.1):** `subagents: Map<String, SubAgent>` is a field on Session
- **Code (`session/session.ts`):** No `subagents` map on Session. Subagent state is managed inside the profile's tool closures (subagent-tools.ts) via a local `Map<string, SubAgentHandle>`.
- **Impact:** The Session cannot enumerate or manage active subagents directly (e.g., for graceful shutdown)

### 5. No argument validation against JSON Schema (tool execution pipeline step 2)
- **Spec (3.8):** Tool execution pipeline: LOOKUP -> **VALIDATE** (parse and validate arguments against JSON Schema) -> EXECUTE -> TRUNCATE -> EMIT -> RETURN
- **Code (`session.ts:325-328`):** Arguments are only JSON-parsed if they're a string. No schema validation.
- **Impact:** Malformed tool arguments are not caught before execution; errors surface only at runtime inside the executor

### 6. `ASSISTANT_TEXT_START` and `ASSISTANT_TEXT_DELTA` events never emitted
- **Spec (2.9):** `ASSISTANT_TEXT_START` -- model began generating text. `ASSISTANT_TEXT_DELTA` -- incremental text token.
- **Code (`session.ts`):** Only `ASSISTANT_TEXT_END` is emitted after `Client.complete()` returns. No streaming events.
- **Impact:** Host applications cannot render incremental text output. The event types are defined but unused.

### 7. `TOOL_CALL_OUTPUT_DELTA` event never emitted
- **Spec (2.9):** `TOOL_CALL_OUTPUT_DELTA` -- incremental tool output (for streaming tools)
- **Code:** Event kind is defined in `types/events.ts` but never emitted
- **Impact:** No streaming tool output support

### 8. OpenAI profile `providerOptions()` returns null, spec says set `reasoning.effort`
- **Spec (3.4):** "The OpenAI profile should set `reasoning.effort` on the Responses API request when `reasoning_effort` is configured."
- **Code (`openai-profile.ts:77-79`):** `providerOptions(): ... { return null; }`
- **Impact:** Reasoning effort configuration is not passed through provider-specific options for OpenAI

### 9. Anthropic profile `providerOptions()` returns null, spec says pass beta headers
- **Spec (3.5):** "The Anthropic profile should pass beta headers (e.g., for extended thinking, 1M context) via `provider_options.anthropic.beta_headers`."
- **Code (`anthropic-profile.ts:77-79`):** `providerOptions(): ... { return null; }`
- **Impact:** Extended thinking and 1M context beta features are not configured

### 10. Gemini profile missing `read_many_files`, `list_dir`, `web_search`, `web_fetch` tools
- **Spec (3.6):** Gemini profile should include: `read_many_files` (batch reading), `list_dir` (directory listing with depth), `web_search` (optional), `web_fetch` (optional)
- **Code (`gemini-profile.ts`):** Only has standard shared core tools (same as Anthropic)
- **Impact:** Gemini profile is not gemini-cli-aligned as spec requires

### 11. `edit_file` missing fuzzy matching fallback
- **Spec (3.3 edit_file):** "If `old_string` is not found exactly, the implementation may attempt fuzzy matching (whitespace normalization, Unicode equivalence)"
- **Code (`core-tools.ts:100`):** Only does exact `rawContent.includes(oldString)` -- throws immediately on mismatch
- **Impact:** Edits fail when there are trivial whitespace differences

### 12. `apply_patch` hunk matching has no fuzzy matching fallback
- **Spec (Appendix A):** "When exact matching fails, the implementation should attempt fuzzy matching (whitespace normalization, Unicode punctuation equivalence) before reporting an error."
- **Code (`apply-patch.ts:139-146`):** Only exact line-by-line comparison
- **Impact:** Patches fail on whitespace mismatches

### 13. Graceful shutdown does not clean up subagents
- **Spec (Appendix B, shutdown sequence step 7):** "Clean up subagents (close_agent on all active subagents)"
- **Code (`session.ts:84-89`):** `close()` only aborts, emits SESSION_END, and closes emitter. No subagent cleanup.
- **Impact:** Subagents may be left running after parent session closes

### 14. No `Client.stream()` usage -- streaming not implemented
- **Spec (1.3, 2.5):** The agent should support both `Client.complete()` and `Client.stream()`. Streaming events (`ASSISTANT_TEXT_START`, `ASSISTANT_TEXT_DELTA`, `TOOL_CALL_OUTPUT_DELTA`) require streaming.
- **Code:** Only `Client.complete()` is used. No streaming path.
- **Impact:** All responses are buffered; no real-time text output

---

## MEDIUM -- Incomplete Implementation

### 15. `SESSION_END` emitted on both normal completion AND close, but semantics differ
- **Spec (2.9):** SESSION_END should bracket the session (once, at the end). On abort/error -> CLOSED.
- **Code (`session.ts:267,283`):** `SESSION_END` is emitted in both the error/abort path AND the normal completion path. On normal completion, state goes to IDLE (not CLOSED) but SESSION_END is still emitted.
- **Impact:** SESSION_END fires after every `submit()`, not just when the session lifecycle ends. Confusing for consumers.

### 16. Anthropic profile `contextWindowSize` hardcoded to 200,000
- **Spec (3.5):** Claude models support up to 1M context (with beta headers)
- **Code (`anthropic-profile.ts:84`):** `contextWindowSize: 200_000`
- **Impact:** Context window awareness warnings trigger too early for models using extended context

### 17. Context usage warning emits as `ERROR` event, not a dedicated warning
- **Spec (5.5):** "Emit a warning event when usage exceeds 80%"
- **Code (`session.ts:412`):** `this.emit(EventKind.ERROR, { type: "context_warning", ... })`
- **Impact:** Context warnings are indistinguishable from actual errors unless consumers check `data.type`

### 18. Environment context block missing `Is git repository` field name format
- **Spec (6.3):** `Is git repository: {true/false}` (exact field name)
- **Code (`system-prompt.ts:19`):** `Git repository: ${options.isGitRepo ? "yes" : "no"}` -- uses "Git repository" and "yes/no" instead of "Is git repository" and "true/false"
- **Impact:** Minor format mismatch with spec template

### 19. Git context does not include recent commits or short status
- **Spec (6.4):** "Short status (modified/untracked file count, not full diff)" and "Recent commit messages (last 5-10)"
- **Code (`session.ts:421-446`):** `gatherGitContext()` only collects `isGitRepo`, `branch`, and `gitRoot`
- **Impact:** Model lacks initial orientation about repo state

### 20. No env var policy configuration (inherit all/none/core)
- **Spec (4.2):** "Customizable via an env var policy: inherit all, inherit none (start clean), or inherit core only"
- **Code (`env-filter.ts`):** Hardcoded filter logic, no policy parameter
- **Impact:** Cannot configure different filtering strategies per use case

### 21. `grep` uses `--max-count` instead of result limiting
- **Spec (3.3 grep):** `max_results` limits total results
- **Code (`local-env.ts:186`):** `--max-count` limits matches *per file*, not total results
- **Impact:** May return more results than intended for multi-file searches

### 22. Loop detection warning message doesn't match spec
- **Spec (2.10):** Warning: "Loop detected: the last {N} tool calls follow a repeating pattern. Try a different approach."
- **Code (`session.ts:253-254`):** "Loop detected: You appear to be repeating the same tool calls. Please try a different approach or explain what you are trying to accomplish."
- **Impact:** Cosmetic, but message doesn't include the window size count

### 23. `send_input` and `close_agent` throw errors instead of returning error results
- **Spec (Appendix B):** Tool errors should be caught and returned as error results (`is_error = true`) so the model can recover
- **Code (`subagent-tools.ts:91,148`):** `throw new Error(...)` for unknown agent IDs
- **Impact:** These throws ARE caught by `executeSingleTool`'s catch block, so behavior is correct, but the error path is indirect

### 24. Anthropic profile `supportsParallelToolCalls` is `true`
- **Code (`anthropic-profile.ts:83`):** `supportsParallelToolCalls: true`
- **Note:** Claude models support parallel tool calls, but Claude Code typically uses sequential execution. The spec doesn't explicitly say this should be false, but it's worth verifying against Claude Code's actual behavior.

---

## LOW -- Minor Deviations

### 25. `ToolCallInterceptor` (pre/post hooks) not in spec
- **Code (`types/session.ts:12-15, session.ts:332-350`):** `toolCallInterceptor` with `pre` and `post` hooks
- **Spec:** No mention of tool call interceptors
- **Impact:** Extra feature beyond spec. This is actually a useful extension point (natural hook for the "Approval / Permission System" mentioned in Section 8), but it's not spec'd.

### 26. `read_file` offset is 1-based in code but spec says "1-based line number"
- **Code (`local-env.ts:40`):** `const startLine = offset !== undefined ? offset - 1 : 0;` -- correctly converts 1-based to 0-based
- **Spec:** Matches. No gap here, just confirming.

### 27. `write_file` returns bytes count, spec says "bytes written"
- **Code (`core-tools.ts:66`):** `return "Wrote ${content.length} bytes to ${filePath}"` -- `content.length` is character count, not byte count for multi-byte strings
- **Impact:** Minor inaccuracy for non-ASCII content

### 28. `delete_file` in `apply_patch` uses shell `rm` instead of a filesystem API
- **Code (`apply-patch.ts:199`):** `await env.execCommand("rm ${op.path}", 5000)`
- **Impact:** Not portable (Windows), path injection risk if path contains special chars

### 29. `stripLineNumbers` is duplicated
- **Code:** Defined in both `core-tools.ts:8-16` and `apply-patch.ts:112-120`
- **Impact:** Code duplication; should be extracted to a shared utility

### 30. OpenAI profile base prompt doesn't mention `.codex/instructions.md`
- **Spec (6.5, 3.4):** OpenAI profile loads `.codex/instructions.md`. The system prompt should reference this.
- **Code (`openai-base.ts`):** Only mentions AGENTS.md, not `.codex/instructions.md`
- **Impact:** Model may not know to look for project-specific OpenAI instructions

### 31. Gemini profile base prompt says "GEMINI.md" correctly
- **Code (`gemini-base.ts:24`):** "Check for a GEMINI.md file"
- **Spec:** Matches

### 32. Base prompts are generic, not 1:1 copies of provider reference agents
- **Spec (3.1):** "The initial base for each provider should be a 1:1 copy of the provider's reference agent -- the exact same system prompt, the exact same tool definitions, byte for byte."
- **Code:** All three base prompts are short, generic summaries (~30 lines each). Not derived from codex-rs, Claude Code, or gemini-cli.
- **Impact:** Models may underperform compared to their native agents

### 33. `Gemini` profile `supportsReasoning` is `false`
- **Code (`gemini-profile.ts:81`):** `supportsReasoning: false`
- **Spec (2.7):** "For Gemini models with thinking, this maps to thinkingConfig"
- **Impact:** Gemini 2.5 Pro/Flash support thinking mode. This should be configurable per model.

---

## Summary Counts

| Severity | Count |
|----------|-------|
| HIGH     | 14    |
| MEDIUM   | 10    |
| LOW      | 9     |
| **Total**| **33**|

## Top 5 Priorities

1. **Streaming support** (#6, #7, #14) -- Blocks real-time UI rendering
2. **Config defaults** (#1, #2, #3) -- Easy fixes with outsized impact
3. **Provider options** (#8, #9) -- Required for reasoning effort and extended thinking
4. **Gemini-specific tools** (#10) -- Profile is not differentiated
5. **Argument validation** (#5) -- Missing spec pipeline step
