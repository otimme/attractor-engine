import type { Graph, Transform } from "../types/index.js";

/**
 * Named transform wrapper for buildPreamble.
 *
 * The actual preamble construction requires runtime context (Context,
 * completed nodes, outcomes) that is unavailable at graph-transform time.
 * This transform is a no-op during the parse-time pipeline; the real
 * work happens in `engine/fidelity.ts#buildPreamble` at execution time.
 *
 * Registered so the preamble is discoverable as a named transform.
 */
export class PreambleTransform implements Transform {
  apply(graph: Graph): Graph {
    return graph;
  }
}
