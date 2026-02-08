import { describe, test, expect } from "bun:test";
import { AnthropicAdapter } from "../../../src/providers/anthropic/adapter.js";
import {
  AuthenticationError,
  ServerError,
  ContextLengthError,
  InvalidRequestError,
} from "../../../src/types/errors.js";

describe("AnthropicAdapter mapError", () => {
  test("maps 408 to retryable ServerError", async () => {
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
});
