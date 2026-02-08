import { describe, test, expect } from "bun:test";
import { GeminiAdapter } from "../../../src/providers/gemini/adapter.js";
import {
  AuthenticationError,
  ServerError,
  ContextLengthError,
  InvalidRequestError,
} from "../../../src/types/errors.js";

describe("GeminiAdapter mapError", () => {
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
      const adapter = new GeminiAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gemini-3-pro-preview", messages: [] });
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
      const adapter = new GeminiAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gemini-3-pro-preview", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContextLengthError);
    } finally {
      server.stop(true);
    }
  });

  test("sets errorCode from response error status", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "UNAUTHENTICATED", message: "Bad key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new GeminiAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gemini-3-pro-preview", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
      expect((caught as AuthenticationError).errorCode).toBe("UNAUTHENTICATED");
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
      const adapter = new GeminiAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gemini-3-pro-preview", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidRequestError);
    } finally {
      server.stop(true);
    }
  });
});
