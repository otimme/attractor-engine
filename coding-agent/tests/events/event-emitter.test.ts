import { describe, test, expect } from "bun:test";
import { EventEmitter } from "../../src/events/event-emitter.js";
import { EventKind } from "../../src/types/events.js";
import type { SessionEvent } from "../../src/types/events.js";

function makeEvent(kind: EventKind, data?: Record<string, unknown>): SessionEvent {
  return {
    kind,
    timestamp: new Date(),
    sessionId: "test-session",
    data: data ?? {},
  };
}

describe("EventEmitter", () => {
  test("emit then consume: events queued and arrive in order", async () => {
    const emitter = new EventEmitter();
    const gen = emitter.events();

    const e1 = makeEvent(EventKind.SESSION_START, { seq: 1 });
    const e2 = makeEvent(EventKind.USER_INPUT, { seq: 2 });
    const e3 = makeEvent(EventKind.ASSISTANT_TEXT_START, { seq: 3 });

    // Emit events that queue in the consumer
    emitter.emit(e1);
    emitter.emit(e2);
    emitter.emit(e3);

    // Consume queued events
    const r1 = await gen.next();
    const r2 = await gen.next();
    const r3 = await gen.next();

    expect(r1.value).toBe(e1);
    expect(r2.value).toBe(e2);
    expect(r3.value).toBe(e3);

    emitter.close();
  });

  test("consume then emit: generator waits for events", async () => {
    const emitter = new EventEmitter();
    const gen = emitter.events();

    const event = makeEvent(EventKind.SESSION_START);

    const resultPromise = gen.next();

    // Give the generator a tick to start waiting
    await new Promise((r) => setTimeout(r, 10));

    emitter.emit(event);

    const result = await resultPromise;
    expect(result.value).toBe(event);

    emitter.close();
  });

  test("multiple consumers: all receive the same events", async () => {
    const emitter = new EventEmitter();
    const gen1 = emitter.events();
    const gen2 = emitter.events();

    const event = makeEvent(EventKind.USER_INPUT, { msg: "hello" });
    emitter.emit(event);

    const r1 = await gen1.next();
    const r2 = await gen2.next();

    expect(r1.value).toBe(event);
    expect(r2.value).toBe(event);

    emitter.close();
  });

  test("close causes generators to complete", async () => {
    const emitter = new EventEmitter();
    const gen = emitter.events();

    const donePromise = gen.next();

    await new Promise((r) => setTimeout(r, 10));
    emitter.close();

    const result = await donePromise;
    expect(result.done).toBe(true);
  });

  test("order preservation: events arrive in emit order", async () => {
    const emitter = new EventEmitter();
    const gen = emitter.events();

    const events = [
      makeEvent(EventKind.SESSION_START, { seq: 0 }),
      makeEvent(EventKind.USER_INPUT, { seq: 1 }),
      makeEvent(EventKind.ASSISTANT_TEXT_START, { seq: 2 }),
      makeEvent(EventKind.ASSISTANT_TEXT_DELTA, { seq: 3 }),
      makeEvent(EventKind.ASSISTANT_TEXT_END, { seq: 4 }),
    ];

    for (const e of events) {
      emitter.emit(e);
    }

    const received: SessionEvent[] = [];
    for (const _ of events) {
      const r = await gen.next();
      if (!r.done) received.push(r.value);
    }

    expect(received.length).toBe(events.length);
    expect(received[0]).toBe(events[0]);
    expect(received[1]).toBe(events[1]);
    expect(received[2]).toBe(events[2]);
    expect(received[3]).toBe(events[3]);
    expect(received[4]).toBe(events[4]);

    emitter.close();
  });
});
