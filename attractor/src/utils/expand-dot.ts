import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { parse } from "../parser/index.js";
import type { Graph, Node, AttributeValue } from "../types/graph.js";
import { getStringAttr, attrToString } from "../types/graph.js";

interface ExpandedNode {
  id: string;
  attrs: Map<string, AttributeValue>;
}

interface ExpandedEdge {
  from: string;
  to: string;
  attrs: Map<string, AttributeValue>;
}

interface ClusterDef {
  id: string;
  label: string;
  nodes: ExpandedNode[];
  subClusters: ClusterDef[];
}

interface SubPipelineMapping {
  entryNodeIds: string[];
  exitInfo: Array<{ nodeId: string; attrs: Map<string, AttributeValue> }>;
}

interface ExpandedParts {
  nodes: ExpandedNode[];
  edges: ExpandedEdge[];
  clusters: ClusterDef[];
  subPipelines: Map<string, SubPipelineMapping>;
}

function isStartNode(node: Node): boolean {
  return (
    getStringAttr(node.attributes, "shape") === "Mdiamond" ||
    node.id === "start" ||
    node.id === "Start"
  );
}

function isExitNode(node: Node): boolean {
  const shape = getStringAttr(node.attributes, "shape");
  return (
    shape === "Msquare" ||
    node.id === "exit" ||
    node.id === "Exit" ||
    node.id === "end" ||
    node.id === "End"
  );
}

function findStartNodeId(graph: Graph): string {
  for (const [id, node] of graph.nodes) {
    if (getStringAttr(node.attributes, "shape") === "Mdiamond") return id;
  }
  return "start";
}

function findExitNodeId(graph: Graph): string {
  for (const [id, node] of graph.nodes) {
    if (getStringAttr(node.attributes, "shape") === "Msquare") return id;
  }
  return "exit";
}

function escDot(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatAttrs(attrs: Map<string, AttributeValue>, exclude?: Set<string>): string {
  const parts: string[] = [];
  for (const [key, val] of attrs) {
    if (exclude?.has(key)) continue;
    parts.push(`${key}="${escDot(attrToString(val))}"`);
  }
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

/**
 * Expand a graph by inlining sub-pipeline nodes, collecting all pieces
 * into a flat structure of nodes, edges, and clusters. Handles recursion
 * for nested sub-pipelines.
 *
 * @param isTopLevel - When true, start/exit edges are preserved (not skipped).
 *   Only child graphs skip start/exit edges because the parent handles the remapping.
 */
function expandGraph(graph: Graph, basePath: string, prefix: string, isTopLevel: boolean = false): ExpandedParts {
  const nodes: ExpandedNode[] = [];
  const edges: ExpandedEdge[] = [];
  const clusters: ClusterDef[] = [];
  const subPipelines = new Map<string, SubPipelineMapping>();

  for (const [nodeId, node] of graph.nodes) {
    const subPipelinePath = getStringAttr(node.attributes, "sub_pipeline");

    if (subPipelinePath) {
      const fullPath = resolve(basePath, subPipelinePath);
      let childDot: string;
      try {
        childDot = readFileSync(fullPath, "utf-8");
      } catch {
        // If child DOT can't be read, keep as regular node
        nodes.push({ id: prefix + nodeId, attrs: node.attributes });
        continue;
      }

      const childGraph = parse(childDot);
      const childPrefix = prefix + nodeId + "_";
      const startId = findStartNodeId(childGraph);
      const exitId = findExitNodeId(childGraph);

      // Recursively expand child graph (handles nested sub-pipelines)
      const childParts = expandGraph(childGraph, dirname(fullPath), childPrefix);

      // Entry info: edges from start node in child
      const entryEdges = childGraph.edges.filter((e) => e.from === startId);
      const entryNodeIds = entryEdges.map((e) => {
        // If the entry target was itself a sub-pipeline, remap to its entry
        const childSub = childParts.subPipelines.get(e.to);
        if (childSub) return childSub.entryNodeIds;
        return [childPrefix + e.to];
      }).flat();

      // Exit info: edges to exit node in child
      const exitEdges = childGraph.edges.filter((e) => e.to === exitId);
      const exitInfo = exitEdges.flatMap((e) => {
        // If the exit source was itself a sub-pipeline, remap to its exits
        const childSub = childParts.subPipelines.get(e.from);
        if (childSub) {
          return childSub.exitInfo.map((exit) => ({
            nodeId: exit.nodeId,
            attrs: exit.attrs,
          }));
        }
        return [{ nodeId: childPrefix + e.from, attrs: e.attributes }];
      });

      subPipelines.set(nodeId, { entryNodeIds, exitInfo });

      // Collect child's expanded nodes (excluding start/exit)
      const clusterNodes = childParts.nodes.filter((n) => {
        const unprefixed = n.id.slice(childPrefix.length);
        return unprefixed !== startId && unprefixed !== exitId;
      });

      // Collect child's internal edges (excluding start/exit connections)
      for (const edge of childParts.edges) {
        edges.push(edge);
      }

      clusters.push({
        id: "cluster_" + prefix + nodeId,
        label: getStringAttr(node.attributes, "label", nodeId),
        nodes: clusterNodes,
        subClusters: childParts.clusters,
      });
    } else {
      nodes.push({ id: prefix + nodeId, attrs: node.attributes });
    }
  }

  // Process edges with sub-pipeline remapping
  for (const edge of graph.edges) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);

    // Skip edges involving start/exit of child graphs (the parent handles
    // remapping via entryNodeIds/exitInfo). Top-level start/exit are real nodes.
    if (!isTopLevel) {
      if (fromNode && isStartNode(fromNode)) continue;
      if (toNode && isExitNode(toNode)) continue;
    }

    const fromSub = subPipelines.get(edge.from);
    const toSub = subPipelines.get(edge.to);

    if (fromSub && toSub) {
      // Both ends are sub-pipelines
      for (const exit of fromSub.exitInfo) {
        for (const entryId of toSub.entryNodeIds) {
          edges.push({ from: exit.nodeId, to: entryId, attrs: exit.attrs });
        }
      }
    } else if (fromSub) {
      // Source is a sub-pipeline
      for (const exit of fromSub.exitInfo) {
        edges.push({ from: exit.nodeId, to: prefix + edge.to, attrs: exit.attrs });
      }
    } else if (toSub) {
      // Target is a sub-pipeline
      for (const entryId of toSub.entryNodeIds) {
        edges.push({ from: prefix + edge.from, to: entryId, attrs: edge.attributes });
      }
    } else {
      // Neither is a sub-pipeline
      edges.push({ from: prefix + edge.from, to: prefix + edge.to, attrs: edge.attributes });
    }
  }

  return { nodes, edges, clusters, subPipelines };
}

function emitCluster(cluster: ClusterDef, indent: string): string {
  let dot = `${indent}subgraph ${cluster.id} {\n`;
  dot += `${indent}  label="${escDot(cluster.label)}"\n`;
  dot += `${indent}  style=dashed\n`;
  dot += `${indent}  color=gray\n`;

  // Nested sub-clusters
  for (const sub of cluster.subClusters) {
    dot += emitCluster(sub, indent + "  ");
  }

  // Nodes
  for (const node of cluster.nodes) {
    dot += `${indent}  ${node.id}${formatAttrs(node.attrs)}\n`;
  }

  dot += `${indent}}\n`;
  return dot;
}

/**
 * Expand sub-pipeline nodes in a DOT graph into a single combined DOT string
 * with clusters for each sub-pipeline and all inner nodes, edges, and
 * conditional labels preserved.
 *
 * @param dotSource - The top-level DOT source string
 * @param basePath - Base directory for resolving relative sub_pipeline paths
 * @returns Expanded DOT source string
 */
export function expandDotForVisualization(dotSource: string, basePath: string): string {
  const graph = parse(dotSource);
  const parts = expandGraph(graph, basePath, "", true);

  const graphLabel = getStringAttr(graph.attributes, "label", graph.name);

  let dot = `digraph ${graph.name} {\n`;
  dot += `  rankdir=TB\n`;
  dot += `  label="${escDot(graphLabel)}"\n\n`;

  // Top-level nodes (non-sub-pipeline nodes that are not start/exit of child graphs)
  for (const node of parts.nodes) {
    dot += `  ${node.id}${formatAttrs(node.attrs)}\n`;
  }
  if (parts.nodes.length > 0) dot += "\n";

  // Clusters
  for (const cluster of parts.clusters) {
    dot += emitCluster(cluster, "  ");
    dot += "\n";
  }

  // Edges
  for (const edge of parts.edges) {
    dot += `  ${edge.from} -> ${edge.to}${formatAttrs(edge.attrs)}\n`;
  }

  dot += "}\n";
  return dot;
}
