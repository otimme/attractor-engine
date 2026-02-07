import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalExecutionEnvironment } from "../../src/env/local-env.js";

let tempDir: string;
let env: LocalExecutionEnvironment;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "coding-agent-test-"));
  env = new LocalExecutionEnvironment({ workingDir: tempDir });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("LocalExecutionEnvironment", () => {
  test("readFile returns formatted lines with line numbers", async () => {
    const content = "line one\nline two\nline three\n";
    await fsWriteFile(join(tempDir, "read-test.txt"), content);

    const result = await env.readFile("read-test.txt");

    expect(result).toContain("1 | line one");
    expect(result).toContain("2 | line two");
    expect(result).toContain("3 | line three");
  });

  test("readFile with offset and limit returns only requested lines", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await fsWriteFile(join(tempDir, "offset-test.txt"), lines.join("\n"));

    // offset is 1-based; get lines 3-5
    const result = await env.readFile("offset-test.txt", 3, 3);

    expect(result).toContain("line 3");
    expect(result).toContain("line 4");
    expect(result).toContain("line 5");
    expect(result).not.toContain("line 2");
    expect(result).not.toContain("line 6");
  });

  test("readFile throws for nonexistent file", async () => {
    await expect(env.readFile("does-not-exist.txt")).rejects.toThrow(
      "File not found",
    );
  });

  test("writeFile creates a file with correct content", async () => {
    await env.writeFile("write-test.txt", "hello world");

    const file = Bun.file(join(tempDir, "write-test.txt"));
    const text = await file.text();
    expect(text).toBe("hello world");
  });

  test("writeFile creates parent directories", async () => {
    await env.writeFile("nested/dir/file.txt", "nested content");

    const file = Bun.file(join(tempDir, "nested/dir/file.txt"));
    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe("nested content");
  });

  test("fileExists returns true for existing file", async () => {
    await fsWriteFile(join(tempDir, "exists-test.txt"), "hi");

    expect(await env.fileExists("exists-test.txt")).toBe(true);
  });

  test("fileExists returns false for nonexistent file", async () => {
    expect(await env.fileExists("nope.txt")).toBe(false);
  });

  test("listDirectory returns entries with correct properties", async () => {
    const subdir = join(tempDir, "list-test");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(subdir, { recursive: true });
    await fsWriteFile(join(subdir, "a.txt"), "aaa");
    await fsWriteFile(join(subdir, "b.txt"), "bbb");
    await mkdir(join(subdir, "subdir"), { recursive: true });

    const entries = await env.listDirectory("list-test");

    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(names).toContain("subdir");

    const fileEntry = entries.find((e) => e.name === "a.txt");
    expect(fileEntry?.isDir).toBe(false);
    expect(fileEntry?.size).toBe(3);

    const dirEntry = entries.find((e) => e.name === "subdir");
    expect(dirEntry?.isDir).toBe(true);
    expect(dirEntry?.size).toBeNull();
  });

  test("execCommand runs a command and captures stdout", async () => {
    const result = await env.execCommand("echo hello", 5000);

    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("execCommand captures non-zero exit code", async () => {
    const result = await env.execCommand("exit 1", 5000);

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  test("execCommand handles timeout", async () => {
    const result = await env.execCommand("sleep 10", 500);

    expect(result.timedOut).toBe(true);
  });

  test("glob finds matching files", async () => {
    const globDir = join(tempDir, "glob-test");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(globDir, { recursive: true });
    await fsWriteFile(join(globDir, "foo.ts"), "ts file");
    await fsWriteFile(join(globDir, "bar.ts"), "ts file 2");
    await fsWriteFile(join(globDir, "baz.js"), "js file");

    const results = await env.glob("*.ts", "glob-test");

    expect(results.length).toBe(2);
    expect(results).toContain("foo.ts");
    expect(results).toContain("bar.ts");
  });

  test("platform returns a valid platform string", () => {
    const platform = env.platform();
    expect(typeof platform).toBe("string");
    expect(platform.length).toBeGreaterThan(0);
  });

  test("osVersion returns a non-empty string", () => {
    const version = env.osVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });

  test("workingDirectory returns the configured dir", () => {
    expect(env.workingDirectory()).toBe(tempDir);
  });
});
