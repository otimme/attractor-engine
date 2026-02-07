import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import {
  buildEnvironmentContext,
  discoverProjectDocs,
  buildSystemPrompt,
} from "../../src/profiles/system-prompt.js";

describe("buildEnvironmentContext", () => {
  test("returns XML block with platform, working dir, and date", () => {
    const env = new StubExecutionEnvironment();
    const result = buildEnvironmentContext(env);

    expect(result).toContain("<environment>");
    expect(result).toContain("</environment>");
    expect(result).toContain("Working directory: /test");
    expect(result).toContain("Platform: darwin");
    expect(result).toContain("OS version: Test 1.0");
    // Date should be in YYYY-MM-DD format
    expect(result).toMatch(/Today's date: \d{4}-\d{2}-\d{2}/);
  });
});

describe("discoverProjectDocs", () => {
  test("finds AGENTS.md in working directory", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([["/test/AGENTS.md", "# Project Rules\nUse TypeScript."]]),
    });
    const result = await discoverProjectDocs(env, []);

    expect(result).toContain("# Project Rules");
    expect(result).toContain("Use TypeScript.");
  });

  test("loads provider-specific files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/AGENTS.md", "agents content"],
        ["/test/CLAUDE.md", "claude content"],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toContain("agents content");
    expect(result).toContain("claude content");
  });

  test("does not load unrelated provider files", async () => {
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/CLAUDE.md", "claude content"],
        ["/test/GEMINI.md", "gemini content"],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toContain("claude content");
    expect(result).not.toContain("gemini content");
  });

  test("respects 32KB budget and truncates with message", async () => {
    const largeContent = "x".repeat(30_000);
    const env = new StubExecutionEnvironment({
      files: new Map([
        ["/test/AGENTS.md", largeContent],
        ["/test/CLAUDE.md", "y".repeat(5_000)],
      ]),
    });
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result.length).toBeLessThanOrEqual(
      32 * 1024 + "[Project instructions truncated at 32KB]".length + 10,
    );
    expect(result).toContain("[Project instructions truncated at 32KB]");
  });

  test("returns empty string when no docs files exist", async () => {
    const env = new StubExecutionEnvironment();
    const result = await discoverProjectDocs(env, ["CLAUDE.md"]);

    expect(result).toBe("");
  });
});

describe("buildSystemPrompt", () => {
  test("assembles all layers in correct order", () => {
    const result = buildSystemPrompt(
      "BASE_PROMPT",
      "ENV_CONTEXT",
      "TOOL_DESCRIPTIONS",
      "PROJECT_DOCS",
    );

    const baseIdx = result.indexOf("BASE_PROMPT");
    const envIdx = result.indexOf("ENV_CONTEXT");
    const toolIdx = result.indexOf("TOOL_DESCRIPTIONS");
    const docsIdx = result.indexOf("PROJECT_DOCS");

    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThan(baseIdx);
    expect(toolIdx).toBeGreaterThan(envIdx);
    expect(docsIdx).toBeGreaterThan(toolIdx);
  });

  test("includes user instructions when provided", () => {
    const result = buildSystemPrompt(
      "BASE",
      "ENV",
      "TOOLS",
      "DOCS",
      "USER_INSTRUCTIONS",
    );

    expect(result).toContain("USER_INSTRUCTIONS");
    const docsIdx = result.indexOf("DOCS");
    const userIdx = result.indexOf("USER_INSTRUCTIONS");
    expect(userIdx).toBeGreaterThan(docsIdx);
  });

  test("omits user instructions when not provided", () => {
    const result = buildSystemPrompt("BASE", "ENV", "TOOLS", "DOCS");

    expect(result).not.toContain("undefined");
  });

  test("skips empty sections", () => {
    const result = buildSystemPrompt("BASE", "ENV", "", "DOCS");

    // Should not have triple newlines from empty section
    expect(result).not.toContain("\n\n\n");
  });
});
