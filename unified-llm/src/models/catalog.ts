import type { ModelInfo } from "../types/model-info.js";
import catalogData from "./catalog.json";

const models: ModelInfo[] = catalogData;

export function getModelInfo(
  idOrAlias: string,
): ModelInfo | undefined {
  return models.find(
    (m) => m.id === idOrAlias || m.aliases.includes(idOrAlias),
  );
}

export function listModels(provider?: string): ModelInfo[] {
  if (provider) {
    return models.filter((m) => m.provider === provider);
  }
  return [...models];
}

export function getLatestModel(
  provider: string,
  capability?: "reasoning" | "vision" | "tools",
): ModelInfo | undefined {
  let filtered = models.filter((m) => m.provider === provider);
  if (capability === "reasoning") {
    filtered = filtered.filter((m) => m.supportsReasoning);
  } else if (capability === "vision") {
    filtered = filtered.filter((m) => m.supportsVision);
  } else if (capability === "tools") {
    filtered = filtered.filter((m) => m.supportsTools);
  }
  // catalog.json entries are ordered newest-first per provider,
  // so filtered[0] is the latest model.
  return filtered[0];
}
