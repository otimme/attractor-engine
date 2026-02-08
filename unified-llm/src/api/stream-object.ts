import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import type { Usage } from "../types/response.js";
import { addUsage } from "../types/response.js";
import { partialJsonParse } from "../utils/json.js";
import { validateJsonSchema } from "../utils/validate-json-schema.js";
import { NoObjectGeneratedError } from "../types/errors.js";
import { stream } from "./stream.js";
import type { GenerateOptions } from "./generate.js";
import type { Client } from "../client/client.js";
import { getDefaultClient } from "../client/default-client.js";

export interface StreamObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  schema: Record<string, unknown>;
  schemaName?: string;
  strategy?: "auto" | "tool" | "json_schema";
}

const zeroUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export interface StreamObjectResult {
  partialObjectStream: AsyncGenerator<unknown>;
  object(): Promise<unknown>;
  usage: Promise<Usage>;
}

function resolveStreamStrategy(
  strategy: "auto" | "tool" | "json_schema",
  client: Client,
  provider?: string,
): "tool" | "json_schema" {
  if (strategy !== "auto") {
    return strategy;
  }
  try {
    const adapter = client.resolveProvider(provider);
    if (adapter.supportsNativeJsonSchema) {
      return "json_schema";
    }
  } catch {
    // If provider resolution fails, fall back to tool
  }
  return "tool";
}

export function streamObject(
  options: StreamObjectOptions,
): StreamObjectResult {
  const { schema, schemaName, strategy: explicitStrategy, ...streamOpts } = options;

  const resolved = resolveStreamStrategy(explicitStrategy ?? "auto", options.client ?? getDefaultClient(), options.provider);

  if (resolved === "json_schema") {
    return streamObjectWithJsonSchema({ schema, schemaName, ...streamOpts });
  }

  // Use tool extraction strategy with streaming
  const extractToolName = schemaName ?? "extract";
  const extractTool = {
    name: extractToolName,
    description: "Extract structured data",
    parameters: schema,
  };

  const result = stream({
    ...streamOpts,
    tools: [extractTool],
    toolChoice: { mode: "named" as const, toolName: extractToolName },
    maxToolRounds: 0,
  });

  let finalObject: unknown = undefined;
  let yielded = false;
  let totalUsage: Usage = { ...zeroUsage };

  let resolveObjectPromise: ((value: unknown) => void) | undefined;
  let rejectObjectPromise: ((reason: unknown) => void) | undefined;
  const objectPromise = new Promise<unknown>((resolve, reject) => {
    resolveObjectPromise = resolve;
    rejectObjectPromise = reject;
  });
  // Prevent unhandled rejection if caller never awaits object()
  objectPromise.catch(() => {});

  let resolveUsagePromise: ((value: Usage) => void) | undefined;
  const usagePromise = new Promise<Usage>((resolve) => {
    resolveUsagePromise = resolve;
  });

  const partialObjectStream = (async function* () {
    let argumentsBuffer = "";
    let lastParsed: unknown = undefined;

    try {
      for await (const event of result) {
        if (event.type === StreamEventType.TOOL_CALL_DELTA) {
          argumentsBuffer += event.argumentsDelta;
          const parsed = partialJsonParse(argumentsBuffer);
          if (parsed !== undefined && parsed !== lastParsed) {
            lastParsed = parsed;
            yielded = true;
            yield parsed;
          }
        }
        if (event.type === StreamEventType.FINISH && event.usage) {
          totalUsage = addUsage(totalUsage, event.usage);
        }
      }

      if (!yielded) {
        const err = new NoObjectGeneratedError(
          "Stream ended without producing any parsed object",
        );
        rejectObjectPromise?.(err);
        resolveUsagePromise?.(totalUsage);
        throw err;
      }

      if (lastParsed !== undefined) {
        const validation = validateJsonSchema(lastParsed, schema);
        if (!validation.valid) {
          const err = new NoObjectGeneratedError(
            `Streamed object does not match schema: ${validation.errors}`,
          );
          rejectObjectPromise?.(err);
          resolveUsagePromise?.(totalUsage);
          throw err;
        }
      }

      finalObject = lastParsed;
      resolveObjectPromise?.(finalObject);
      resolveUsagePromise?.(totalUsage);
    } catch (err) {
      rejectObjectPromise?.(err);
      resolveUsagePromise?.(totalUsage);
      throw err;
    }
  })();

  return {
    partialObjectStream,
    object: () => objectPromise,
    usage: usagePromise,
  };
}

export function streamObjectWithJsonSchema(
  options: StreamObjectOptions,
): StreamObjectResult {
  const { schema, schemaName, strategy: _strategy, ...streamOpts } = options;

  const result = stream({
    ...streamOpts,
    responseFormat: {
      type: "json_schema",
      jsonSchema: schema,
      strict: true,
    },
  });

  let finalObject: unknown = undefined;
  let yielded = false;
  let totalUsage: Usage = { ...zeroUsage };

  let resolveObjectPromise: ((value: unknown) => void) | undefined;
  let rejectObjectPromise: ((reason: unknown) => void) | undefined;
  const objectPromise = new Promise<unknown>((resolve, reject) => {
    resolveObjectPromise = resolve;
    rejectObjectPromise = reject;
  });
  // Prevent unhandled rejection if caller never awaits object()
  objectPromise.catch(() => {});

  let resolveUsagePromise: ((value: Usage) => void) | undefined;
  const usagePromise = new Promise<Usage>((resolve) => {
    resolveUsagePromise = resolve;
  });

  const partialObjectStream = (async function* () {
    let textBuffer = "";
    let lastParsed: unknown = undefined;

    try {
      for await (const event of result) {
        if (event.type === StreamEventType.TEXT_DELTA) {
          textBuffer += event.delta;
          const parsed = partialJsonParse(textBuffer);
          if (parsed !== undefined && parsed !== lastParsed) {
            lastParsed = parsed;
            yielded = true;
            yield parsed;
          }
        }
        if (event.type === StreamEventType.FINISH && event.usage) {
          totalUsage = addUsage(totalUsage, event.usage);
        }
      }

      if (!yielded) {
        const err = new NoObjectGeneratedError(
          "Stream ended without producing any parsed object",
        );
        rejectObjectPromise?.(err);
        resolveUsagePromise?.(totalUsage);
        throw err;
      }

      if (lastParsed !== undefined) {
        const validation = validateJsonSchema(lastParsed, schema);
        if (!validation.valid) {
          const err = new NoObjectGeneratedError(
            `Streamed object does not match schema: ${validation.errors}`,
          );
          rejectObjectPromise?.(err);
          resolveUsagePromise?.(totalUsage);
          throw err;
        }
      }

      finalObject = lastParsed;
      resolveObjectPromise?.(finalObject);
      resolveUsagePromise?.(totalUsage);
    } catch (err) {
      rejectObjectPromise?.(err);
      resolveUsagePromise?.(totalUsage);
      throw err;
    }
  })();

  return {
    partialObjectStream,
    object: () => objectPromise,
    usage: usagePromise,
  };
}
