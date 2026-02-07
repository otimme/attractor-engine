import { describe, test, expect } from "bun:test";
import {
  truncateOutput,
  truncateLines,
  truncateToolOutput,
  DEFAULT_CHAR_LIMITS,
} from "../../src/tools/truncation.js";

describe("truncateOutput", () => {
  describe("head_tail mode", () => {
    test("short output (under limit) returns unchanged", () => {
      const result = truncateOutput("hello world", 100, "head_tail");
      expect(result).toBe("hello world");
    });

    test("exactly at limit returns unchanged", () => {
      const input = "a".repeat(100);
      const result = truncateOutput(input, 100, "head_tail");
      expect(result).toBe(input);
    });

    test("long output gets head + warning + tail", () => {
      const input = "A".repeat(50) + "B".repeat(50);
      const result = truncateOutput(input, 60, "head_tail");
      expect(result).toContain("A".repeat(30));
      expect(result).toContain("B".repeat(30));
      expect(result).toContain("[WARNING:");
      expect(result).toContain("characters were removed from the middle");
    });

    test("warning marker includes correct character count", () => {
      const input = "x".repeat(200);
      const result = truncateOutput(input, 100, "head_tail");
      // budget = 100 chars, half = 50 each side, removed = 200 - 100 = 100
      expect(result).toContain("100 characters were removed from the middle");
    });
  });

  describe("tail mode", () => {
    test("short output returns unchanged", () => {
      const result = truncateOutput("hello", 100, "tail");
      expect(result).toBe("hello");
    });

    test("long output gets warning + tail portion", () => {
      const input = "A".repeat(50) + "B".repeat(50);
      const result = truncateOutput(input, 60, "tail");
      // Should keep last 60 chars
      expect(result).toContain("B".repeat(50));
      expect(result).toContain("[WARNING:");
      expect(result).toContain("characters were removed");
    });

    test("warning includes correct removed count", () => {
      const input = "x".repeat(200);
      const result = truncateOutput(input, 50, "tail");
      expect(result).toContain("First 150 characters were removed");
    });
  });
});

describe("truncateLines", () => {
  test("under limit returns unchanged", () => {
    const input = "line1\nline2\nline3";
    const result = truncateLines(input, 5);
    expect(result).toBe(input);
  });

  test("over limit gets head lines + omitted marker + tail lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const input = lines.join("\n");
    const result = truncateLines(input, 4);
    // half = 2, keep first 2 and last 2
    expect(result).toContain("line0");
    expect(result).toContain("line1");
    expect(result).toContain("line8");
    expect(result).toContain("line9");
    expect(result).toContain("[... 6 lines omitted ...]");
  });

  test("marker shows correct omitted count", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const input = lines.join("\n");
    const result = truncateLines(input, 6);
    // half = 3, omitted = 20 - 6 = 14
    expect(result).toContain("[... 14 lines omitted ...]");
  });

  test("single line is never truncated", () => {
    const input = "just one line";
    const result = truncateLines(input, 1);
    expect(result).toBe(input);
  });
});

describe("truncateToolOutput", () => {
  test("uses correct default limits per tool", () => {
    const longOutput = "x".repeat(60_000);
    const readResult = truncateToolOutput(longOutput, "read_file", {});
    // read_file default is 50k chars, head_tail mode
    expect(readResult).toContain("characters were removed from the middle");

    const grepResult = truncateToolOutput(longOutput, "grep", {});
    // grep default is 20k chars, tail mode
    expect(grepResult).toContain("characters were removed");
  });

  test("custom limits from config override defaults", () => {
    const longOutput = "x".repeat(200);
    const result = truncateToolOutput(longOutput, "read_file", {
      toolOutputLimits: { read_file: 50 },
    });
    expect(result).toContain("[WARNING:");
    expect(result.length).toBeLessThan(longOutput.length + 200);
  });

  test("character truncation runs BEFORE line truncation", () => {
    // Two very long lines — character truncation should catch this
    const longLine = "x".repeat(50_000);
    const input = longLine + "\n" + longLine;
    const result = truncateToolOutput(input, "shell", {});
    // shell has 30k char limit and 256 line limit
    // char truncation runs first, then line truncation
    expect(result).toContain("[WARNING:");
  });

  test("pathological case: 2 very long lines caught by char truncation", () => {
    const longLine = "x".repeat(40_000);
    const input = longLine + "\n" + longLine;
    // Only 2 lines, but 80k chars — should be char-truncated
    const result = truncateToolOutput(input, "grep", {});
    expect(result).toContain("[WARNING:");
  });

  test("unknown tool name falls back to 30k default", () => {
    const longOutput = "x".repeat(40_000);
    const result = truncateToolOutput(longOutput, "unknown_tool", {});
    expect(result).toContain("[WARNING:");
    // head_tail mode (default fallback)
    expect(result).toContain("characters were removed from the middle");
  });

  test("line truncation applies after character truncation", () => {
    // Create output with many short lines that's under char limit
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const input = lines.join("\n");
    // shell has 256 line limit
    const result = truncateToolOutput(input, "shell", {});
    expect(result).toContain("[...");
    expect(result).toContain("lines omitted");
  });

  test("custom line limits from config override defaults", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const input = lines.join("\n");
    const result = truncateToolOutput(input, "shell", {
      toolLineLimits: { shell: 10 },
    });
    expect(result).toContain("[...");
    expect(result).toContain("lines omitted");
  });
});
