export const EventKind = {
  SESSION_START: "session_start",
  SESSION_END: "session_end",
  USER_INPUT: "user_input",
  ASSISTANT_TEXT_START: "assistant_text_start",
  ASSISTANT_TEXT_DELTA: "assistant_text_delta",
  ASSISTANT_TEXT_END: "assistant_text_end",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_OUTPUT_DELTA: "tool_call_output_delta",
  TOOL_CALL_END: "tool_call_end",
  STEERING_INJECTED: "steering_injected",
  TURN_LIMIT: "turn_limit",
  LOOP_DETECTION: "loop_detection",
  WARNING: "warning",
  ERROR: "error",
} as const;

export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface SessionEvent {
  kind: EventKind;
  timestamp: Date;
  sessionId: string;
  data: Record<string, unknown>;
}
