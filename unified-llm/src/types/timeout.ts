export interface TimeoutConfig {
  total?: number;
  perStep?: number;
}

export interface AdapterTimeout {
  request: number;
  streamRead: number;
}
