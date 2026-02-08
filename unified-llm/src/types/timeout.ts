export interface TimeoutConfig {
  total?: number;
  perStep?: number;
}

export interface AdapterTimeout {
  /** HTTP connection timeout in ms. Default: 10_000. */
  connect?: number;
  request: number;
  streamRead: number;
}
