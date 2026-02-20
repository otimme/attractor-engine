import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Graph, Node, Transform } from "../types/index.js";
import { getStringAttr, stringAttr } from "../types/index.js";

/**
 * Resolves `@`-prefixed prompt attributes to file contents.
 *
 * When a node's `prompt` attribute starts with `@`, the remainder is treated
 * as a file path relative to the graph's `_prompt_base` attribute (or CWD
 * if not set). The file is read and the attribute value is replaced with
 * the file contents.
 *
 * Example: `prompt="@prompts/seed/ingest.md"` with `_prompt_base="pipelines/factory"`
 * resolves to reading `pipelines/factory/prompts/seed/ingest.md`.
 */
export class PromptFileTransform implements Transform {
  apply(graph: Graph): Graph {
    const basePath = getStringAttr(graph.attributes, "_prompt_base");

    let hasAtPrompts = false;
    for (const [, node] of graph.nodes) {
      const prompt = getStringAttr(node.attributes, "prompt");
      if (prompt.startsWith("@")) {
        hasAtPrompts = true;
        break;
      }
    }
    if (!hasAtPrompts) return graph;

    const newNodes = new Map<string, Node>();
    for (const [id, node] of graph.nodes) {
      const prompt = getStringAttr(node.attributes, "prompt");
      if (!prompt.startsWith("@")) {
        newNodes.set(id, node);
        continue;
      }

      const relativePath = prompt.slice(1); // strip leading @
      const fullPath = basePath !== "" ? join(basePath, relativePath) : relativePath;

      let fileContent: string;
      try {
        fileContent = readFileSync(fullPath, "utf-8");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `PromptFileTransform: Failed to read prompt file "${fullPath}" ` +
          `(node "${id}", prompt="${prompt}"): ${message}`
        );
      }

      const newAttrs = new Map(node.attributes);
      newAttrs.set("prompt", stringAttr(fileContent));
      newNodes.set(id, { id, attributes: newAttrs });
    }

    return {
      name: graph.name,
      attributes: graph.attributes,
      nodes: newNodes,
      edges: graph.edges,
      subgraphs: graph.subgraphs,
    };
  }
}
