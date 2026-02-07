import type { RegisteredTool, ExecutionEnvironment } from "../types/index.js";

export interface PatchOperation {
  kind: "add" | "delete" | "update";
  path: string;
  newPath?: string;
  content?: string;
  hunks?: Hunk[];
}

export interface Hunk {
  contextHint: string;
  lines: HunkLine[];
}

export interface HunkLine {
  kind: "context" | "add" | "delete";
  content: string;
}

export function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.split("\n");
  let i = 0;

  // Find "*** Begin Patch"
  while (i < lines.length && lines[i]?.trim() !== "*** Begin Patch") {
    i++;
  }
  if (i >= lines.length) {
    throw new Error("Invalid patch: missing '*** Begin Patch'");
  }
  i++; // skip Begin Patch line

  const operations: PatchOperation[] = [];

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "*** End Patch") {
      break;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length) {
        const cl = lines[i] ?? "";
        if (cl.startsWith("*** ") || cl.startsWith("@@ ")) break;
        if (cl.startsWith("+")) {
          contentLines.push(cl.slice(1));
        }
        i++;
      }
      operations.push({ kind: "add", path, content: contentLines.join("\n") });
    } else if (line.startsWith("*** Delete File: ")) {
      const path = line.slice("*** Delete File: ".length).trim();
      operations.push({ kind: "delete", path });
      i++;
    } else if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim();
      i++;

      let newPath: string | undefined;
      if (i < lines.length && (lines[i] ?? "").startsWith("*** Move to: ")) {
        newPath = (lines[i] ?? "").slice("*** Move to: ".length).trim();
        i++;
      }

      const hunks: Hunk[] = [];
      while (i < lines.length) {
        const hl = lines[i] ?? "";
        if (hl.startsWith("*** ")) break;
        if (hl.startsWith("@@ ")) {
          const contextHint = hl.slice(3).trim();
          i++;
          const hunkLines: HunkLine[] = [];
          while (i < lines.length) {
            const hunkLine = lines[i] ?? "";
            if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("*** ")) break;
            if (hunkLine.startsWith("+")) {
              hunkLines.push({ kind: "add", content: hunkLine.slice(1) });
            } else if (hunkLine.startsWith("-")) {
              hunkLines.push({ kind: "delete", content: hunkLine.slice(1) });
            } else if (hunkLine.startsWith(" ")) {
              hunkLines.push({ kind: "context", content: hunkLine.slice(1) });
            }
            i++;
          }
          hunks.push({ contextHint, lines: hunkLines });
        } else {
          i++;
        }
      }

      const op: PatchOperation = { kind: "update", path, hunks };
      if (newPath !== undefined) {
        op.newPath = newPath;
      }
      operations.push(op);
    } else {
      i++;
    }
  }

  return operations;
}

/**
 * Strip line-number prefixes from env.readFile() output.
 */
function stripLineNumbers(numbered: string): string {
  return numbered
    .split("\n")
    .map((line) => {
      const pipeIndex = line.indexOf(" | ");
      return pipeIndex >= 0 ? line.slice(pipeIndex + 3) : line;
    })
    .join("\n");
}

export function applyHunks(content: string, hunks: Hunk[]): string {
  const fileLines = content.split("\n");

  // Apply hunks in order, tracking offset shifts
  let offset = 0;

  for (const hunk of hunks) {
    // Collect context and delete lines to form the "search pattern"
    const searchLines: string[] = [];
    for (const hl of hunk.lines) {
      if (hl.kind === "context" || hl.kind === "delete") {
        searchLines.push(hl.content);
      }
    }

    // Find the location in the file
    let matchStart = -1;
    for (let j = offset; j <= fileLines.length - searchLines.length; j++) {
      let matches = true;
      for (let k = 0; k < searchLines.length; k++) {
        if (fileLines[j + k] !== searchLines[k]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchStart = j;
        break;
      }
    }

    if (matchStart === -1) {
      throw new Error(
        `Could not find hunk location for context hint: "${hunk.contextHint}"`,
      );
    }

    // Build replacement lines
    const replacementLines: string[] = [];
    for (const hl of hunk.lines) {
      if (hl.kind === "context") {
        replacementLines.push(hl.content);
      } else if (hl.kind === "add") {
        replacementLines.push(hl.content);
      }
      // delete lines are omitted
    }

    // Splice the replacement in
    fileLines.splice(matchStart, searchLines.length, ...replacementLines);

    // Update offset to after the replacement
    offset = matchStart + replacementLines.length;
  }

  return fileLines.join("\n");
}

export async function applyPatch(
  patch: string,
  env: ExecutionEnvironment,
): Promise<string> {
  const operations = parsePatch(patch);
  const summaries: string[] = [];

  for (const op of operations) {
    switch (op.kind) {
      case "add": {
        await env.writeFile(op.path, op.content ?? "");
        summaries.push(`Added ${op.path}`);
        break;
      }
      case "delete": {
        const exists = await env.fileExists(op.path);
        if (!exists) {
          throw new Error(`Cannot delete non-existent file: ${op.path}`);
        }
        await env.execCommand(`rm ${op.path}`, 5000);
        summaries.push(`Deleted ${op.path}`);
        break;
      }
      case "update": {
        const numbered = await env.readFile(op.path);
        const rawContent = stripLineNumbers(numbered);
        const updated = applyHunks(rawContent, op.hunks ?? []);

        if (op.newPath !== undefined) {
          await env.writeFile(op.newPath, updated);
          await env.execCommand(`rm ${op.path}`, 5000);
          summaries.push(`Updated and moved ${op.path} -> ${op.newPath}`);
        } else {
          await env.writeFile(op.path, updated);
          summaries.push(`Updated ${op.path}`);
        }
        break;
      }
    }
  }

  return summaries.join("\n");
}

export function createApplyPatchTool(): RegisteredTool {
  return {
    definition: {
      name: "apply_patch",
      description:
        "Apply code changes using the patch format. Supports creating, deleting, and modifying files in a single operation.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "The patch content in v4a format" },
        },
        required: ["patch"],
      },
    },
    executor: async (args, env) => {
      const patch = args.patch as string;
      return applyPatch(patch, env);
    },
  };
}
