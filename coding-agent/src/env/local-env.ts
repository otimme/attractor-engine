import { mkdir, readdir, stat } from "node:fs/promises";
import { release } from "node:os";
import { join, resolve, dirname } from "node:path";
import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/index.js";
import { filterEnvironmentVariables } from "./env-filter.js";

export interface LocalEnvOptions {
  workingDir: string;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private readonly workingDir: string;

  constructor(options: LocalEnvOptions) {
    this.workingDir = options.workingDir;
  }

  private resolvePath(path: string): string {
    return resolve(this.workingDir, path);
  }

  async readFile(path: string, offset?: number, limit?: number): Promise<string> {
    const resolvedPath = this.resolvePath(path);
    const file = Bun.file(resolvedPath);

    if (!(await file.exists())) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const text = await file.text();
    const allLines = text.split("\n");

    // offset is 1-based
    const startLine = offset !== undefined ? offset - 1 : 0;
    const lineLimit = limit ?? 2000;
    const lines = allLines.slice(startLine, startLine + lineLimit);

    const lastLineNumber = startLine + lines.length;
    const padWidth = String(lastLineNumber).length;

    const formatted = lines.map((content, i) => {
      const lineNumber = String(startLine + i + 1).padStart(padWidth, " ");
      return `${lineNumber} | ${content}`;
    });

    return formatted.join("\n");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolvedPath = this.resolvePath(path);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await Bun.write(resolvedPath, content);
  }

  async fileExists(path: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(path);
    return Bun.file(resolvedPath).exists();
  }

  async listDirectory(path: string, depth?: number): Promise<DirEntry[]> {
    const resolvedPath = this.resolvePath(path);
    const effectiveDepth = depth ?? 1;
    const entries: DirEntry[] = [];

    async function walk(dir: string, currentDepth: number): Promise<void> {
      if (currentDepth > effectiveDepth) return;

      const dirEntries = await readdir(dir);
      for (const name of dirEntries) {
        const fullPath = join(dir, name);
        const stats = await stat(fullPath);
        entries.push({
          name: currentDepth === 1 ? name : join(dir.slice(resolvedPath.length + 1), name),
          isDir: stats.isDirectory(),
          size: stats.isDirectory() ? null : stats.size,
        });

        if (stats.isDirectory() && currentDepth < effectiveDepth) {
          await walk(fullPath, currentDepth + 1);
        }
      }
    }

    await walk(resolvedPath, 1);
    return entries;
  }

  async execCommand(
    command: string,
    timeoutMs: number,
    workingDir?: string,
    envVars?: Record<string, string>,
  ): Promise<ExecResult> {
    const cwd = workingDir ? this.resolvePath(workingDir) : this.workingDir;
    const filteredEnv = filterEnvironmentVariables(process.env);
    const env = envVars ? { ...filteredEnv, ...envVars } : filteredEnv;

    const startTime = Date.now();
    let timedOut = false;

    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolvePromise) => {
      killTimer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Process may already be dead
          }
        }, 2000);
        resolvePromise();
      }, timeoutMs);
    });

    // Wait for exit or timeout
    await Promise.race([proc.exited, timeoutPromise]);

    if (killTimer !== undefined) {
      clearTimeout(killTimer);
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = proc.exitCode ?? 1;
    const durationMs = Date.now() - startTime;

    return { stdout, stderr, exitCode, timedOut, durationMs };
  }

  async grep(
    pattern: string,
    path: string,
    options?: GrepOptions,
  ): Promise<string> {
    const resolvedPath = this.resolvePath(path);
    const args = ["rg", "--line-number"];

    if (options?.caseInsensitive) {
      args.push("--ignore-case");
    }
    if (options?.globFilter) {
      args.push("--glob", options.globFilter);
    }
    if (options?.maxResults !== undefined) {
      args.push("--max-count", String(options.maxResults));
    }

    args.push(pattern, resolvedPath);
    const command = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");

    const result = await this.execCommand(command, 30_000);
    return result.stdout;
  }

  async glob(pattern: string, path?: string): Promise<string[]> {
    const basePath = path ? this.resolvePath(path) : this.workingDir;
    const globber = new Bun.Glob(pattern);
    const results: Array<{ path: string; mtime: number }> = [];

    for await (const entry of globber.scan({ cwd: basePath, dot: false })) {
      const fullPath = join(basePath, entry);
      try {
        const stats = await stat(fullPath);
        results.push({ path: entry, mtime: stats.mtimeMs });
      } catch {
        // File may have been deleted between scan and stat
        results.push({ path: entry, mtime: 0 });
      }
    }

    results.sort((a, b) => b.mtime - a.mtime);
    return results.map((r) => r.path);
  }

  workingDirectory(): string {
    return this.workingDir;
  }

  platform(): string {
    return process.platform;
  }

  osVersion(): string {
    return release();
  }

  async initialize(): Promise<void> {
    // no-op
  }

  async cleanup(): Promise<void> {
    // no-op
  }
}
