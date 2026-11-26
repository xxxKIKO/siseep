import { MongoMemoryReplSet } from 'mongodb-memory-server';

/** Starts one in-memory replica set for the whole run (transactions need a replica set). */
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: 'rs0' } });
  (globalThis as { __MONGO_REPLSET__?: MongoMemoryReplSet }).__MONGO_REPLSET__ = replSet;
  process.env.MONGO_TEST_BASE_URI = replSet.getUri();
}
