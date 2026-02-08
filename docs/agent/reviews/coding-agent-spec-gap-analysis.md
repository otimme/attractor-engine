# Coding Agent: Spec Gap Analysis

**Date:** 2026-02-08 (v2 -- 8-agent parallel swarm)
**Spec:** `coding-agent-loop-spec.md`
**Code:** `coding-agent/`
**Method:** 8-agent parallel swarm covering all spec sections individually

---

## Progress Since v1 (Feb 7)

These v1 high-severity gaps have been **fixed**:
- ~~Tool output limits config ignored~~ -- now passes `this.config.toolOutputLimits`/`toolLineLimits`
- ~~Environment context missing fields~~ -- `EnvironmentContextOptions` now has git, model, cutoff
- ~~No git context snapshot~~ -- `gatherGitContext()` captures branch and root (partial -- see #3)
- ~~Project doc discovery only checks cwd~~ -- `buildSearchDirs()` now walks gitRoot to cwd
- ~~No process group spawning~~ -- now uses `node:child_process spawn` with `detached: true`
- ~~Abort signal not passed to LLM~~ -- now passes `abortSignal` in the request

---

## Remaining High-Severity Gaps

### 1. No JSON Schema validation in tool execution pipeline
**Spec 3.8** | `session/session.ts:305-379`

Spec requires 6-step pipeline: LOOKUP -> **VALIDATE** -> EXECUTE -> TRUNCATE -> EMIT -> RETURN. The VALIDATE step (arguments against tool's parameter JSON Schema) is missing. Invalid args cause cryptic runtime errors instead of clean validation error results returned to the model.

### 2. Config defaults deviate from spec

| Spec Field | Spec Default | Code Default | Impact |
|---|---|---|---|
| `maxToolRoundsPerInput` | **200** | **50** | Agent stops 4x too early |
| `defaultCommandTimeoutMs` | **10,000** | **120,000** | Commands get 12x more time (note: Anthropic profile correctly overrides to 120s per spec 3.5, but the _base_ config default should be 10s) |
| `loopDetectionWindow` | **10** | **5** | Loop detection triggers earlier than intended |

### 3. Anthropic `providerOptions()` returns null
**Spec 3.5** | `profiles/anthropic-profile.ts:77-79`

Should return beta headers (e.g., extended thinking, 1M context) via `provider_options.anthropic.beta_headers`.

### 4. OpenAI `providerOptions()` returns null
**Spec 3.4** | `profiles/openai-profile.ts:77-79`

Should set `reasoning.effort` on the Responses API request when reasoning effort is configured.

---

## Remaining Medium-Severity Gaps

### 5. Streaming events never emitted
**Spec 2.9** | `session/session.ts`

`ASSISTANT_TEXT_START`, `ASSISTANT_TEXT_DELTA`, and `TOOL_CALL_OUTPUT_DELTA` are defined in `EventKind` but never emitted. Session only uses `Client.complete()`, not `Client.stream()`. This blocks real-time UI rendering -- hosts have no way to show incremental text.

### 6. `AWAITING_INPUT` state never used
**Spec 2.3** | `session/session.ts`

Defined in enum but no transition logic exists. Spec says `PROCESSING -> AWAITING_INPUT` when model asks a question (text-only, open-ended). Session always goes `PROCESSING -> IDLE`.

### 7. Git context missing short status and recent commits
**Spec 6.4** | `session/session.ts:421-446`

`gatherGitContext()` captures branch and root, but spec also requires:
- Short status (modified/untracked file counts)
- Recent commit messages (last 5-10)

These provide the model with initial orientation without running git commands.

### 8. Gemini profile missing provider-specific tools
**Spec 3.6** | `profiles/gemini-profile.ts`

Missing: `read_many_files`, `list_dir` (both part of gemini-cli core toolset). Also missing optional `web_search` and `web_fetch`. `providerOptions()` returns null -- should configure safety settings/grounding.

### 9. Subagent map not on Session
**Spec 2.1** | `session/session.ts`

Spec requires `subagents: Map<String, SubAgent>` on Session. The map lives in closures inside subagent tool factories. Session cannot enumerate or clean up active subagents during graceful shutdown (Appendix B).

### 10. read_file has no image support
**Spec 3.3** | `tools/core-tools.ts:38-44`

Spec: "For image files, return the image data for multimodal models." No image detection or handling.

### 11. apply_patch has no fuzzy matching
**Spec Appendix A** | `tools/apply-patch.ts:138-157`

Spec: "should attempt fuzzy matching (whitespace normalization, Unicode punctuation equivalence) before reporting an error." Throws immediately on exact match failure.

### 12. User instructions layer not wired through
**Spec 6.1** | `profiles/system-prompt.ts:102-114`

`buildSystemPrompt()` helper accepts `userInstructions` as a 5th parameter, but `ProviderProfile.buildSystemPrompt()` interface signature doesn't accept it, so no profile passes it through. Layer 5 of the spec's system prompt stack is unreachable.

---

## Low-Severity Gaps

| # | Description | Spec | Location |
|---|---|---|---|
| 13 | System prompts are basic (~30 lines each) vs spec's "1:1 copy of reference agent" guidance | 3.1, 6.2 | `profiles/prompts/*.ts` |
| 14 | No `*** End of File` marker support in apply_patch parser | App A | `tools/apply-patch.ts` |
| 15 | apply_patch delete/rename uses unsanitized `rm ${path}` via shell (injection risk) | 3.3 | `tools/apply-patch.ts:199,210` |
| 16 | No customizable env var policy (inherit all/none/core only) | 4.2 | `env/env-filter.ts` |
| 17 | write_file reports `content.length` (chars) not bytes written | 3.3 | `tools/core-tools.ts:66` |
| 18 | Context warning uses ERROR event kind instead of a dedicated WARNING kind | 5.5 | `session/session.ts:412` |

---

## What's Working Well

- **Core agentic loop** -- follows spec pseudocode closely (drain steering, limit checks, abort check, LLM call, tool exec, loop detection, followup queue)
- **All 5 turn types** with correct fields, timestamps, and conversion to LLM messages
- **Truncation pipeline** -- correct algorithm, all default limits match spec table, char-first-then-line ordering, proper warning markers
- **Event system** -- all 13 EventKinds defined, async generator delivery with multi-consumer support, TOOL_CALL_END carries full untruncated output
- **Loop detection** -- signature tracking (name + serialized args), patterns of length 1/2/3, warning injected as SteeringTurn
- **Steering** -- `steer()`, `followUp()`, drain before first call and after each tool round, SteeringTurn -> user message conversion
- **LocalExecutionEnvironment** -- process groups (`detached: true`), SIGTERM + 2s + SIGKILL, env var filtering (API_KEY, SECRET, TOKEN, PASSWORD, CREDENTIAL), ripgrep for grep, mtime-sorted glob
- **ToolRegistry** -- register/unregister/get/definitions/names with latest-wins collision resolution
- **All 6 core tools** + apply_patch (v4a parser/applier) + 4 subagent tools
- **ProviderProfile interface** -- all fields and methods present including capability flags
- **ExecutionEnvironment interface** -- all methods present (readFile, writeFile, fileExists, listDirectory, execCommand, grep, glob, initialize, cleanup, workingDirectory, platform, osVersion)
- **ExecResult/DirEntry/GrepOptions** records complete
- **Project document discovery** -- walks gitRoot to cwd, 32KB budget, provider-specific filtering, AGENTS.md always loaded
- **Environment context** -- structured `<environment>` block with git/model/date info
- **Parallel tool execution** -- respects `supportsParallelToolCalls` flag
- **Reasoning effort** -- passed to LLM SDK, changeable mid-session
- **Custom tool registration** -- on top of any profile, latest-wins
- **Correct provider tool selections** -- OpenAI has apply_patch (no edit_file), Anthropic has edit_file (no apply_patch), correct shell timeouts per provider

---

## Recommended Fix Priority

1. **Config defaults** (#2) -- quick fix, high impact on agent behavior
2. **JSON Schema validation** (#1) -- defense against malformed tool calls
3. **Provider options** (#3, #4) -- enables extended thinking, reasoning effort for OpenAI
4. **Streaming support** (#5) -- required for real-time UI
5. **Git context completion** (#7) -- quick win, adds short status + recent commits
6. **Gemini tools** (#8) -- `list_dir` and `read_many_files` for parity
7. **Subagent map on Session** (#9) -- enables graceful shutdown cleanup
8. **User instructions layer** (#12) -- add param to ProviderProfile.buildSystemPrompt
9. **Image support** (#10) -- multimodal capability
10. **Fuzzy matching** (#11) -- apply_patch and edit_file resilience
