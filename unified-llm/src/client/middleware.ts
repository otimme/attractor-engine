import type { Request } from "../types/request.js";
import type { Response } from "../types/response.js";
import type { StreamEvent } from "../types/stream-event.js";

export type NextFn = (request: Request) => Promise<Response>;
export type StreamNextFn = (request: Request) => AsyncGenerator<StreamEvent>;

export interface Middleware {
  complete?: (request: Request, next: NextFn) => Promise<Response>;
  stream?: (
    request: Request,
    next: StreamNextFn,
  ) => AsyncGenerator<StreamEvent>;
}

export function buildMiddlewareChain(
  middlewares: Middleware[],
  handler: NextFn,
): NextFn {
  let chain = handler;
  for (const mw of [...middlewares].reverse()) {
    if (mw.complete) {
      const next = chain;
      const completeFn = mw.complete;
      chain = (request) => completeFn(request, next);
    }
  }
  return chain;
}

export function buildStreamMiddlewareChain(
  middlewares: Middleware[],
  handler: StreamNextFn,
): StreamNextFn {
  let chain = handler;
  for (const mw of [...middlewares].reverse()) {
    if (mw.stream) {
      const next = chain;
      const streamFn = mw.stream;
      chain = (request) => streamFn(request, next);
    }
  }
  return chain;
}
