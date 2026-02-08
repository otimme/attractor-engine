/** Default character limits per tool (spec section 5.2). */
export const DEFAULT_CHAR_LIMITS: Record<string, number> = {
  read_file: 50_000,
  shell: 30_000,
  grep: 20_000,
  glob: 20_000,
  edit_file: 10_000,
  apply_patch: 10_000,
  write_file: 1_000,
  spawn_agent: 20_000,
};

/** Default truncation modes per tool. */
export const DEFAULT_TRUNCATION_MODES: Record<string, "head_tail" | "tail"> = {
  read_file: "head_tail",
  shell: "head_tail",
  grep: "tail",
  glob: "tail",
  edit_file: "tail",
  apply_patch: "tail",
  write_file: "tail",
  spawn_agent: "head_tail",
};

/** Default line limits per tool (spec section 5.3). null means no line limit. */
export const DEFAULT_LINE_LIMITS: Record<string, number | null> = {
  shell: 256,
  grep: 200,
  glob: 500,
  read_file: null,
  edit_file: null,
  apply_patch: null,
  write_file: null,
  spawn_agent: null,
};

/**
 * Truncate output by character count.
 *
 * - head_tail: keep first half of budget + warning + last half
 * - tail: warning + last maxChars characters
 */
export function truncateOutput(
  output: string,
  maxChars: number,
  mode: "head_tail" | "tail",
): string {
  if (output.length <= maxChars) {
    return output;
  }

  if (mode === "head_tail") {
    const halfBudget = Math.floor(maxChars / 2);
    const head = output.slice(0, halfBudget);
    const tail = output.slice(output.length - halfBudget);
    const removed = output.length - halfBudget * 2;
    const marker = `\n\n[WARNING: Tool output was truncated. ${removed} characters were removed from the middle. The full output is available in the event stream. If you need to see specific parts, re-run the tool with more targeted parameters.]\n\n`;
    return head + marker + tail;
  }

  // tail mode
  const kept = output.slice(output.length - maxChars);
  const removed = output.length - maxChars;
  const marker = `[WARNING: Tool output was truncated. First ${removed} characters were removed. The full output is available in the event stream.]\n\n`;
  return marker + kept;
}

/**
 * Truncate output by line count, keeping first half + marker + last half.
 */
export function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return output;
  }

  const headCount = Math.floor(maxLines / 2);
  const tailCount = maxLines - headCount;
  const headLines = lines.slice(0, headCount);
  const tailLines = lines.slice(lines.length - tailCount);
  const omitted = lines.length - headCount - tailCount;
  const marker = `\n[... ${omitted} lines omitted ...]\n`;
  return headLines.join("\n") + marker + tailLines.join("\n");
}

export interface TruncationConfig {
  toolOutputLimits?: Record<string, number>;
  toolLineLimits?: Record<string, number>;
}

/**
 * Full truncation pipeline for a single tool's output.
 *
 * Step 1: character-based truncation (always runs first).
 * Step 2: line-based truncation (secondary, only if a line limit applies).
 */
export function truncateToolOutput(
  output: string,
  toolName: string,
  config: TruncationConfig,
): string {
  // Step 1: Character-based truncation
  const maxChars =
    config.toolOutputLimits?.[toolName] ??
    DEFAULT_CHAR_LIMITS[toolName] ??
    30_000;
  const mode: "head_tail" | "tail" =
    DEFAULT_TRUNCATION_MODES[toolName] ?? "head_tail";
  let result = truncateOutput(output, maxChars, mode);

  // Step 2: Line-based truncation
  const maxLines =
    config.toolLineLimits?.[toolName] ??
    DEFAULT_LINE_LIMITS[toolName] ??
    null;
  if (maxLines !== null) {
    result = truncateLines(result, maxLines);
  }

  return result;
}
