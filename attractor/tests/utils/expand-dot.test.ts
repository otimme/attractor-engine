import { describe, test, expect } from "bun:test";
import { expandDotForVisualization } from "../../src/utils/expand-dot.js";
import { parse } from "../../src/parser/index.js";
import { resolve, dirname } from "path";

// sub_pipeline paths in DOT files are relative to the engine root directory
const ENGINE_DIR = resolve(import.meta.dir, "../../..");
const PIPELINES_DIR = resolve(ENGINE_DIR, "pipelines/dark-factory");

function readDot(name: string): string {
  return require("fs").readFileSync(resolve(PIPELINES_DIR, name), "utf-8");
}

describe("expandDotForVisualization", () => {
  test("expands master-web.dot into valid DOT", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    // Must be parseable DOT
    const graph = parse(expanded);
    expect(graph.name).toBe("dark_factory_web");
  });

  test("contains cluster for dev_agent_web sub-pipeline", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("subgraph cluster_dev_agent_web");
  });

  test("contains cluster for test_agent sub-pipeline", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("subgraph cluster_test_agent");
  });

  test("contains cluster for holdout sub-pipeline", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("subgraph cluster_holdout");
  });

  test("contains inner nodes from dev-agent-web with prefixed IDs", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("dev_agent_web_read_spec");
    expect(expanded).toContain("dev_agent_web_architect");
    expect(expanded).toContain("dev_agent_web_build");
    expect(expanded).toContain("dev_agent_web_review");
    expect(expanded).toContain("dev_agent_web_unit_test");
    expect(expanded).toContain("dev_agent_web_fix");
    expect(expanded).toContain("dev_agent_web_fix_review");
  });

  test("contains inner nodes from test-agent with prefixed IDs", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("test_agent_read_scenarios");
    expect(expanded).toContain("test_agent_run_scenarios");
    expect(expanded).toContain("test_agent_report");
  });

  test("contains inner nodes from holdout with prefixed IDs", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    expect(expanded).toContain("holdout_run_holdout");
  });

  test("preserves conditional edge labels", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    // From dev-agent-web.dot inner edges
    expect(expanded).toContain("Issues found");
    expect(expanded).toContain("Clean");
    expect(expanded).toContain("Fix");
    expect(expanded).toContain("Retest");

    // From master-web.dot outer edges
    expect(expanded).toContain("Not converged");
    expect(expanded).toContain("Converged");
  });

  test("does not contain start/exit nodes from sub-pipelines", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    // The expanded graph should not have sub-pipeline start/exit as separate nodes
    // But the top-level start/exit should remain
    expect(expanded).toContain("start");
    expect(expanded).toContain("exit");

    // Sub-pipeline start/exit should NOT appear as prefixed nodes
    expect(expanded).not.toContain("dev_agent_web_start");
    expect(expanded).not.toContain("dev_agent_web_exit");
    expect(expanded).not.toContain("test_agent_start");
    expect(expanded).not.toContain("test_agent_exit");
    expect(expanded).not.toContain("holdout_start");
    expect(expanded).not.toContain("holdout_exit");
  });

  test("edges connect through sub-pipeline boundaries correctly", () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    // start -> first node of dev_agent_web (read_spec)
    expect(expanded).toContain("start -> dev_agent_web_read_spec");

    // last node of dev_agent_web -> first node of test_agent
    // dev_agent_web exits from unit_test (success) or fix (give up)
    // test_agent enters at read_scenarios
    expect(expanded).toContain("-> test_agent_read_scenarios");

    // last node of holdout -> exit
    // holdout exits from run_holdout
    expect(expanded).toContain("holdout_run_holdout -> exit");
  });

  test("handles simple DOT without sub-pipelines", () => {
    const simpleDot = `digraph simple {
      start [shape=Mdiamond]
      work [label="Do Work"]
      exit [shape=Msquare]
      start -> work -> exit
    }`;

    const expanded = expandDotForVisualization(simpleDot, "/tmp");
    const graph = parse(expanded);
    expect(graph.nodes.size).toBeGreaterThanOrEqual(3);
  });

  test("expanded DOT renders with Graphviz", async () => {
    const dotSource = readDot("master-web.dot");
    const expanded = expandDotForVisualization(dotSource, ENGINE_DIR);

    const proc = Bun.spawn(["dot", "-Tsvg"], {
      stdin: new Blob([expanded]),
      stdout: "pipe",
      stderr: "pipe",
    });

    const svg = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(svg).toContain("<svg");
    expect(svg).toContain("dev_agent_web_read_spec");
  });
});
