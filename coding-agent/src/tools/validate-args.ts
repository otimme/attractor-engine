/**
 * Simple JSON Schema validator for tool arguments.
 *
 * Handles the subset of JSON Schema used by tool definitions:
 * top-level "object" type with primitive properties (string, integer, boolean)
 * and a required array.
 */

interface SchemaProperty {
  type?: string;
}

interface ToolSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/**
 * Validate tool arguments against a JSON Schema definition.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateToolArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  const typed = schema as ToolSchema;

  // Only validate object schemas with properties
  if (typed.type !== "object" || typed.properties === undefined) {
    return null;
  }

  // Check required fields
  if (typed.required !== undefined) {
    for (const field of typed.required) {
      if (!(field in args)) {
        return `missing required field "${field}"`;
      }
    }
  }

  // Check types for provided fields
  for (const [key, value] of Object.entries(args)) {
    const propSchema = typed.properties[key];
    if (propSchema === undefined) {
      continue; // allow extra properties
    }

    if (propSchema.type === undefined) {
      continue;
    }

    const typeError = checkType(value, propSchema.type, key);
    if (typeError !== null) {
      return typeError;
    }
  }

  return null;
}

function checkType(value: unknown, expectedType: string, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null; // null/undefined handled by required check
  }

  switch (expectedType) {
    case "string":
      if (typeof value !== "string") {
        return `expected "${fieldName}" to be string, got ${typeof value}`;
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `expected "${fieldName}" to be integer, got ${typeof value === "number" ? "float" : typeof value}`;
      }
      break;
    case "number":
      if (typeof value !== "number") {
        return `expected "${fieldName}" to be number, got ${typeof value}`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `expected "${fieldName}" to be boolean, got ${typeof value}`;
      }
      break;
  }

  return null;
}
