// ============================================================
//  @arcenpay/agent — Persistent Store Implementations
// ============================================================

import type { PersistentStore } from './agent';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Filesystem-based persistent store.
 * Stores agent state (nonce, sessionId, totalSpent) in a JSON file.
 *
 * @example
 * ```ts
 * import { ArcenAgent, FileStore } from '@arcenpay/agent';
 *
 * const store = new FileStore('/var/arcenpay/agent-state.json');
 * const agent = new ArcenAgent({
 *   privateKey: process.env.AGENT_PRIVATE_KEY!,
 *   rpcUrl: 'https://mainnet.base.org',
 *   chainId: 8453,
 *   store,
 * });
 * await agent.restore(); // Load persisted nonce/session
 * ```
 */
export class FileStore implements PersistentStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async get(key: string): Promise<string | null> {
    try {
      if (!existsSync(this.filePath)) return null;
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, string>;
      return data[key] ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let data: Record<string, string> = {};
    try {
      if (existsSync(this.filePath)) {
        data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      // Start fresh if file is corrupted
    }

    data[key] = value;
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async delete(key: string): Promise<void> {
    try {
      if (!existsSync(this.filePath)) return;
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, string>;
      delete data[key];
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore errors on delete
    }
  }
}
