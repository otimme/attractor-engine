# Spec Gap Analysis: Architecture (S2)

## Summary

Sections 2.1-2.10 of the spec are **mostly well-implemented**. The four-layer architecture, client configuration, provider adapter interface, middleware, module-level default client, concurrency model, native API usage, and model catalog are all present and functional. **3 gaps found**, all Medium severity -- no High-severity gaps remain.

## Gaps Found

### [GAP-ARCH-001] `Client.from_env()` throws on zero providers instead of being optional
- **Spec reference**: S2.2 - Environment-Based Setup
- **What spec requires**: "Only providers whose keys are present in the environment are registered. The first registered provider becomes the default." The spec does not state that the client should throw if no providers are found -- it only says providers without keys are not registered.
- **What code has**: `Client.fromEnvSync()` at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/client.ts:153-157` throws `ConfigurationError` if `client.providers.size === 0`. This is a defensible design choice but differs from the spec's wording which implies a client with zero providers is valid (errors only when a request is made without a provider).
- **Severity**: Low

### [GAP-ARCH-002] Gemini adapter does not pass through `provider_options.gemini` for safety settings and cached content
- **Spec reference**: S2.8 - Provider Beta Headers and Feature Flags
- **What spec requires**: "Gemini supports safety settings, grounding configuration, and cached content references as part of the request body. These should be passable through `provider_options`."
- **What code has**: The Gemini request translator at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/gemini/request-translator.ts:224-237` does pass through unknown keys from `providerOptions.gemini` into the request body, but only handles `thinkingConfig` explicitly. The passthrough mechanism covers safety settings and cached content generically, so this is **partially covered** -- the generic passthrough works, but there is no explicit handling for `safetySettings` or `cachedContent` with validation or documentation.
- **Severity**: Low

### [GAP-ARCH-003] Model catalog is not shipped as a separate data file
- **Spec reference**: S2.9 - Model Catalog
- **What spec requires**: "The catalog should be shipped as a data file (JSON or similar) that can be updated independently of the library code."
- **What code has**: The catalog is a TypeScript array at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/models/catalog.ts:3-95`. It is embedded in code, not a separate JSON data file. Updating the catalog requires modifying TypeScript source. The spec explicitly says JSON or similar for independent updates.
- **Severity**: Medium

## Fully Covered

### S2.1 Four-Layer Architecture
Correctly implemented. Types (L1) in `src/types/`, utilities (L2) in `src/utils/`, client (L3) in `src/client/`, high-level API (L4) in `src/api/`. Layer boundaries are clean. The module-level `src/index.ts` re-exports all layers.

### S2.2 Client Configuration - Environment-Based Setup
`Client.fromEnvSync()` and `Client.fromEnv()` at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/client.ts:103-166` correctly reads `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (with `GOOGLE_API_KEY` fallback), and optional variables `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `ANTHROPIC_BASE_URL`, `GEMINI_BASE_URL`. First registered provider becomes default via `registerProvider()` at line 76-81.

### S2.2 Client Configuration - Programmatic Setup
`Client` constructor at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/client.ts:29-39` accepts `providers` record and `defaultProvider`. Adapters accept `apiKey`, `baseUrl`, `defaultHeaders`, and `timeout` options.

### S2.2 Provider Resolution
`resolveProvider()` at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/client.ts:41-53` correctly routes by `provider` field, falls back to `defaultProvider`, and throws `ConfigurationError` when neither is available.

### S2.2 Model String Convention
Model identifiers are passed as native strings directly to the provider API (e.g., `request.model` used directly in the request body). No internal model namespace or mapping table.

### S2.3 Middleware / Interceptor Pattern
Fully implemented at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/middleware.ts`. Both `Middleware` (for `complete()`) and `StreamMiddleware` (for `stream()`) are supported. `buildMiddlewareChain()` and `buildStreamMiddlewareChain()` implement the standard onion pattern with correct execution order (first registered = first to execute for requests).

### S2.4 Provider Adapter Interface
`ProviderAdapter` at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/types/provider-adapter.ts` defines `name`, `complete()`, `stream()`, plus optional `close()`, `initialize()`, and `supportsToolChoice()`. All four adapters (Anthropic, OpenAI, Gemini, OpenAI-compatible) implement this interface correctly.

### S2.5 Module-Level Default Client
`getDefaultClient()` and `setDefaultClient()` at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/client/default-client.ts` implement lazy initialization from environment variables. High-level API functions (`generate()`, `stream()`, etc.) accept an optional `client` parameter and fall back to `getDefaultClient()`.

### S2.6 Concurrency Model
All provider calls (`complete()`, `stream()`) are async. The `Client` holds no mutable state between requests (provider map is set at construction). Multiple concurrent requests are safe.

### S2.7 Native API Usage
- **OpenAI**: Uses Responses API (`/v1/responses`) at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/openai/adapter.ts:162,183`. Request translator uses `input` array (not `messages`), `instructions` (not `system`), and `function_call`/`function_call_output` items -- all Responses API shapes.
- **Anthropic**: Uses Messages API (`/v1/messages`) at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/anthropic/adapter.ts:117,143`.
- **Gemini**: Uses native Gemini API (`/v1beta/models/*/generateContent`) at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/gemini/adapter.ts:109,132`.

### S2.8 Provider Beta Headers and Feature Flags
- **Anthropic beta headers**: Handled at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/anthropic/request-translator.ts:240-252`. Accepts `providerOptions.anthropic.betaHeaders` as string or array, joins into comma-separated `anthropic-beta` header. Cache header appended automatically.
- **OpenAI provider_options**: Generic passthrough at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/openai/request-translator.ts:292-297` merges all `providerOptions.openai` keys into request body.
- **Anthropic provider_options passthrough**: Generic passthrough at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/anthropic/request-translator.ts:255-262` for unknown keys.

### S2.9 Model Catalog
Catalog at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/models/catalog.ts` includes all spec-required models (claude-opus-4-6, claude-sonnet-4-5, gpt-5.2, gpt-5.2-mini, gpt-5.2-codex, gemini-3-pro-preview, gemini-3-flash-preview). `ModelInfo` type matches spec fields. Lookup functions `getModelInfo()`, `listModels()`, and `getLatestModel()` match spec signatures. Aliases are supported.

### S2.10 Prompt Caching
- **Anthropic**: Automatic `cache_control` injection at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/providers/anthropic/cache.ts`. Injects `cache_control: {type: "ephemeral"}` on last system block, last tool definition, and second-to-last message. Enabled by default, disabled via `providerOptions.anthropic.autoCache = false`. Beta header `prompt-caching-2024-07-31` added automatically at adapter.ts:175.
- **OpenAI**: No SDK action needed (Responses API handles caching server-side). `cache_read_tokens` mapped from `input_tokens_details.cached_tokens` at response-translator.ts:44-46.
- **Anthropic cache token reporting**: `cache_read_input_tokens` and `cache_creation_input_tokens` mapped to `cacheReadTokens`/`cacheWriteTokens` at response-translator.ts:84-85.
- **Gemini cache token reporting**: `cachedContentTokenCount` mapped to `cacheReadTokens` at gemini/response-translator.ts:89.
- **Usage type**: `cacheReadTokens` and `cacheWriteTokens` defined at `/Users/bhelmkamp/p/strongdm/attractor/unified-llm/src/types/response.ts:21-22`.
