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

describe("GET /pipelines/:id/graph", () => {
  test("returns DOT source with graphviz content type", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const createRes = await fetch(`${baseUrl()}/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot: SIMPLE_DOT }),
    });
    const createBody = (await createRes.json()) as Record<string, unknown>;
    const id = String(createBody["id"]);

    const graphRes = await fetch(`${baseUrl()}/pipelines/${id}/graph`);
    expect(graphRes.status).toBe(200);
    expect(graphRes.headers.get("content-type")).toBe("text/vnd.graphviz");
    const body = await graphRes.text();
    expect(body).toBe(SIMPLE_DOT);
  });

  test("returns 404 for nonexistent pipeline", async () => {
    server = createServer({ runnerConfig: { handlerRegistry: makeRegistry() } });
    const res = await fetch(`${baseUrl()}/pipelines/nonexistent/graph`);
    expect(res.status).toBe(404);
  });
});
