import type { SessionEvent } from "../types/events.js";

interface Consumer {
  queue: SessionEvent[];
  waiters: Array<(event: SessionEvent | null) => void>;
  closed: boolean;
}

export class EventEmitter {
  private consumers: Consumer[] = [];

  emit(event: SessionEvent): void {
    for (const consumer of this.consumers) {
      if (consumer.closed) continue;

      const waiter = consumer.waiters.shift();
      if (waiter) {
        waiter(event);
      } else {
        consumer.queue.push(event);
      }
    }
  }

  events(): AsyncGenerator<SessionEvent> {
    // Register the consumer eagerly so events emitted before
    // the first next() call are captured in the queue.
    const consumer: Consumer = { queue: [], waiters: [], closed: false };
    this.consumers.push(consumer);
    const consumers = this.consumers;

    async function* generate(): AsyncGenerator<SessionEvent> {
      try {
        while (!consumer.closed) {
          const queued = consumer.queue.shift();
          if (queued) {
            yield queued;
          } else {
            const event = await new Promise<SessionEvent | null>((resolve) => {
              consumer.waiters.push(resolve);
            });
            if (event === null) break;
            yield event;
          }
        }
      } finally {
        consumer.closed = true;
        const idx = consumers.indexOf(consumer);
        if (idx >= 0) consumers.splice(idx, 1);
      }
    }

    return generate();
  }

  close(): void {
    for (const consumer of this.consumers) {
      consumer.closed = true;
      for (const waiter of consumer.waiters) {
        waiter(null);
      }
      consumer.waiters.length = 0;
    }
  }
}
