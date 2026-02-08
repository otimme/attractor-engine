type ErrorClassification =
  | "content_filter"
  | "quota"
  | "context_length"
  | "not_found"
  | "auth";

const patterns: [RegExp, ErrorClassification][] = [
  [/content filter|safety|content policy|blocked/i, "content_filter"],
  [/quota|billing|payment required/i, "quota"],
  [/context length|too many tokens|maximum context/i, "context_length"],
  [/not found|does not exist/i, "not_found"],
  [/unauthorized|invalid key|invalid api key/i, "auth"],
];

export function classifyByMessage(
  message: string,
): ErrorClassification | undefined {
  for (const [pattern, classification] of patterns) {
    if (pattern.test(message)) {
      return classification;
    }
  }
  return undefined;
}
