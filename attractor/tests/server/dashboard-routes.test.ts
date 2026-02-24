import { describe, test, expect, afterEach } from "bun:test";
import { createServer } from "../../src/server/server.js";
import type { AttractorServer } from "../../src/server/server.js";
import { createHandlerRegistry } from "../../src/engine/runner.js";
import { StartHandler } from "../../src/handlers/start.js";
import { ExitHandler } from "../../src/handlers/exit.js";
import { StageStatus, createOutcome } from "../../src/types/outcome.js";

const SIMPLE_DOT = `digraph test {
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

function makeRegistry() {
  const registry = createHandlerRegistry();
  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  registry.defaultHandler = {
    async execute() {
      return createOutcome({ status: StageStatus.SUCCESS, notes: "stub" });
    },
  };
  return registry;
}

let server: AttractorServer | undefined;

afterEach(() => {
  if (server) {
    server.stop();
    server = undefined;
  }
});

function baseUrl(): string {
  return `http://127.0.0.1:${server?.port ?? 0}`;
}

describe("GET /", () => {
  test("returns 200 status code", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/`);
    expect(res.status).toBe(200);
  });

  test("returns Content-Type text/html", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("response body contains valid HTML", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/`);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<html");
  });

  test("response body is non-empty", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/`);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("GET /pipelines", () => {
  test("returns 200 status code", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`);
    expect(res.status).toBe(200);
  });

  test("returns Content-Type application/json", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("response body is a valid JSON array", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`);
    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("returns empty array when no pipelines are running", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines`);
    const body: unknown = await res.json();
    expect(body).toEqual([]);
  });

  test("each entry has id and status fields when pipelines exist", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });

    // Create a pipeline first
    await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });

    const res = await fetch(`${baseUrl()}/pipelines`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect("id" in entry).toBe(true);
      expect("status" in entry).toBe(true);
      expect(typeof entry["id"]).toBe("string");
      expect(typeof entry["status"]).toBe("string");
    }
  });
});
