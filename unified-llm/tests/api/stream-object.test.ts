import { describe, test, expect } from "bun:test";
import { streamObject } from "../../src/api/stream-object.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { NoObjectGeneratedError } from "../../src/types/errors.js";

function makeClient(adapter: StubAdapter): Client {
  return new Client({
    providers: { stub: adapter },
    defaultProvider: "stub",
  });
}

describe("streamObject validation errors", () => {
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      client,
    });

    await expect(async () => {
      const collected: unknown[] = [];
      for await (const obj of result.partialObjectStream) {
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      strategy: "tool",
      client,
    });

    await expect(async () => {
      const collected: unknown[] = [];
      for await (const obj of result.partialObjectStream) {
        collected.push(obj);
      }
    }).toThrow(NoObjectGeneratedError);
  });
});

describe("streamObject empty stream (Gap 3)", () => {
  test("throws NoObjectGeneratedError when tool stream yields no parsed objects", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      strategy: "tool",
      client,
    });

    await expect(async () => {
      for await (const _obj of result.partialObjectStream) {
        // should not yield anything
      }
    }).toThrow(NoObjectGeneratedError);
  });

  test("throws NoObjectGeneratedError when json_schema stream yields no parsed objects", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }], { supportsNativeJsonSchema: true });
    const client = makeClient(adapter);

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      client,
    });

    await expect(async () => {
      for await (const _obj of result.partialObjectStream) {
        // should not yield anything
      }
    }).toThrow(NoObjectGeneratedError);
  });

  test("object() rejects with NoObjectGeneratedError on empty stream", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object", properties: { name: { type: "string" } } },
      strategy: "tool",
      client,
    });

    // Must consume the stream first to trigger the error
    try {
      for await (const _obj of result.partialObjectStream) {
        // empty
      }
    } catch {
      // expected
    }

    await expect(result.object()).rejects.toThrow(NoObjectGeneratedError);
  });
});

describe("StreamObjectResult (Gap 2)", () => {
  test("partialObjectStream yields partial objects", async () => {
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
        argumentsDelta: '{"name": "Alice",',
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: ' "age": 30}',
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      strategy: "tool",
      client,
    });

    const collected: unknown[] = [];
    for await (const obj of result.partialObjectStream) {
      collected.push(obj);
    }

    expect(collected.length).toBeGreaterThanOrEqual(1);
    // Last partial object should be the final one
    expect(collected[collected.length - 1]).toEqual({ name: "Alice", age: 30 });
  });

  test("object() returns the final validated object", async () => {
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
        argumentsDelta: '{"name": "Alice", "age": 30}',
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      strategy: "tool",
      client,
    });

    // Consume the stream
    for await (const _obj of result.partialObjectStream) {
      // drain
    }

    const final = await result.object();
    expect(final).toEqual({ name: "Alice", age: 30 });
  });

  test("object() rejects with NoObjectGeneratedError when validation fails", async () => {
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      strategy: "tool",
      client,
    });

    // Consume stream to trigger error
    try {
      for await (const _obj of result.partialObjectStream) {
        // drain
      }
    } catch {
      // expected
    }

    await expect(result.object()).rejects.toThrow(NoObjectGeneratedError);
  });

  test("usage resolves with token usage from stream", async () => {
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
        argumentsDelta: '{"name": "Alice"}',
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
      strategy: "tool",
      client,
    });

    // Consume stream
    for await (const _obj of result.partialObjectStream) {
      // drain
    }

    const usage = await result.usage;
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(5);
    expect(usage.totalTokens).toBe(15);
  });

  test("result is directly async-iterable via Symbol.asyncIterator (Gap 10)", async () => {
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
        argumentsDelta: '{"name": "Alice"}',
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

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
      strategy: "tool",
      client,
    });

    const collected: unknown[] = [];
    for await (const obj of result) {
      collected.push(obj);
    }

    expect(collected.length).toBeGreaterThanOrEqual(1);
    expect(collected[collected.length - 1]).toEqual({ name: "Alice" });
  });

  test("usage resolves even on stream error", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 3, outputTokens: 0, totalTokens: 3 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = streamObject({
      model: "test-model",
      prompt: "Extract",
      schema: { type: "object" },
      strategy: "tool",
      client,
    });

    try {
      for await (const _obj of result.partialObjectStream) {
        // drain
      }
    } catch {
      // expected
    }

    const usage = await result.usage;
    expect(usage.inputTokens).toBe(3);
    expect(usage.totalTokens).toBe(3);
  });
});
