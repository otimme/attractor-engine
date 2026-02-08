import type { Handler, CodergenBackend } from "../types/handler.js";
import type { Node, Graph } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import { getStringAttr } from "../types/graph.js";
import { StageStatus, createOutcome } from "../types/outcome.js";

interface ParallelResult {
  nodeId: string;
  status: string;
  notes: string;
  contextUpdates: Record<string, string>;
}

const OUTCOME_RANK: Record<string, number> = {
  [StageStatus.SUCCESS]: 0,
  [StageStatus.PARTIAL_SUCCESS]: 1,
  [StageStatus.RETRY]: 2,
  [StageStatus.FAIL]: 3,
};

function heuristicSelect(candidates: readonly ParallelResult[]): ParallelResult | undefined {
  if (candidates.length === 0) return undefined;

  const sorted = [...candidates].sort((a, b) => {
    const rankA = OUTCOME_RANK[a.status] ?? 4;
    const rankB = OUTCOME_RANK[b.status] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    return a.nodeId.localeCompare(b.nodeId);
  });

  return sorted[0];
}

function buildEvaluationPrompt(candidates: readonly ParallelResult[]): string {
  const descriptions = candidates.map(
    (c) => `- Candidate "${c.nodeId}": status=${c.status}, notes=${c.notes}`,
  );
  return [
    "Evaluate these candidates and select the best one.",
    "Reply with only the candidate ID on the first line.",
    "",
    ...descriptions,
  ].join("\n");
}

function parseLlmSelection(
  response: string,
  candidates: readonly ParallelResult[],
): ParallelResult | undefined {
  const candidateIds = new Set(candidates.map((c) => c.nodeId));
  // Check first line for an exact candidate ID
  const firstLine = response.split("\n")[0]?.trim() ?? "";
  if (candidateIds.has(firstLine)) {
    return candidates.find((c) => c.nodeId === firstLine);
  }
  // Scan entire response for any candidate ID mention
  for (const candidate of candidates) {
    if (response.includes(candidate.nodeId)) {
      return candidate;
    }
  }
  return undefined;
}

export class FanInHandler implements Handler {
  private readonly backend: CodergenBackend | undefined;

  constructor(backend?: CodergenBackend) {
    this.backend = backend;
  }

  async execute(node: Node, context: Context, _graph: Graph, _logsRoot: string): Promise<Outcome> {
    // 1. Read parallel results
    const raw = context.get("parallel.results");
    if (raw === "") {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No parallel results to evaluate",
      });
    }

    let results: ParallelResult[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return createOutcome({
          status: StageStatus.FAIL,
          failureReason: "Parallel results is not an array",
        });
      }
      results = parsed as ParallelResult[];
    } catch {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "Failed to parse parallel results",
      });
    }

    // 2. Check if all failed
    const allFailed = results.every((r) => r.status === StageStatus.FAIL);
    if (allFailed) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "All parallel candidates failed",
        notes: "Fan-in node: " + node.id,
      });
    }

    // 3. LLM-based evaluation if prompt attribute exists and backend available
    const prompt = getStringAttr(node.attributes, "prompt");
    if (prompt !== "" && this.backend) {
      try {
        const evalPrompt = prompt + "\n\n" + buildEvaluationPrompt(results);
        const response = await this.backend.run(node, evalPrompt, context);
        const responseText = typeof response === "string" ? response : response.notes;
        const selected = parseLlmSelection(responseText, results);
        if (selected) {
          return createOutcome({
            status: StageStatus.SUCCESS,
            contextUpdates: {
              "parallel.fan_in.best_id": selected.nodeId,
              "parallel.fan_in.best_outcome": selected.status,
            },
            notes: "LLM selected candidate: " + selected.nodeId,
          });
        }
        // LLM response didn't match any candidate; fall through to heuristic
      } catch {
        // LLM error; fall through to heuristic
      }
    }

    // 4. Heuristic selection (fallback)
    const best = heuristicSelect(results);
    if (!best) {
      return createOutcome({
        status: StageStatus.FAIL,
        failureReason: "No candidates available",
      });
    }

    return createOutcome({
      status: StageStatus.SUCCESS,
      contextUpdates: {
        "parallel.fan_in.best_id": best.nodeId,
        "parallel.fan_in.best_outcome": best.status,
      },
      notes: "Selected best candidate: " + best.nodeId,
    });
  }
}
