import { describe, test, expect, setDefaultTimeout } from "bun:test";

setDefaultTimeout(15_000);
import { httpRequest, httpRequestStream, parseRetryAfterHeader } from "../../src/utils/http.js";

describe("parseRetryAfterHeader", () => {
  test("returns undefined when no retry-after header", () => {
    const headers = new Headers();
    expect(parseRetryAfterHeader(headers)).toBeUndefined();
  });

  test("parses seconds format", () => {
    const headers = new Headers({ "retry-after": "30" });
    expect(parseRetryAfterHeader(headers)).toBe(30);
  });

  test("returns undefined for zero seconds", () => {
    const headers = new Headers({ "retry-after": "0" });
    expect(parseRetryAfterHeader(headers)).toBeUndefined();
  });

  test("returns undefined for negative seconds", () => {
    const headers = new Headers({ "retry-after": "-5" });
    expect(parseRetryAfterHeader(headers)).toBeUndefined();
  });

  test("parses HTTP-date format (future date)", () => {
    const futureDate = new Date(Date.now() + 60_000);
    const headers = new Headers({ "retry-after": futureDate.toUTCString() });
    const result = parseRetryAfterHeader(headers);
    expect(result).toBeDefined();
    // Should be roughly 60 seconds, allow some tolerance
    expect(result).toBeGreaterThan(55);
    expect(result).toBeLessThanOrEqual(61);
  });

  test("returns undefined for HTTP-date in the past", () => {
    const pastDate = new Date(Date.now() - 60_000);
    const headers = new Headers({ "retry-after": pastDate.toUTCString() });
    expect(parseRetryAfterHeader(headers)).toBeUndefined();
  });

  test("returns undefined for non-parseable value", () => {
    const headers = new Headers({ "retry-after": "not-a-number-or-date" });
    expect(parseRetryAfterHeader(headers)).toBeUndefined();
  });
});

describe("httpRequestStream", () => {
  test("stream read timeout fires when chunks stop arriving", async () => {
    // Server sends one chunk then stalls — stream read timeout should fire
    const server = Bun.serve({
      port: 0,
      idleTimeout: 30,
      fetch() {
        const stream = new ReadableStream({
          start(controller) {
            // Send initial chunk so fetch resolves, then stop
            controller.enqueue(new TextEncoder().encode("data: init\n\n"));
            // intentionally never enqueue again or close
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const result = await httpRequestStream({
        url: `http://localhost:${server.port}/stream`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {},
        timeout: { request: 30_000, streamRead: 50 },
        provider: "test",
      });

      const reader = result.body.getReader();
      // First read should succeed (initial chunk)
      const first = await reader.read();
      expect(first.done).toBe(false);
      // Second read should timeout since no more chunks arrive
      await expect(reader.read()).rejects.toThrow("Stream read timeout");
    } finally {
      server.stop(true);
    }
  });

  test("stream read timeout resets on each chunk", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        let count = 0;
        const stream = new ReadableStream({
          async start(controller) {
            // Send 3 chunks with 20ms intervals, then close
            const interval = setInterval(() => {
              count++;
              controller.enqueue(new TextEncoder().encode(`chunk${count}\n`));
              if (count >= 3) {
                clearInterval(interval);
                controller.close();
              }
            }, 20);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const result = await httpRequestStream({
        url: `http://localhost:${server.port}/stream`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: {},
        // 100ms timeout is longer than 20ms interval, so it should not fire
        timeout: { request: 5000, streamRead: 100 },
        provider: "test",
      });

      const chunks: string[] = [];
      const reader = result.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const read = await reader.read();
        done = read.done;
        if (read.value) {
          chunks.push(decoder.decode(read.value));
        }
      }

      expect(chunks).toHaveLength(3);
    } finally {
      server.stop(true);
    }
  });

  test("unknown status code produces retryable error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "I'm a teapot" }), {
          status: 418,
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      await expect(
        httpRequestStream({
          url: `http://localhost:${server.port}/test`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: {},
          provider: "test",
        }),
      ).rejects.toMatchObject({ retryable: true });
    } finally {
      server.stop(true);
    }
  });

  test("unknown status code produces retryable error (non-streaming)", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "I'm a teapot" }), {
          status: 418,
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      await expect(
        httpRequest({
          url: `http://localhost:${server.port}/test`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: {},
          provider: "test",
        }),
      ).rejects.toMatchObject({ retryable: true });
    } finally {
      server.stop(true);
    }
  });
});
