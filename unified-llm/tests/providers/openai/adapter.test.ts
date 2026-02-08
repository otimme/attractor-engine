import { describe, test, expect } from "bun:test";
import { OpenAIAdapter } from "../../../src/providers/openai/adapter.js";
import {
  AuthenticationError,
  NotFoundError,
  ContextLengthError,
  ContentFilterError,
  QuotaExceededError,
  InvalidRequestError,
  RequestTimeoutError,
} from "../../../src/types/errors.js";

describe("OpenAIAdapter mapError", () => {
  test("maps 408 to RequestTimeoutError", async () => {
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
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
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
          JSON.stringify({ error: { message: "Request too large" } }),
          { status: 413, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
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
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
      expect((caught as AuthenticationError).errorCode).toBe("invalid_api_key");
    } finally {
      server.stop(true);
    }
  });

  test("maps content filter message to ContentFilterError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Content filter triggered" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
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
          JSON.stringify({ error: { message: "Quota exceeded" } }),
          { status: 402, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(QuotaExceededError);
    } finally {
      server.stop(true);
    }
  });

  test("maps not_found message in fallback to NotFoundError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Model does not exist" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
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
          JSON.stringify({ error: { message: "Invalid API key provided" } }),
          { status: 418, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AuthenticationError);
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
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({ model: "gpt-4o", messages: [] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidRequestError);
    } finally {
      server.stop(true);
    }
  });
});
