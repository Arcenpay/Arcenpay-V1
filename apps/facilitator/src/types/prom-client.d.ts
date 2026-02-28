declare module 'prom-client' {
  export function collectDefaultMetrics(config?: Record<string, unknown>): void;

  export class Registry {
    contentType: string;
    metrics(): Promise<string>;
  }

  export class Counter {
    constructor(config?: Record<string, unknown>);
    inc(labels?: Record<string, string>, value?: number): void;
  }

  export class Gauge {
    constructor(config?: Record<string, unknown>);
    set(value: number): void;
  }

  export class Histogram {
    constructor(config?: Record<string, unknown>);
    startTimer(): (labels?: Record<string, string>) => void;
  }
}
