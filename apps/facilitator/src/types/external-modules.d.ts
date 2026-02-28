declare module '@tableland/sdk' {
  export class Database {
    constructor(config?: Record<string, unknown>);
    prepare(statement: string): {
      bind: (...args: unknown[]) => {
        all: () => Promise<{ results?: Array<Record<string, unknown>> }>;
        run: () => Promise<unknown>;
      };
      all: () => Promise<{ results?: Array<Record<string, unknown>> }>;
      run: () => Promise<unknown>;
    };
  }
}

declare module '@lit-protocol/constants' {
  export const LIT_NETWORK: Record<string, string>;
}

declare module '@lit-protocol/encryption' {
  export function encryptString(
    args: Record<string, unknown>,
    client: unknown,
  ): Promise<{ ciphertext: string; dataToEncryptHash: string }>;
  export function decryptToString(
    args: Record<string, unknown>,
    client: unknown,
  ): Promise<string>;
}

declare module '@lit-protocol/lit-node-client' {
  export class LitNodeClient {
    constructor(config?: Record<string, unknown>);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  }
}

declare module 'redis' {
  export type RedisClientType = {
    connect: () => Promise<void>;
    quit: () => Promise<void>;
    on: (event: string, listener: (err: unknown) => void) => void;
    rPush: (key: string, value: string) => Promise<unknown>;
    expire: (key: string, seconds: number) => Promise<unknown>;
    lLen: (key: string) => Promise<number>;
    lRange: (key: string, start: number, stop: number) => Promise<string[]>;
    hSet: (key: string, field: string, value: string) => Promise<unknown>;
    hGet: (key: string, field: string) => Promise<string | null>;
  };
  export function createClient(config?: Record<string, unknown>): RedisClientType;
}
