import { describe, test, expect } from "bun:test";
import { parseStylesheet } from "../../src/stylesheet/parser.js";
import { applyStylesheet } from "../../src/stylesheet/apply.js";
import type { Graph, Node, StylesheetRule } from "../../src/types/index.js";
import { stringAttr, getStringAttr } from "../../src/types/index.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
  const attributes = new Map(
    Object.entries(attrs).map(([k, v]) => [k, stringAttr(v)]),
  );
  return { id, attributes };
}

function makeGraph(nodes: Node[]): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return { name: "test", attributes: new Map(), nodes: nodeMap, edges: [] };
}

describe("shape selector parsing", () => {
  test("parses bare identifier as shape selector", () => {
    const rules = parseStylesheet('box { llm_model: "claude-opus-4-6"; }');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toEqual({
      kind: "shape",
      value: "box",
      specificity: 0.5,
    });
  });

  test("shape selector coexists with other selector kinds", () => {
    const rules = parseStylesheet(
      `* { llm_provider: anthropic; }
       box { llm_model: "claude-opus-4-6"; }
       .code { reasoning_effort: high; }
       #review { llm_model: gpt-5; }`,
    );
    expect(rules).toHaveLength(4);
    expect(rules[0]?.selector.kind).toBe("universal");
    expect(rules[1]?.selector.kind).toBe("shape");
    expect(rules[2]?.selector.kind).toBe("class");
    expect(rules[3]?.selector.kind).toBe("id");
  });
});

describe("shape selector application", () => {
  test("matches nodes by shape attribute", () => {
    const graph = makeGraph([
      makeNode("a", { shape: "box" }),
      makeNode("b", { shape: "diamond" }),
    ]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "shape", value: "box", specificity: 0.5 },
        declarations: [{ property: "llm_model", value: "claude-opus-4-6" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "claude-opus-4-6",
    );
    expect(result.nodes.get("b")?.attributes.has("llm_model")).toBe(false);
  });

  test("shape specificity is between universal and class", () => {
    const graph = makeGraph([
      makeNode("a", { shape: "box", class: "code" }),
    ]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "universal-model" }],
      },
      {
        selector: { kind: "shape", value: "box", specificity: 0.5 },
        declarations: [{ property: "llm_model", value: "shape-model" }],
      },
      {
        selector: { kind: "class", value: "code", specificity: 1 },
        declarations: [{ property: "llm_model", value: "class-model" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    // Class selector wins over shape which wins over universal
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "class-model",
    );
  });

  test("shape selector overrides universal selector", () => {
    const graph = makeGraph([makeNode("a", { shape: "box" })]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "universal", value: "*", specificity: 0 },
        declarations: [{ property: "llm_model", value: "universal-model" }],
      },
      {
        selector: { kind: "shape", value: "box", specificity: 0.5 },
        declarations: [{ property: "llm_model", value: "shape-model" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(getStringAttr(result.nodes.get("a")?.attributes ?? new Map(), "llm_model")).toBe(
      "shape-model",
    );
  });

  test("does not match nodes without matching shape", () => {
    const graph = makeGraph([makeNode("a", { shape: "diamond" })]);
    const rules: StylesheetRule[] = [
      {
        selector: { kind: "shape", value: "box", specificity: 0.5 },
        declarations: [{ property: "llm_model", value: "box-model" }],
      },
    ];

    const result = applyStylesheet(graph, rules);
    expect(result.nodes.get("a")?.attributes.has("llm_model")).toBe(false);
  });
});
