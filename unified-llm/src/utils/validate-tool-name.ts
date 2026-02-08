const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const MAX_LENGTH = 64;

export function validateToolName(name: string): string | undefined {
  if (name.length === 0) {
    return "tool name must not be empty";
  }
  if (name.length > MAX_LENGTH) {
    return `tool name must be at most ${MAX_LENGTH} characters`;
  }
  if (!TOOL_NAME_RE.test(name)) {
    return "tool name must start with a letter and contain only letters, digits, and underscores";
  }
  return undefined;
}
