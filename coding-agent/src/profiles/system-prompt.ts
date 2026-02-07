import type { ExecutionEnvironment } from "../types/index.js";

const PROJECT_DOCS_BUDGET = 32 * 1024;

export function buildEnvironmentContext(env: ExecutionEnvironment): string {
  const date = new Date().toISOString().split("T")[0];
  return [
    "<environment>",
    `Working directory: ${env.workingDirectory()}`,
    `Platform: ${env.platform()}`,
    `OS version: ${env.osVersion()}`,
    `Today's date: ${date}`,
    "</environment>",
  ].join("\n");
}

export async function discoverProjectDocs(
  env: ExecutionEnvironment,
  providerFileNames: string[],
): Promise<string> {
  const cwd = env.workingDirectory();
  const candidates = ["AGENTS.md", ...providerFileNames];
  const parts: string[] = [];
  let totalLength = 0;

  for (const name of candidates) {
    const path = cwd.endsWith("/") ? `${cwd}${name}` : `${cwd}/${name}`;
    const exists = await env.fileExists(path);
    if (!exists) continue;

    const numbered = await env.readFile(path);
    // Strip line numbers from env.readFile output
    const content = numbered
      .split("\n")
      .map((line) => {
        const pipeIndex = line.indexOf(" | ");
        return pipeIndex >= 0 ? line.slice(pipeIndex + 3) : line;
      })
      .join("\n");

    if (totalLength + content.length > PROJECT_DOCS_BUDGET) {
      const remaining = PROJECT_DOCS_BUDGET - totalLength;
      if (remaining > 0) {
        parts.push(content.slice(0, remaining));
        parts.push("[Project instructions truncated at 32KB]");
      }
      break;
    }

    parts.push(content);
    totalLength += content.length;
  }

  return parts.join("\n\n");
}

export function buildSystemPrompt(
  basePrompt: string,
  envContext: string,
  toolDescriptions: string,
  projectDocs: string,
  userInstructions?: string,
): string {
  const sections = [basePrompt, envContext, toolDescriptions, projectDocs];
  if (userInstructions) {
    sections.push(userInstructions);
  }
  return sections.filter((s) => s.length > 0).join("\n\n");
}
