import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { Collection, Connection } from 'mongoose';

interface ThrottleDoc {
  _id: string;
  hits: number;
  windowEnd: Date;
  blockedUntil: Date | null;
  /** TTL index: MongoDB removes the counter when both the window and the block are over. */
  expiresAt: Date;
}

/**
 * Login attempt counters in MongoDB, shared by every API instance (production runs 2). The
 * in-memory default would let each instance count apart: 5 attempts per instance, not in total.
 * Each hit is one atomic update, so concurrent requests cannot skip the limit.
 */
export class MongoThrottlerStorage implements ThrottlerStorage {
  private indexReady: Promise<unknown> | null = null;

  constructor(private readonly connection: Connection) {}

  private collection(): Collection<ThrottleDoc> {
    const collection = this.connection.collection<ThrottleDoc>('throttles');
    this.indexReady ??= collection
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch(() => (this.indexReady = null));
    return collection;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const collection = this.collection();
    const now = new Date();
    const id = `${throttlerName}:${key}`;
    const expired = { $or: [{ $not: ['$windowEnd'] }, { $lte: ['$windowEnd', now] }] };
    // 1) Count the hit (a new window starts when the previous one ended).
    const counted = await collection.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            hits: { $cond: [expired, 1, { $add: ['$hits', 1] }] },
            windowEnd: { $cond: [expired, new Date(now.getTime() + ttl), '$windowEnd'] },
            blockedUntil: { $ifNull: ['$blockedUntil', null] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    let doc = counted!;
    // 2) Over the limit and not blocked yet: block for blockDuration.
    const blocked = doc.blockedUntil && doc.blockedUntil > now;
    if (!blocked && doc.hits > limit) {
      doc = (await collection.findOneAndUpdate(
        { _id: id },
        { $set: { blockedUntil: new Date(now.getTime() + blockDuration) } },
        { returnDocument: 'after' },
      ))!;
    }
    const expiresAt = new Date(Math.max(doc.windowEnd.getTime(), doc.blockedUntil?.getTime() ?? 0));
    await collection.updateOne({ _id: id }, { $set: { expiresAt } });

    const isBlocked = Boolean(doc.blockedUntil && doc.blockedUntil > now);
    return {
      totalHits: doc.hits,
      timeToExpire: Math.max(0, Math.ceil((doc.windowEnd.getTime() - now.getTime()) / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked
        ? Math.ceil((doc.blockedUntil!.getTime() - now.getTime()) / 1000)
        : 0,
    };
  }
}
