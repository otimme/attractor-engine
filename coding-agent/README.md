# coding-agent

An agentic coding loop library that turns any LLM into a code-editing agent. Provide a provider profile and an execution environment, and the library handles the tool loop, history, steering, loop detection, and subagent orchestration.

Built on top of `unified-llm` for provider-agnostic LLM access.

## Setup

```bash
bun install
```

Set an API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-..."
```

## Quick Start

```typescript
import { Client } from "unified-llm";
import {
  Session,
  createAnthropicProfile,
  LocalExecutionEnvironment,
  EventKind,
} from "coding-agent";

const session = new Session({
  providerProfile: createAnthropicProfile("claude-sonnet-4-5"),
  executionEnv: new LocalExecutionEnvironment({ workingDir: process.cwd() }),
  llmClient: Client.fromEnv(),
});

// Subscribe to events
const events = session.events();

// Submit a task
await session.submit("Add a health-check endpoint to src/server.ts");

// Consume events
for await (const event of events) {
  if (event.kind === EventKind.ASSISTANT_TEXT_END) {
    console.log(event.data.text);
  }
  if (event.kind === EventKind.SESSION_END) break;
}

await session.close();
```

## Session

`Session` is the core class. It manages the agentic tool loop: submit user input, call the LLM, execute tools, repeat until the model stops calling tools or a limit is hit.

### Creating a session

```typescript
import { Session } from "coding-agent";

const session = new Session({
  providerProfile,   // which model + tools to use
  executionEnv,      // filesystem / shell access
  llmClient,         // unified-llm Client
  config: {          // optional overrides
    maxTurns: 100,
    maxToolRoundsPerInput: 25,
    reasoningEffort: "high",
  },
});
```

### Submitting input

```typescript
await session.submit("Fix the failing test in tests/auth.test.ts");
```

`submit()` runs the full agentic loop: LLM call, tool execution, repeat. It resolves when the model finishes (no more tool calls) or a limit is reached.

### Steering

Inject guidance into the conversation while the agent is working:

```typescript
session.steer("Focus on the database layer, not the API routes.");
```

Steering messages are drained into the history before each LLM call.

### Follow-ups

Queue the next user input to run automatically after the current one completes:

```typescript
session.followUp("Now run the tests to verify the fix.");
```

### Closing

```typescript
await session.close();
```

Aborts any in-progress processing and cleans up event streams.

## Events

Subscribe to real-time session events via an async generator:

```typescript
import { EventKind } from "coding-agent";

const events = session.events();

for await (const event of events) {
  switch (event.kind) {
    case EventKind.USER_INPUT:
      console.log("User:", event.data.content);
      break;
    case EventKind.ASSISTANT_TEXT_END:
      console.log("Assistant:", event.data.text);
      break;
    case EventKind.TOOL_CALL_START:
      console.log(`Calling ${event.data.tool_name}...`);
      break;
    case EventKind.TOOL_CALL_END:
      console.log(`Tool done:`, event.data.output ?? event.data.error);
      break;
    case EventKind.LOOP_DETECTION:
      console.warn("Loop detected, steering injected");
      break;
    case EventKind.TURN_LIMIT:
      console.warn("Limit reached:", event.data.reason);
      break;
    case EventKind.ERROR:
      console.error(event.data.error);
      break;
    case EventKind.SESSION_END:
      break;
  }
}
```

All event kinds: `SESSION_START`, `SESSION_END`, `USER_INPUT`, `ASSISTANT_TEXT_START`, `ASSISTANT_TEXT_DELTA`, `ASSISTANT_TEXT_END`, `TOOL_CALL_START`, `TOOL_CALL_OUTPUT_DELTA`, `TOOL_CALL_END`, `STEERING_INJECTED`, `TURN_LIMIT`, `LOOP_DETECTION`, `ERROR`.

## Provider Profiles

A provider profile bundles a model, its tool registry, system prompt builder, and capability flags. Two built-in profiles are provided:

### Anthropic

```typescript
import { createAnthropicProfile } from "coding-agent";

const profile = createAnthropicProfile("claude-opus-4-6");
```

Tools: `read_file`, `write_file`, `edit_file`, `shell`, `grep`, `glob`
Project docs: reads `AGENTS.md`, `CLAUDE.md`

### OpenAI

```typescript
import { createOpenAIProfile } from "coding-agent";

const profile = createOpenAIProfile("gpt-5.2");
```

Tools: `read_file`, `write_file`, `apply_patch`, `shell`, `grep`, `glob`
Project docs: reads `AGENTS.md`, `.codex/instructions.md`

The key difference: Anthropic uses `edit_file` (find-and-replace) while OpenAI uses `apply_patch` (unified diff format).

### Custom profiles

Implement the `ProviderProfile` interface to create your own:

```typescript
import type { ProviderProfile } from "coding-agent";
import { ToolRegistry, createReadFileTool, createShellTool } from "coding-agent";

const registry = new ToolRegistry();
registry.register(createReadFileTool());
registry.register(createShellTool({ defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000 }));

const profile: ProviderProfile = {
  id: "custom",
  model: "my-model",
  toolRegistry: registry,
  buildSystemPrompt: (env, docs) => `You are a coding assistant.\n${docs}`,
  tools: () => registry.definitions(),
  providerOptions: () => null,
  supportsReasoning: false,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
  contextWindowSize: 128_000,
};
```

## Execution Environment

The `ExecutionEnvironment` interface abstracts filesystem and shell access. The built-in `LocalExecutionEnvironment` wraps Bun APIs for local use:

```typescript
import { LocalExecutionEnvironment } from "coding-agent";

const env = new LocalExecutionEnvironment({ workingDir: "/path/to/project" });
```

It provides:
- `readFile` / `writeFile` / `fileExists` — file operations
- `execCommand` — shell execution with timeout and SIGTERM/SIGKILL handling
- `grep` — pattern search via ripgrep
- `glob` — file matching via `Bun.Glob`
- `listDirectory` — directory listing with depth control

Implement `ExecutionEnvironment` for remote or sandboxed environments (Docker, SSH, etc.).

## Tool Registry

Register and manage tools available to the agent:

```typescript
import { ToolRegistry, createReadFileTool, createGrepTool } from "coding-agent";

const registry = new ToolRegistry();
registry.register(createReadFileTool());
registry.register(createGrepTool());

registry.names();        // ["read_file", "grep"]
registry.definitions();  // ToolDefinition[] for the LLM
registry.get("grep");    // RegisteredTool | undefined
registry.unregister("grep");
```

### Built-in tools

| Tool | Description |
|------|-------------|
| `createReadFileTool()` | Read file content with line numbers, offset/limit support |
| `createWriteFileTool()` | Write file content, creates parent directories |
| `createEditFileTool()` | Find-and-replace editing (Anthropic profile) |
| `createApplyPatchTool()` | Apply unified diff patches (OpenAI profile) |
| `createShellTool(opts)` | Execute shell commands with configurable timeouts |
| `createGrepTool()` | Regex search via ripgrep |
| `createGlobTool()` | File pattern matching |

## Tool Call Interceptor

Hook into tool execution for logging, approval gates, or auditing:

```typescript
const session = new Session({
  providerProfile,
  executionEnv,
  llmClient,
  config: {
    toolCallInterceptor: {
      pre: async (toolName, args) => {
        console.log(`About to call ${toolName}`, args);
        // return false to skip the tool call
        return true;
      },
      post: async (toolName, args, output) => {
        console.log(`${toolName} returned ${output.length} chars`);
      },
    },
  },
});
```

## Subagents

Spawn child sessions for parallel task execution:

```typescript
import {
  createSpawnAgentTool,
  createSendInputTool,
  createWaitTool,
  createCloseAgentTool,
} from "coding-agent";
import type { SessionFactory } from "coding-agent";

const agents = new Map();

const factory: SessionFactory = async ({ task, workingDir, model, maxTurns }) => {
  // Create and return a SubAgentHandle
  // (your implementation — typically creates a new Session)
};

const registry = new ToolRegistry();
registry.register(createSpawnAgentTool(factory, agents));
registry.register(createSendInputTool(agents));
registry.register(createWaitTool(agents));
registry.register(createCloseAgentTool(agents));
```

The agent can then spawn subagents, send them messages, wait for results, and close them — all through tool calls.

## Configuration

All options with their defaults:

```typescript
const config: SessionConfig = {
  maxTurns: 200,                    // max user+assistant turns per session
  maxToolRoundsPerInput: 50,        // max tool rounds per submit()
  defaultCommandTimeoutMs: 120_000, // 2 min shell timeout
  maxCommandTimeoutMs: 600_000,     // 10 min max shell timeout
  reasoningEffort: null,            // "low" | "medium" | "high" | null
  toolOutputLimits: {
    maxChars: 30_000,
    maxLines: 500,
  },
  enableLoopDetection: true,        // detect repeating tool call patterns
  loopDetectionWindow: 5,           // number of recent calls to check
  maxSubagentDepth: 3,              // max nested subagent levels
};
```

## Conversation History

The session maintains a typed history of turns:

```typescript
import { countTurns, convertHistoryToMessages } from "coding-agent";

// Count user + assistant turns only
const turns = countTurns(session.history);

// Convert to unified-llm messages for external use
const messages = convertHistoryToMessages(session.history);
```

Turn types: `user`, `assistant`, `tool_results`, `system`, `steering`.

## Architecture

```
Session                 Agentic loop, history, steering, events
  ├── ProviderProfile   Model config, tool registry, system prompt
  ├── ExecutionEnvironment  Filesystem / shell abstraction
  ├── EventEmitter      Async event streaming to consumers
  └── unified-llm       LLM client (Anthropic, OpenAI)
```

## Testing

```bash
bun test
```
