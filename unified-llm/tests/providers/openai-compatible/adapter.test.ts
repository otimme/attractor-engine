import { describe, test, expect } from "bun:test";
import { OpenAICompatibleAdapter } from "../../../src/providers/openai-compatible/adapter.js";
import {
  AuthenticationError,
  RateLimitError,
  ServerError,
  ContextLengthError,
  InvalidRequestError,
} from "../../../src/types/errors.js";

describe("OpenAICompatibleAdapter", () => {
  test("extracts Retry-After header on 429 rate limit", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Rate limited" } }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "30",
            },
          },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({
          model: "test-model",
          messages: [],
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RateLimitError);
      expect((caught as RateLimitError).retryAfter).toBe(30);
    } finally {
      server.stop(true);
    }
  });

  test("maps 408 to retryable ServerError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Request timeout" } }),
          { status: 408, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "test-model", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ServerError);
      const error = caught as ServerError;
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(408);
    } finally {
      server.stop(true);
    }
  });

  test("maps 413 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Request too large" } }),
          { status: 413, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "test-model", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
    } finally {
      server.stop(true);
    }
  });

  test("sets errorCode from response error code", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { code: "invalid_api_key", message: "Bad key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
        apiKey: "test-key",
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "test-model", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
      expect((caught as AuthenticationError).errorCode).toBe("invalid_api_key");
    } finally {
      server.stop(true);
    }
  });

  test("maps 422 to InvalidRequestError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Unprocessable" } }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "test-model", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidRequestError);
    } finally {
      server.stop(true);
    }
  });

  test("request.timeout overrides adapter timeout", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            id: "chatcmpl-1",
            model: "test-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Hello" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
        timeout: { connect: 1, request: 1, streamRead: 1 },
      });

      // Using a longer request timeout should allow the request to succeed
      const response = await adapter.complete({
        model: "test-model",
        messages: [],
        timeout: { connect: 5000, request: 5000, streamRead: 5000 },
      });

      expect(response.provider).toBe("openai-compatible");
    } finally {
      server.stop(true);
    }
  });
});
