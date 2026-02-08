import type { RegisteredTool } from "../types/index.js";
import type { DirEntry } from "../types/index.js";

function formatDirEntry(entry: DirEntry, prefix: string): string {
  const suffix = entry.isDir ? "/" : "";
  const sizeStr = entry.size !== null ? ` (${entry.size} bytes)` : "";
  return `${prefix}${entry.name}${suffix}${sizeStr}`;
}

export function createListDirTool(): RegisteredTool {
  return {
    definition: {
      name: "list_dir",
      description:
        "List the contents of a directory. Returns a tree-like listing with file sizes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the directory to list",
          },
          depth: {
            type: "integer",
            description: "How many levels deep to list (default: 1)",
            default: 1,
          },
        },
        required: ["path"],
      },
    },
    executor: async (args, env) => {
      const path = args.path as string;
      const depth = (args.depth as number | undefined) ?? 1;
      const entries = await env.listDirectory(path, depth);

      if (entries.length === 0) {
        return `${path}/ (empty)`;
      }

      const sorted = [...entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const lines = sorted.map((entry) => formatDirEntry(entry, "  "));
      return `${path}/\n${lines.join("\n")}`;
    },
  };
}

export function createWebSearchTool(): RegisteredTool {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web for information. Returns search results.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          max_results: {
            type: "integer",
            description: "Maximum number of results to return (default: 5)",
            default: 5,
          },
        },
        required: ["query"],
      },
    },
    executor: async (args, env) => {
      const query = args.query as string;
      const maxResults = (args.max_results as number | undefined) ?? 5;
      const encoded = encodeURIComponent(query);
      const command = `curl -s "https://html.duckduckgo.com/html/?q=${encoded}" | sed -n 's/.*<a rel="nofollow" class="result__a" href="\\([^"]*\\)">/\\1/p' | head -n ${maxResults}`;
      const result = await env.execCommand(command, 15_000);

      if (result.exitCode !== 0) {
        return `Search failed (exit code ${result.exitCode}):\n${result.stderr}`;
      }

      return result.stdout || "No results found.";
    },
  };
}

export function createWebFetchTool(): RegisteredTool {
  return {
    definition: {
      name: "web_fetch",
      description:
        "Fetch content from a URL and extract text.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch content from",
          },
        },
        required: ["url"],
      },
    },
    executor: async (args, env) => {
      const url = args.url as string;
      const command = `curl -sL ${JSON.stringify(url)} | head -c 50000`;
      const result = await env.execCommand(command, 30_000);

      if (result.exitCode !== 0) {
        return `Fetch failed (exit code ${result.exitCode}):\n${result.stderr}`;
      }

      return result.stdout || "No content returned.";
    },
  };
}

export function createReadManyFilesTool(): RegisteredTool {
  return {
    definition: {
      name: "read_many_files",
      description:
        "Read multiple files at once. Returns concatenated file contents with headers.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of absolute file paths to read",
          },
        },
        required: ["paths"],
      },
    },
    executor: async (args, env) => {
      const paths = args.paths as string[];
      const sections: string[] = [];

      for (const filePath of paths) {
        try {
          const content = await env.readFile(filePath);
          sections.push(`=== ${filePath} ===\n${content}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sections.push(`=== ${filePath} ===\n[ERROR: ${message}]`);
        }
      }

      return sections.join("\n\n");
    },
  };
}
