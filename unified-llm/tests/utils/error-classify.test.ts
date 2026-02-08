import { describe, test, expect } from "bun:test";
import { classifyByMessage } from "../../src/utils/error-classify.js";

describe("classifyByMessage", () => {
  test("returns 'content_filter' for content filter messages", () => {
    expect(classifyByMessage("content filter triggered")).toBe("content_filter");
  });

  test("returns 'content_filter' for safety messages", () => {
    expect(classifyByMessage("Safety system blocked the output")).toBe("content_filter");
  });

  test("returns 'content_filter' for content policy messages", () => {
    expect(classifyByMessage("Violates content policy")).toBe("content_filter");
  });

  test("returns 'content_filter' for blocked messages", () => {
    expect(classifyByMessage("Request was blocked")).toBe("content_filter");
  });

  test("returns 'quota' for quota messages", () => {
    expect(classifyByMessage("Quota exceeded for this project")).toBe("quota");
  });

  test("returns 'quota' for billing messages", () => {
    expect(classifyByMessage("Billing account not active")).toBe("quota");
  });

  test("returns 'quota' for payment required messages", () => {
    expect(classifyByMessage("Payment required to continue")).toBe("quota");
  });

  test("returns 'context_length' for context length messages", () => {
    expect(classifyByMessage("maximum context length exceeded")).toBe("context_length");
  });

  test("returns 'context_length' for too many tokens messages", () => {
    expect(classifyByMessage("too many tokens in request")).toBe("context_length");
  });

  test("returns 'context_length' for maximum context messages", () => {
    expect(classifyByMessage("Exceeds maximum context")).toBe("context_length");
  });

  test("returns 'not_found' for not found messages", () => {
    expect(classifyByMessage("Model not found")).toBe("not_found");
  });

  test("returns 'not_found' for does not exist messages", () => {
    expect(classifyByMessage("Resource does not exist")).toBe("not_found");
  });

  test("returns 'auth' for unauthorized messages", () => {
    expect(classifyByMessage("Unauthorized access")).toBe("auth");
  });

  test("returns 'auth' for invalid key messages", () => {
    expect(classifyByMessage("Invalid key provided")).toBe("auth");
  });

  test("returns 'auth' for invalid api key messages", () => {
    expect(classifyByMessage("Invalid API key")).toBe("auth");
  });

  test("is case-insensitive", () => {
    expect(classifyByMessage("CONTENT FILTER violation")).toBe("content_filter");
    expect(classifyByMessage("QUOTA EXCEEDED")).toBe("quota");
    expect(classifyByMessage("UNAUTHORIZED")).toBe("auth");
  });

  test("returns undefined for unrecognized messages", () => {
    expect(classifyByMessage("Something went wrong")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(classifyByMessage("")).toBeUndefined();
  });
});
