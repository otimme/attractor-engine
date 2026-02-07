import { describe, test, expect } from "bun:test";
import { Role } from "unified-llm";
import type { Turn } from "../../src/types/index.js";
import { convertHistoryToMessages, countTurns } from "../../src/session/history.js";

describe("convertHistoryToMessages", () => {
  test("UserTurn produces user message", () => {
    const history: Turn[] = [
      { kind: "user", content: "hello", timestamp: new Date() },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(Role.USER);
    expect(messages[0]?.content).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("AssistantTurn with text only produces assistant message with text part", () => {
    const history: Turn[] = [
      {
        kind: "assistant",
        content: "response text",
        toolCalls: [],
        reasoning: null,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        responseId: "r1",
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(Role.ASSISTANT);
    expect(messages[0]?.content).toEqual([
      { kind: "text", text: "response text" },
    ]);
  });

  test("AssistantTurn with tool calls produces tool_call parts", () => {
    const history: Turn[] = [
      {
        kind: "assistant",
        content: "",
        toolCalls: [
          { id: "tc1", name: "read_file", arguments: { path: "/foo" } },
        ],
        reasoning: null,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        responseId: "r1",
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toEqual([
      {
        kind: "tool_call",
        toolCall: { id: "tc1", name: "read_file", arguments: { path: "/foo" } },
      },
    ]);
  });

  test("AssistantTurn with reasoning produces thinking part", () => {
    const history: Turn[] = [
      {
        kind: "assistant",
        content: "answer",
        toolCalls: [],
        reasoning: "let me think...",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        responseId: "r1",
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toEqual([
      { kind: "thinking", thinking: { text: "let me think...", redacted: false } },
      { kind: "text", text: "answer" },
    ]);
  });

  test("ToolResultsTurn produces one tool result message per result", () => {
    const history: Turn[] = [
      {
        kind: "tool_results",
        results: [
          { toolCallId: "tc1", content: "file content", isError: false },
          { toolCallId: "tc2", content: "not found", isError: true },
        ],
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe(Role.TOOL);
    expect(messages[0]?.content).toEqual([
      {
        kind: "tool_result",
        toolResult: { toolCallId: "tc1", content: "file content", isError: false },
      },
    ]);
    expect(messages[1]?.role).toBe(Role.TOOL);
    expect(messages[1]?.content).toEqual([
      {
        kind: "tool_result",
        toolResult: { toolCallId: "tc2", content: "not found", isError: true },
      },
    ]);
  });

  test("SteeringTurn produces user message", () => {
    const history: Turn[] = [
      { kind: "steering", content: "try a different approach", timestamp: new Date() },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(Role.USER);
    expect(messages[0]?.content).toEqual([
      { kind: "text", text: "try a different approach" },
    ]);
  });

  test("SystemTurn produces user message to avoid multiple system messages", () => {
    const history: Turn[] = [
      { kind: "system", content: "system info", timestamp: new Date() },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(Role.USER);
    expect(messages[0]?.content).toEqual([
      { kind: "text", text: "system info" },
    ]);
  });

  test("full conversation: mixed turns produce correct message sequence", () => {
    const history: Turn[] = [
      { kind: "user", content: "read foo.ts", timestamp: new Date() },
      {
        kind: "assistant",
        content: "",
        toolCalls: [
          { id: "tc1", name: "read_file", arguments: { path: "foo.ts" } },
        ],
        reasoning: null,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        responseId: "r1",
        timestamp: new Date(),
      },
      {
        kind: "tool_results",
        results: [
          { toolCallId: "tc1", content: "export const x = 1;", isError: false },
        ],
        timestamp: new Date(),
      },
      { kind: "steering", content: "be concise", timestamp: new Date() },
      {
        kind: "assistant",
        content: "The file exports x = 1.",
        toolCalls: [],
        reasoning: null,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        responseId: "r2",
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(5);
    expect(messages[0]?.role).toBe(Role.USER);
    expect(messages[1]?.role).toBe(Role.ASSISTANT);
    expect(messages[2]?.role).toBe(Role.TOOL);
    expect(messages[3]?.role).toBe(Role.USER); // steering
    expect(messages[4]?.role).toBe(Role.ASSISTANT);
  });

  test("ToolResultsTurn with non-string content serializes to JSON", () => {
    const history: Turn[] = [
      {
        kind: "tool_results",
        results: [
          { toolCallId: "tc1", content: { key: "value" }, isError: false },
        ],
        timestamp: new Date(),
      },
    ];
    const messages = convertHistoryToMessages(history);
    expect(messages).toHaveLength(1);
    const toolResult = messages[0]?.content[0];
    expect(toolResult?.kind).toBe("tool_result");
    if (toolResult?.kind === "tool_result") {
      expect(toolResult.toolResult.content).toBe('{"key":"value"}');
    }
  });
});

describe("countTurns", () => {
  test("counts only user and assistant turns", () => {
    const history: Turn[] = [
      { kind: "user", content: "hi", timestamp: new Date() },
      {
        kind: "assistant",
        content: "hello",
        toolCalls: [],
        reasoning: null,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        responseId: null,
        timestamp: new Date(),
      },
      {
        kind: "tool_results",
        results: [],
        timestamp: new Date(),
      },
      { kind: "system", content: "sys", timestamp: new Date() },
      { kind: "steering", content: "steer", timestamp: new Date() },
    ];
    expect(countTurns(history)).toBe(2);
  });

  test("returns 0 for empty history", () => {
    expect(countTurns([])).toBe(0);
  });
});
