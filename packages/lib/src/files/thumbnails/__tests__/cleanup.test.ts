// packages/lib/src/files/thumbnails/__tests__/cleanup.test.ts

/**
 * `thumbnails/cleanup.ts` — the four scheduled sweeps and the deletion routine
 * they share. **Zero `vi.mock` calls.**
 *
 * These sweeps had no test at all before: every one of them ran through
 * `new ThumbnailService(orgId, 'system', db)`, so reaching them meant mocking
 * `@auxx/database`, `@auxx/redis` and `storage-manager` at hoist scope. With
 * `db` and a `StoragePort` as parameters the interesting properties are one
 * assertion each — and the interesting properties are all about *not* deleting
 * the wrong thing.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  makeClock,
  makeDb,
  makeJournal,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import {
  cleanupExpiredSoftDeletes,
  cleanupFailedThumbnails,
  cleanupOrphanedThumbnails,
  processThumbnailDeletions,
  resolveThumbnailBucket,
} from '../cleanup'
import type { ThumbnailWithLocation } from '../thumbnail-queries'

const TABLES = {
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  StorageLocation: schema.StorageLocation,
}

function aThumbnailRow(overrides: Partial<ThumbnailWithLocation> = {}): ThumbnailWithLocation {
  return {
    versionId: 'ver_thumb',
    assetId: 'ast_thumb',
    preset: 'avatar-64',
    size: 4096,
    locationId: TEST_IDS.storageLocationId,
    locationProvider: 'S3',
    locationExternalId: 'org_test/thumbnail/ast_test/avatar-64.webp',
    locationMetadata: { bucket: TEST_BUCKETS.private },
    locationCredentialId: null,
    assetIsPrivate: true,
    ...overrides,
  }
}

function deps(journal = makeJournal()) {
  const storage = makeStoragePort({ journal })
  return { journal, storage, deps: { storage: storage.port, now: makeClock().now } }
}

describe('resolveThumbnailBucket', () => {
  it('prefers the bucket recorded on the storage location', () => {
    expect(resolveThumbnailBucket(aThumbnailRow())).toBe(TEST_BUCKETS.private)
  })

  it('refuses to guess for a row on a customer credential', () => {
    // S3 answers 204 for a delete of a key that is not in the bucket you named
    // (#1816/#1817/#1818), so a guessed bucket looks exactly like success while
    // the object lives on.
    expect(() =>
      resolveThumbnailBucket(
        aThumbnailRow({ locationMetadata: {}, locationCredentialId: TEST_IDS.credentialId })
      )
    ).toThrow(/refusing to guess/)
  })
})

describe('processThumbnailDeletions', () => {
  it('deletes the object before the rows, and soft-deletes by default', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[{ live: 0 }]], journal, tables: TABLES })
    const { storage, deps: d } = deps(journal)

    const result = await processThumbnailDeletions(db.db, d, [aThumbnailRow()])

    expect(result).toMatchObject({ deleted: 1, failed: 0, storageFreed: 4096 })
    expect(journal.ops()).toEqual(['deleteObject', 'update', 'select', 'update'])
    expect(storage.callsTo('deleteObject')).toHaveLength(1)
    expect(db.deletes).toHaveLength(0)
  })

  it('hard-deletes when permanent', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[{ live: 0 }]], journal, tables: TABLES })
    const { deps: d } = deps(journal)

    await processThumbnailDeletions(db.db, d, [aThumbnailRow()], { permanent: true })

    expect(journal.ops()).toEqual(['deleteObject', 'delete', 'select', 'delete'])
  })

  it('leaves the asset alone while a live version remains on it', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[{ live: 2 }]], journal, tables: TABLES })
    const { deps: d } = deps(journal)

    await processThumbnailDeletions(db.db, d, [aThumbnailRow()])

    // One version update, the count, and then nothing.
    expect(journal.ops()).toEqual(['deleteObject', 'update', 'select'])
  })

  it('touches nothing on a dry run but still reports what would go', async () => {
    const journal = makeJournal()
    const db = makeDb({ journal, tables: TABLES })
    const { storage, deps: d } = deps(journal)

    const result = await processThumbnailDeletions(db.db, d, [aThumbnailRow()], { dryRun: true })

    expect(result.deleted).toBe(1)
    expect(result.storageFreed).toBe(4096)
    expect(result.details).toEqual([
      { assetId: 'ast_thumb', versionId: 'ver_thumb', bytes: 4096, preset: 'avatar-64' },
    ])
    expect(journal.ops()).toEqual([])
    expect(storage.calls).toHaveLength(0)
  })

  it('skips the storage call for a placeholder that never reached storage', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[{ live: 0 }]], journal, tables: TABLES })
    const { storage, deps: d } = deps(journal)

    await processThumbnailDeletions(db.db, d, [
      aThumbnailRow({ locationId: null, locationExternalId: null, locationProvider: null }),
    ])

    expect(storage.calls).toHaveLength(0)
    expect(journal.ops()).toEqual(['update', 'select', 'update'])
  })

  it('collects a per-item failure rather than aborting the batch', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[{ live: 0 }]], journal, tables: TABLES })
    const storage = makeStoragePort({
      journal,
      impl: {
        deleteObject: async (p) => {
          if (p.key.endsWith('bad.webp')) throw new Error('S3 refused')
        },
      },
    })

    const result = await processThumbnailDeletions(
      db.db,
      { storage: storage.port, now: makeClock().now },
      [
        aThumbnailRow({ locationExternalId: 'bad.webp', size: 10 }),
        aThumbnailRow({ versionId: 'ver_ok', size: 20 }),
      ]
    )

    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.storageFreed).toBe(20)
    expect(result.errors).toHaveLength(1)
  })
})

describe('the sweeps', () => {
  const clock = makeClock('2026-06-01T00:00:00.000Z')

  it('cleanupOrphanedThumbnails caps the batch at maxDeletesPerRun', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[]], journal, tables: TABLES })
    const { deps: d } = deps(journal)

    const result = await cleanupOrphanedThumbnails(db.db as Database, d, {
      batchSize: 500,
      maxDeletesPerRun: 10,
    })

    expect(result._unsafeUnwrap()).toMatchObject({ deleted: 0, failed: 0 })
    // One statement, not one plus N: the legacy version ran a raw `sql` template
    // for the ids and then re-read every row through `findFirst`.
    expect(journal.ops('db')).toEqual(['select'])
  })

  it('cleanupFailedThumbnails hard-deletes and reads its threshold from deps.now', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aThumbnailRow()], [{ live: 0 }]], journal, tables: TABLES })
    const storage = makeStoragePort({ journal })

    const result = await cleanupFailedThumbnails(
      db.db as Database,
      { storage: storage.port, now: clock.now },
      { maxAgeHours: 6 }
    )

    expect(result._unsafeUnwrap().deleted).toBe(1)
    expect(journal.ops()).toEqual(['select', 'deleteObject', 'delete', 'select', 'delete'])
  })

  it('cleanupExpiredSoftDeletes hard-deletes rows past retention', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aThumbnailRow()], [{ live: 0 }]], journal, tables: TABLES })
    const storage = makeStoragePort({ journal })

    const result = await cleanupExpiredSoftDeletes(
      db.db as Database,
      { storage: storage.port, now: clock.now },
      { retentionDays: 30 }
    )

    expect(result._unsafeUnwrap().deleted).toBe(1)
    expect(db.deletes.map((d) => d.table)).toEqual(['MediaAssetVersion', 'MediaAsset'])
  })
})
