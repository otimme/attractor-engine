import type { Message, ContentPart } from "unified-llm";
import { Role, userMessage, toolResultMessage } from "unified-llm";
import type { Turn } from "../types/index.js";

export function convertHistoryToMessages(history: Turn[]): Message[] {
  const messages: Message[] = [];

  for (const turn of history) {
    switch (turn.kind) {
      case "user": {
        messages.push(userMessage(turn.content));
        break;
      }
      case "assistant": {
        const parts: ContentPart[] = [];
        if (turn.reasoning) {
          parts.push({
            kind: "thinking",
            thinking: { text: turn.reasoning, redacted: false },
          });
        }
        if (turn.content) {
          parts.push({ kind: "text", text: turn.content });
        }
        for (const tc of turn.toolCalls) {
          parts.push({ kind: "tool_call", toolCall: tc });
        }
        messages.push({ role: Role.ASSISTANT, content: parts });
        break;
      }
      case "tool_results": {
        for (const r of turn.results) {
          const content =
            typeof r.content === "string"
              ? r.content
              : JSON.stringify(r.content);
          messages.push(toolResultMessage(r.toolCallId, content, r.isError));
        }
        break;
      }
      case "system": {
        messages.push(userMessage(turn.content));
        break;
      }
      case "steering": {
        messages.push(userMessage(turn.content));
        break;
      }
    }
  }

  return messages;
}

export function countTurns(history: Turn[]): number {
  let count = 0;
  for (const turn of history) {
    if (turn.kind === "user" || turn.kind === "assistant") {
      count++;
    }
  }
  return count;
}
