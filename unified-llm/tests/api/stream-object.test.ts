import { describe, test, expect } from "bun:test";
import { streamObject } from "../../src/api/stream-object.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { NoObjectGeneratedError } from "../../src/types/errors.js";

describe("streamObject", () => {
  function makeClient(adapter: StubAdapter): Client {
    return new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("throws NoObjectGeneratedError when streamed JSON schema object fails validation", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      { type: StreamEventType.TEXT_START },
      { type: StreamEventType.TEXT_DELTA, delta: '{"name": 123}' },
      { type: StreamEventType.TEXT_END },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }], { supportsNativeJsonSchema: true });
    const client = makeClient(adapter);

    await expect(async () => {
      const collected: unknown[] = [];
      for await (const obj of streamObject({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        client,
      })) {
        collected.push(obj);
      }
    }).toThrow(NoObjectGeneratedError);
  });

  test("throws NoObjectGeneratedError when streamed tool object fails validation", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "extract",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: '{"name": 123}',
      },
      { type: StreamEventType.TOOL_CALL_END, toolCallId: "tc-1" },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    await expect(async () => {
      const collected: unknown[] = [];
      for await (const obj of streamObject({
        model: "test-model",
        prompt: "Extract",
        schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        strategy: "tool",
        client,
      })) {
        collected.push(obj);
      }
    }).toThrow(NoObjectGeneratedError);
  });
});
