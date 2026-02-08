import { describe, test, expect } from "bun:test";
import { validateToolName } from "../../src/utils/validate-tool-name.js";

describe("validateToolName", () => {
  test("accepts valid simple name", () => {
    expect(validateToolName("getWeather")).toBeUndefined();
  });

  test("accepts name with underscores and digits", () => {
    expect(validateToolName("get_weather_2")).toBeUndefined();
  });

  test("accepts single letter", () => {
    expect(validateToolName("a")).toBeUndefined();
  });

  test("rejects empty string", () => {
    expect(validateToolName("")).toBe("tool name must not be empty");
  });

  test("rejects name starting with digit", () => {
    expect(validateToolName("2fast")).toBe(
      "tool name must start with a letter and contain only letters, digits, and underscores",
    );
  });

  test("rejects name starting with underscore", () => {
    expect(validateToolName("_private")).toBe(
      "tool name must start with a letter and contain only letters, digits, and underscores",
    );
  });

  test("rejects name with hyphens", () => {
    expect(validateToolName("get-weather")).toBe(
      "tool name must start with a letter and contain only letters, digits, and underscores",
    );
  });

  test("rejects name with spaces", () => {
    expect(validateToolName("get weather")).toBe(
      "tool name must start with a letter and contain only letters, digits, and underscores",
    );
  });

  test("rejects name with special characters", () => {
    expect(validateToolName("get@weather")).toBe(
      "tool name must start with a letter and contain only letters, digits, and underscores",
    );
  });

  test("rejects name exceeding 64 characters", () => {
    const longName = "a" + "b".repeat(64);
    expect(validateToolName(longName)).toBe(
      "tool name must be at most 64 characters",
    );
  });

  test("accepts name exactly 64 characters", () => {
    const exactName = "a" + "b".repeat(63);
    expect(validateToolName(exactName)).toBeUndefined();
  });
});
