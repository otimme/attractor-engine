import { describe, test, expect } from "bun:test";
import { GeminiAdapter } from "../../../src/providers/gemini/adapter.js";
import {
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  ContextLengthError,
  ContentFilterError,
  QuotaExceededError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  RequestTimeoutError,
} from "../../../src/types/errors.js";

describe("GeminiAdapter mapError", () => {
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

  test("maps gRPC NOT_FOUND status to NotFoundError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "NOT_FOUND", message: "Model not found" } }),
          { status: 404, headers: { "content-type": "application/json" } },
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

      expect(caught).toBeInstanceOf(NotFoundError);
      expect((caught as NotFoundError).errorCode).toBe("NOT_FOUND");
    } finally {
      server.stop(true);
    }
  });

  test("maps gRPC RESOURCE_EXHAUSTED to RateLimitError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
          { status: 409, headers: { "content-type": "application/json" } },
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

      expect(caught).toBeInstanceOf(RateLimitError);
      expect((caught as RateLimitError).errorCode).toBe("RESOURCE_EXHAUSTED");
    } finally {
      server.stop(true);
    }
  });

  test("maps gRPC PERMISSION_DENIED to AccessDeniedError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Access denied" } }),
          { status: 403, headers: { "content-type": "application/json" } },
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

      expect(caught).toBeInstanceOf(AccessDeniedError);
    } finally {
      server.stop(true);
    }
  });

  test("maps gRPC DEADLINE_EXCEEDED to RequestTimeoutError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "DEADLINE_EXCEEDED", message: "Deadline exceeded" } }),
          { status: 409, headers: { "content-type": "application/json" } },
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

      expect(caught).toBeInstanceOf(RequestTimeoutError);
    } finally {
      server.stop(true);
    }
  });

  test("maps gRPC UNAVAILABLE to ServerError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "UNAVAILABLE", message: "Service unavailable" } }),
          { status: 409, headers: { "content-type": "application/json" } },
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
    } finally {
      server.stop(true);
    }
  });

  test("maps context length message on 400 to ContextLengthError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Request exceeds maximum context length" } }),
          { status: 400, headers: { "content-type": "application/json" } },
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

  test("maps gRPC RESOURCE_EXHAUSTED with retry-after header", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
          { status: 409, headers: { "content-type": "application/json", "retry-after": "42" } },
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

      expect(caught).toBeInstanceOf(RateLimitError);
      expect((caught as RateLimitError).retryAfter).toBe(42);
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
    } finally {
      server.stop(true);
    }
  });

  test("maps content filter message to ContentFilterError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Blocked by safety filter" } }),
          { status: 400, headers: { "content-type": "application/json" } },
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

      expect(caught).toBeInstanceOf(ContentFilterError);
    } finally {
      server.stop(true);
    }
  });
});
