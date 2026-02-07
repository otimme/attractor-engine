import { describe, test, expect } from "bun:test";
import { filterEnvironmentVariables } from "../../src/env/env-filter.js";

describe("filterEnvironmentVariables", () => {
  test("includes normal variables", () => {
    const result = filterEnvironmentVariables({
      PATH: "/usr/bin",
      HOME: "/home/user",
      MY_CUSTOM_VAR: "hello",
    });

    expect(result["PATH"]).toBe("/usr/bin");
    expect(result["HOME"]).toBe("/home/user");
    expect(result["MY_CUSTOM_VAR"]).toBe("hello");
  });

  test("excludes variables matching _API_KEY suffix", () => {
    const result = filterEnvironmentVariables({
      OPENAI_API_KEY: "sk-secret",
      STRIPE_API_KEY: "rk_test_123",
    });

    expect(result["OPENAI_API_KEY"]).toBeUndefined();
    expect(result["STRIPE_API_KEY"]).toBeUndefined();
  });

  test("excludes variables matching _SECRET suffix", () => {
    const result = filterEnvironmentVariables({
      CLIENT_SECRET: "s3cr3t",
    });

    expect(result["CLIENT_SECRET"]).toBeUndefined();
  });

  test("excludes variables matching _TOKEN suffix", () => {
    const result = filterEnvironmentVariables({
      AUTH_TOKEN: "tok_abc",
    });

    expect(result["AUTH_TOKEN"]).toBeUndefined();
  });

  test("excludes variables matching _PASSWORD suffix", () => {
    const result = filterEnvironmentVariables({
      DB_PASSWORD: "p@ssw0rd",
    });

    expect(result["DB_PASSWORD"]).toBeUndefined();
  });

  test("excludes variables matching _CREDENTIAL suffix", () => {
    const result = filterEnvironmentVariables({
      GCP_CREDENTIAL: "cred-data",
    });

    expect(result["GCP_CREDENTIAL"]).toBeUndefined();
  });

  test("excludes exact-match sensitive names", () => {
    const result = filterEnvironmentVariables({
      API_KEY: "key",
      SECRET: "shh",
      TOKEN: "tok",
      PASSWORD: "pw",
      AWS_SECRET_ACCESS_KEY: "aws-key",
      AWS_SESSION_TOKEN: "aws-tok",
      DATABASE_URL: "postgres://...",
    });

    expect(Object.keys(result).length).toBe(0);
  });

  test("sensitive pattern matching is case-insensitive", () => {
    const result = filterEnvironmentVariables({
      my_api_key: "lower",
      My_Api_Key: "mixed",
      database_url: "pg://lower",
    });

    expect(result["my_api_key"]).toBeUndefined();
    expect(result["My_Api_Key"]).toBeUndefined();
    expect(result["database_url"]).toBeUndefined();
  });

  test("ALWAYS_INCLUDE overrides sensitive patterns", () => {
    // NODE_PATH is in ALWAYS_INCLUDE; even if it somehow matched, it should still be included
    const result = filterEnvironmentVariables({
      NODE_PATH: "/usr/lib/node",
      PATH: "/usr/bin",
    });

    expect(result["NODE_PATH"]).toBe("/usr/lib/node");
    expect(result["PATH"]).toBe("/usr/bin");
  });

  test("skips undefined values", () => {
    const result = filterEnvironmentVariables({
      DEFINED_VAR: "yes",
      UNDEFINED_VAR: undefined,
    });

    expect(result["DEFINED_VAR"]).toBe("yes");
    expect("UNDEFINED_VAR" in result).toBe(false);
  });

  test("returns a clean new object with no undefined values", () => {
    const input = {
      HOME: "/home/user",
      MISSING: undefined,
      OPENAI_API_KEY: "secret",
      CUSTOM: "value",
    };

    const result = filterEnvironmentVariables(input);

    // Should only have HOME and CUSTOM
    expect(Object.keys(result).sort()).toEqual(["CUSTOM", "HOME"]);

    // No value should be undefined
    for (const val of Object.values(result)) {
      expect(val).toBeDefined();
      expect(typeof val).toBe("string");
    }
  });
});
