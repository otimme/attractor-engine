import {
  parse,
  PipelineRunner,
  createHandlerRegistry,
  StartHandler,
  ExitHandler,
  CodergenHandler,
  ConditionalHandler,
  ClaudeCodeBackend,
  AutoApproveInterviewer,
  PipelineEventEmitter,
  PipelineEventKind,
  StageStatus,
} from "./attractor/src/index.js";

const dot = `
digraph ClaudeTest {
    graph [goal="Verify Claude Code backend works with Attractor"]
    start [shape=Mdiamond]
    exit  [shape=Msquare]
    task  [label="Ask Claude", prompt="Reply with exactly: Dark Factory is online"]
    start -> task -> exit
}`;

const graph = parse(dot);
const registry = createHandlerRegistry();
registry.register("start", new StartHandler());
registry.register("exit", new ExitHandler());
registry.register("conditional", new ConditionalHandler());

const emitter = new PipelineEventEmitter();
const backend = new ClaudeCodeBackend();
registry.register("codergen", new CodergenHandler(backend));
const runner = new PipelineRunner({ handlerRegistry: registry, interviewer: new AutoApproveInterviewer(), eventEmitter: emitter });

(async () => {
  for await (const event of emitter.events()) {
    if (event.kind === PipelineEventKind.STAGE_STARTED) {
      console.log(`  -> Running: ${event.data["nodeId"]}`);
    }
    if (event.kind === PipelineEventKind.STAGE_COMPLETED) {
      const nodeId = event.data["nodeId"];
      const outcome = event.data["outcome"];
      const response = event.data["response"];
      console.log(`  -> Completed: ${nodeId}`);
      console.log(`     Outcome status: ${outcome?.status ?? "n/a"}`);
      console.log(`     Response: ${JSON.stringify(response)?.substring(0, 300) ?? "none"}`);
    }
    if (event.kind === PipelineEventKind.PIPELINE_COMPLETED) {
      console.log("  -> Pipeline finished!");
    }
  }
})();

const startTime = Date.now();
const result = await runner.run(graph);
const elapsed = Date.now() - startTime;
console.log(`\nElapsed: ${elapsed}ms`);
console.log("Status:", result.outcome.status);
console.log("Failure reason:", result.outcome.failureReason ?? "none");
console.log("Nodes completed:", result.completedNodes);
console.log("Context keys:", [...result.context.keys()]);
