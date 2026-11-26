import { Injectable } from '@nestjs/common';
import type { GroupSummary } from '@siseep/shared';

const TTL_MS = 30_000;

/**
 * Group summaries cached 30 s per group + period (section 6: summary of 20 students × 60
 * activities in < 300 ms). Every write that changes the result invalidates the group: saving
 * grades, creating/editing/deleting activities, importing the Excel.
 *
 * In-memory per API instance: with several instances a stale value lives at most 30 s.
 */
@Injectable()
export class SummaryCache {
  private readonly entries = new Map<string, { expires: number; value: GroupSummary }>();

  private key(groupId: string, periodId: string): string {
    return `${groupId}:${periodId}`;
  }

  get(groupId: string, periodId: string): GroupSummary | null {
    const key = this.key(groupId, periodId);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(groupId: string, periodId: string, value: GroupSummary): void {
    this.entries.set(this.key(groupId, periodId), { expires: Date.now() + TTL_MS, value });
  }

  /** Drops every cached period of the group. */
  invalidateGroup(groupId: string): void {
    const prefix = `${groupId}:`;
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }
}
