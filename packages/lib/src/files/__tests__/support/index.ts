// packages/lib/src/files/__tests__/support/index.ts

/**
 * The `files/` test support kit.
 *
 * One import for every double a `files/` test needs, so no test re-derives the
 * Drizzle-shaped stub or the `tableName` workaround. Explicit named exports, no
 * `export *` — a kit whose surface is implicit is a kit that grows silently.
 *
 * The property this kit exists to make possible: **a `files/` test calls
 * `vi.mock` zero times.** Every collaborator arrives as a parameter, so there is
 * nothing left to intercept at module scope.
 */

export type { CacheBust, FakeCachePort, MakeCachePortOptions } from './cache'
export { makeCachePort } from './cache'
export type { FakeClock } from './clock'
export { DEFAULT_TEST_INSTANT, makeClock } from './clock'
export { makeCtx, makeDeps } from './ctx'
export type {
  FakeDb,
  Journal,
  JournalChannel,
  JournalEntry,
  MakeDbOptions,
} from './db'
export { makeDb, makeJournal, tableName } from './db'
export type { TestOrg, TestUser } from './fixtures'
export { anAsset, anOrg, aStorageLocation, aUser, TEST_BUCKETS, TEST_IDS } from './fixtures'
export type { FakeQueuePort, MakeQueuePortOptions, QueueCall } from './queue'
export { makeQueuePort } from './queue'
export type {
  FakeStoragePort,
  MakeStoragePortOptions,
  StorageCall,
  StorageResults,
} from './storage'
export { makeStoragePort } from './storage'
