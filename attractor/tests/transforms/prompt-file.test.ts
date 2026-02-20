import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PromptFileTransform } from "../../src/transforms/prompt-file.js";
import type { Graph, Node } from "../../src/types/index.js";
import { stringAttr, getStringAttr } from "../../src/types/index.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map(
    Object.entries(attrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { id, attributes };
}

function makeGraph(
  nodes: Node[],
  graphAttrs: Record<string, string> = {},
): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const attributes = new Map(
    Object.entries(graphAttrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { name: "test", attributes, nodes: nodeMap, edges: [] };
}

const tmpDir = join(import.meta.dir, ".tmp-prompt-file-test");

beforeAll(() => {
  mkdirSync(join(tmpDir, "prompts"), { recursive: true });
  writeFileSync(join(tmpDir, "prompts", "hello.md"), "Hello from file!");
  writeFileSync(join(tmpDir, "prompts", "with-goal.md"), "Build $goal now");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PromptFileTransform", () => {
  test("resolves @ prompt to file contents using _prompt_base", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "@prompts/hello.md" })],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("Hello from file!");
  });

  test("leaves non-@ prompts unchanged", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "Just a regular prompt" })],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("Just a regular prompt");
  });

  test("leaves nodes without prompt unchanged", () => {
    const graph = makeGraph(
      [makeNode("a", { label: "No prompt" })],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("a")?.attributes.has("prompt")).toBe(false);
  });

  test("handles graph with no _prompt_base (resolves relative to CWD)", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "not an @ prompt" })],
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("not an @ prompt");
  });

  test("throws on missing file", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "@prompts/nonexistent.md" })],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    expect(() => transform.apply(graph)).toThrow("PromptFileTransform");
  });

  test("handles multiple nodes with mixed @ and regular prompts", () => {
    const graph = makeGraph(
      [
        makeNode("a", { prompt: "@prompts/hello.md" }),
        makeNode("b", { prompt: "Regular prompt" }),
        makeNode("c", { prompt: "@prompts/with-goal.md" }),
      ],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    expect(
      getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "prompt"),
    ).toBe("Hello from file!");
    expect(
      getStringAttr(result.nodes.get("b")?.attributes ?? new Map(), "prompt"),
    ).toBe("Regular prompt");
    expect(
      getStringAttr(result.nodes.get("c")?.attributes ?? new Map(), "prompt"),
    ).toBe("Build $goal now");
  });

  test("is a no-op when no @ prompts exist", () => {
    const graph = makeGraph(
      [makeNode("a", { prompt: "No file reference" })],
      { _prompt_base: tmpDir },
    );

    const transform = new PromptFileTransform();
    const result = transform.apply(graph);

    // Returns original graph (same reference) when no @ prompts
    expect(result).toBe(graph);
  });
});
