// packages/lib/src/files/__tests__/support/ctx.ts

/**
 * Builders for the two ambient objects every `files/` function takes.
 *
 * These exist so the first line of a test is the scenario, not thirty lines of
 * scaffolding. Both take overrides and build working defaults, so a test that
 * only cares about one collaborator passes only that one:
 *
 * ```ts
 * const journal = makeJournal()
 * const db = makeDb({ query: { MediaAsset: [anAsset()] }, journal })
 * const storage = makeStoragePort({ journal })
 *
 * const ctx = makeCtx({ db: db.db })
 * const deps = makeDeps({ storage: storage.port })
 * ```
 *
 * The journal is threaded explicitly rather than hidden inside a bundle: which
 * doubles share ordering is exactly what a Phase-6 ordering assertion depends
 * on, so it should be visible in the test.
 */

import type { FilesCtx, FilesDeps } from '../../ctx'
import { makeCachePort } from './cache'
import { makeClock } from './clock'
import { makeDb } from './db'
import { TEST_IDS } from './fixtures'
import { makeQueuePort } from './queue'
import { makeStoragePort } from './storage'

/**
 * A `FilesCtx` whose `db` is an empty recording stub unless one is supplied.
 *
 * The default `db` answers every read with "no rows", which is the correct
 * default for a test that is not exercising a read — it fails loudly rather
 * than returning a fixture nobody asked for.
 */
export function makeCtx(overrides: Partial<FilesCtx> = {}): FilesCtx {
  return {
    db: makeDb().db,
    organizationId: TEST_IDS.organizationId,
    ...overrides,
  }
}

/**
 * A `FilesDeps` with recording doubles and a frozen clock.
 *
 * Supply the fakes you intend to assert on (`makeStoragePort().port`, …) so you
 * keep a handle on their recorders; the ones you omit are inert doubles that
 * simply record and return benign values.
 */
export function makeDeps(overrides: Partial<FilesDeps> = {}): FilesDeps {
  return {
    storage: makeStoragePort().port,
    queue: makeQueuePort().port,
    cache: makeCachePort().port,
    now: makeClock().now,
    ...overrides,
  }
}
