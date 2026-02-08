import { describe, test, expect } from "bun:test";
import { validateToolArgs } from "../../src/tools/validate-args.js";

const readFileSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    file_path: { type: "string" },
    offset: { type: "integer" },
    limit: { type: "integer" },
  },
  required: ["file_path"],
};

describe("validateToolArgs", () => {
  test("returns null for valid args with all required fields", () => {
    const result = validateToolArgs(
      { file_path: "/test/foo.ts" },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns null for valid args with optional fields", () => {
    const result = validateToolArgs(
      { file_path: "/test/foo.ts", offset: 10, limit: 50 },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns error for missing required field", () => {
    const result = validateToolArgs({}, readFileSchema);
    expect(result).toBe('missing required field "file_path"');
  });

  test("returns error for wrong type (string expected, got number)", () => {
    const result = validateToolArgs(
      { file_path: 123 },
      readFileSchema,
    );
    expect(result).toBe('expected "file_path" to be string, got number');
  });

  test("returns error for wrong type (integer expected, got string)", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: "ten" },
      readFileSchema,
    );
    expect(result).toBe('expected "offset" to be integer, got string');
  });

  test("returns error for float when integer expected", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: 3.5 },
      readFileSchema,
    );
    expect(result).toBe('expected "offset" to be integer, got float');
  });

  test("allows extra properties not in schema", () => {
    const result = validateToolArgs(
      { file_path: "/test", extra_prop: "hello" },
      readFileSchema,
    );
    expect(result).toBeNull();
  });

  test("returns null for non-object schema (skip validation)", () => {
    const result = validateToolArgs(
      { anything: "goes" },
      { type: "string" },
    );
    expect(result).toBeNull();
  });

  test("returns null for schema without properties (skip validation)", () => {
    const result = validateToolArgs(
      { anything: "goes" },
      { type: "object" },
    );
    expect(result).toBeNull();
  });

  test("validates boolean type correctly", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        flag: { type: "boolean" },
      },
      required: ["flag"],
    };
    expect(validateToolArgs({ flag: true }, schema)).toBeNull();
    expect(validateToolArgs({ flag: "true" }, schema)).toBe(
      'expected "flag" to be boolean, got string',
    );
  });

  test("validates number type correctly", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        value: { type: "number" },
      },
      required: ["value"],
    };
    expect(validateToolArgs({ value: 3.14 }, schema)).toBeNull();
    expect(validateToolArgs({ value: 42 }, schema)).toBeNull();
    expect(validateToolArgs({ value: "42" }, schema)).toBe(
      'expected "value" to be number, got string',
    );
  });

  test("allows null/undefined values for optional fields", () => {
    const result = validateToolArgs(
      { file_path: "/test", offset: undefined },
      readFileSchema,
    );
    expect(result).toBeNull();
  });
});
