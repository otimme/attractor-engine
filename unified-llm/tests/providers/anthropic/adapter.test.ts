import { describe, test, expect } from "bun:test";
import { AnthropicAdapter } from "../../../src/providers/anthropic/adapter.js";
import {
  AuthenticationError,
  NotFoundError,
  ContextLengthError,
  ContentFilterError,
  QuotaExceededError,
  InvalidRequestError,
  RequestTimeoutError,
} from "../../../src/types/errors.js";

describe("AnthropicAdapter mapError", () => {
  test("maps 408 to RequestTimeoutError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "timeout", message: "Request timeout" } }),
          { status: 408, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RequestTimeoutError);
      const error = caught as RequestTimeoutError;
      expect(error.retryable).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("maps 413 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "request_too_large", message: "Request too large" } }),
          { status: 413, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
      expect((caught as ContextLengthError).retryable).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("sets errorCode from response error type", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "authentication_error", message: "Invalid key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
      expect((caught as AuthenticationError).errorCode).toBe("authentication_error");
    } finally {
      server.stop(true);
    }
  });

  test("maps 422 to InvalidRequestError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request", message: "Unprocessable" } }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidRequestError);
      expect((caught as InvalidRequestError).retryable).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("maps context length message on 400 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Request exceeds maximum context length" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
    } finally {
      server.stop(true);
    }
  });

  test("maps not_found message in fallback to NotFoundError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "not_found_error", message: "Model does not exist" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NotFoundError);
    } finally {
      server.stop(true);
    }
  });

  test("maps auth message in fallback to AuthenticationError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "auth_error", message: "Invalid API key provided" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
    } finally {
      server.stop(true);
    }
  });

  test("maps content filter message to ContentFilterError on 400", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "Output blocked by content filter" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContentFilterError);
    } finally {
      server.stop(true);
    }
  });

  test("maps quota message to QuotaExceededError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { type: "billing_error", message: "Quota exceeded for this billing period" } }),
          { status: 402, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new AnthropicAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "claude-opus-4-6", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(QuotaExceededError);
    } finally {
      server.stop(true);
    }
  });
});
