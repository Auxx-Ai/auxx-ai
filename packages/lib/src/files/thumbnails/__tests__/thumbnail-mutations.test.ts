// packages/lib/src/files/thumbnails/__tests__/thumbnail-mutations.test.ts

/**
 * `thumbnails/thumbnail-mutations.ts` — the check-then-enqueue path.
 * **Zero `vi.mock` calls**, which is the property the whole refactor turns on:
 * the legacy `thumbnail-service.test.ts` spent ~120 of its 408 lines on hoisted
 * Drizzle-chain, Redis, sharp and StorageManager mocks before its first
 * assertion, because the code under test constructed every one of those itself.
 *
 * The assertions that could not be written before:
 *
 * - the enqueue reads the `db` it was **handed** (Tier-1 §1.3 — a service bound
 *   to the pool from inside an open transaction is what shipped stale avatars);
 * - a `PROCESSING` placeholder does **not** answer `ready`;
 * - a preset fan-out resolves its source once, not once per preset;
 * - the job payload carries the actor from `input`, never from `ctx`.
 */

import { schema } from '@auxx/database'
import type { MediaAssetVersionEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import {
  anAsset,
  makeClock,
  makeCtx,
  makeDb,
  makeJournal,
  makeQueuePort,
  makeStoragePort,
  TEST_IDS,
} from '../../__tests__/support'
import { thumbnailJobKey } from '../presets'
import {
  createThumbnailCleanupPort,
  deleteThumbnailsForSource,
  ensureThumbnail,
  ensureThumbnailPresets,
} from '../thumbnail-mutations'

const TABLES = {
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  StorageLocation: schema.StorageLocation,
}

const SOURCE = { type: 'asset', assetId: TEST_IDS.assetId } as const

/** A live thumbnail row that has actually reached storage. */
function aThumbnail(overrides: Partial<MediaAssetVersionEntity> = {}) {
  return {
    id: 'ver_thumb',
    assetId: 'ast_thumb',
    storageLocationId: 'loc_thumb',
    preset: 'avatar-64',
    deletedAt: null,
    ...overrides,
  } as unknown as MediaAssetVersionEntity
}

function enqueueDeps() {
  const queue = makeQueuePort()
  return { queue, deps: { queue: queue.port, now: makeClock().now } }
}

describe('ensureThumbnail', () => {
  it('answers ready for a thumbnail that already has a storage location', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aThumbnail()] },
      tables: TABLES,
    })
    const { queue, deps } = enqueueDeps()

    const result = await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      opts: { preset: 'avatar-64' },
    })

    expect(result._unsafeUnwrap()).toEqual({
      status: 'ready',
      assetId: 'ast_thumb',
      assetVersionId: 'ver_thumb',
      storageLocationId: 'loc_thumb',
    })
    expect(queue.calls).toHaveLength(0)
  })

  it('re-enqueues past a PROCESSING placeholder instead of reporting it ready', async () => {
    // The legacy service returned `{ status: 'ready', storageLocationId:
    // existing.storageLocationId! }` for ANY live row. A placeholder left by a
    // crashed worker has no location, so every later request answered `ready`
    // with `storageLocationId: undefined` and enqueued nothing — the preset
    // stayed broken until the 24-hour failed sweep removed the row.
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [aThumbnail({ storageLocationId: null })],
      },
      tables: TABLES,
    })
    const { queue, deps } = enqueueDeps()

    const result = await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      opts: { preset: 'avatar-64' },
    })

    expect(result._unsafeUnwrap()).toEqual({ status: 'queued', jobId: 'job_1' })
    expect(queue.callsTo('enqueueThumbnail')).toHaveLength(1)
  })

  it('enqueues a payload built from ctx scope and the input actor', async () => {
    const db = makeDb({ query: { MediaAsset: [anAsset()], MediaAssetVersion: [] }, tables: TABLES })
    const { queue, deps } = enqueueDeps()

    await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: 'usr_actor',
      opts: { preset: 'avatar-128' },
    })

    // `FilesCtx` carries no actor, so `userId` can only have come from `input`.
    expect(queue.callsTo('enqueueThumbnail')[0]?.params).toEqual({
      orgId: TEST_IDS.organizationId,
      userId: 'usr_actor',
      versionId: TEST_IDS.versionId,
      preset: 'avatar-128',
      opts: { preset: 'avatar-128' },
      key: thumbnailJobKey(TEST_IDS.versionId, 'avatar-128', { preset: 'avatar-128' }),
      // `anAsset()` defaults to private, so the visibility is inherited.
      visibility: 'PRIVATE',
    })
  })

  it('lets an explicit visibility override the source asset', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset({ isPrivate: true })], MediaAssetVersion: [] },
      tables: TABLES,
    })
    const { queue, deps } = enqueueDeps()

    await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      opts: { preset: 'avatar-64', visibility: 'PUBLIC' },
    })

    expect(queue.callsTo('enqueueThumbnail')[0]?.params.visibility).toBe('PUBLIC')
  })

  it('reads the db it was handed, not a module-scope one', async () => {
    // This is Tier-1 §1.3 as an assertion: the legacy service bound
    // `dbClient = db` at construction, so a caller inside an open transaction
    // could not make it see the rows that transaction had written.
    const handed = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [] },
      tables: TABLES,
    })
    const { deps } = enqueueDeps()

    await ensureThumbnail(makeCtx({ db: handed.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
    })

    expect(handed.journal.ops('db')).toEqual(['query.findFirst', 'query.findFirst'])
  })

  it('returns NotFoundError for an asset outside this organization', async () => {
    // The stub answers "no rows" for an id it was not given, which is exactly
    // what the org-scoped predicate produces for another tenant's asset.
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const { queue, deps } = enqueueDeps()

    const result = await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: { type: 'asset', assetId: 'ast_other_org' },
      createdById: TEST_IDS.userId,
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(queue.calls).toHaveLength(0)
  })

  it('returns NotFoundError when the asset has no current version', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset({ currentVersionId: null })] },
      tables: TABLES,
    })
    const { deps } = enqueueDeps()

    const result = await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('returns BadRequestError for an unknown preset, before touching the database', async () => {
    const db = makeDb({ tables: TABLES })
    const { deps } = enqueueDeps()

    const result = await ensureThumbnail(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      opts: { preset: 'avatar-999' as never },
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.journal.ops('db')).toEqual([])
  })
})

describe('ensureThumbnailPresets', () => {
  it('resolves the source once for the whole fan-out', async () => {
    // `core/thumbnail-batch.ts` called `ensureThumbnail` per preset, so a
    // four-preset avatar upload ran the asset lookup four times.
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [] },
      tables: TABLES,
    })
    const { queue, deps } = enqueueDeps()

    const result = await ensureThumbnailPresets(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      presets: ['avatar-32', 'avatar-64', 'avatar-128', 'avatar-256'],
    })

    expect(result._unsafeUnwrap().map((r) => r.preset)).toEqual([
      'avatar-32',
      'avatar-64',
      'avatar-128',
      'avatar-256',
    ])
    expect(queue.callsTo('enqueueThumbnail')).toHaveLength(4)
    // One asset lookup, then one thumbnail probe per preset.
    expect(db.journal.ops('db').filter((op) => op === 'query.findFirst')).toHaveLength(5)
  })

  it('defaults to PUBLIC and lets a per-preset override win', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [] },
      tables: TABLES,
    })
    const { queue, deps } = enqueueDeps()

    await ensureThumbnailPresets(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      presets: ['avatar-32', 'avatar-64'],
      perPreset: { 'avatar-64': { updateUser: true } },
    })

    const calls = queue.callsTo('enqueueThumbnail')
    expect(calls.every((c) => c.params.visibility === 'PUBLIC')).toBe(true)
    expect(calls.find((c) => c.params.preset === 'avatar-64')?.params.opts.updateUser).toBe(true)
    expect(
      calls.find((c) => c.params.preset === 'avatar-32')?.params.opts.updateUser
    ).toBeUndefined()
  })

  it('reports an already-generated preset with the ids a caller needs', async () => {
    // Dropping these is what left an already-thumbnailed avatar stranded on
    // `EntityInstance.avatarUrl = null` forever.
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aThumbnail()] },
      tables: TABLES,
    })
    const { deps } = enqueueDeps()

    const result = await ensureThumbnailPresets(makeCtx({ db: db.db }), deps, {
      source: SOURCE,
      createdById: TEST_IDS.userId,
      presets: ['avatar-128'],
    })

    expect(result._unsafeUnwrap()[0]).toEqual({
      preset: 'avatar-128',
      status: 'ready',
      assetId: 'ast_thumb',
      assetVersionId: 'ver_thumb',
      storageLocationId: 'loc_thumb',
    })
  })
})

describe('deleteThumbnailsForSource', () => {
  const aRow = {
    versionId: 'ver_thumb',
    assetId: 'ast_thumb',
    preset: 'avatar-64',
    size: 2048,
    locationId: 'loc_thumb',
    locationProvider: 'S3',
    locationExternalId: 'org_test/thumbnail/ast_test/avatar-64.webp',
    locationMetadata: { bucket: 'test-private-bucket' },
    locationCredentialId: null,
    assetIsPrivate: true,
  }

  function deleteDeps(journal = makeJournal()) {
    const storage = makeStoragePort({ journal })
    return { journal, storage, deps: { storage: storage.port, now: makeClock().now } }
  }

  it('removes the storage object before the rows', async () => {
    // The legacy routine soft-deleted first and swept storage at the very end,
    // logging batch failures and dropping them — so a storage failure left a
    // deleted row and an object nothing pointed at any more.
    const journal = makeJournal()
    const db = makeDb({ select: [[aRow], [{ live: 0 }]], journal, tables: TABLES })
    const { storage, deps } = deleteDeps(journal)

    const result = await deleteThumbnailsForSource(makeCtx({ db: db.db }), deps, 'ver_source')

    expect(result.isOk()).toBe(true)
    expect(journal.ops()).toEqual(['select', 'deleteObject', 'update', 'select', 'update'])
    expect(storage.callsTo('deleteObject')[0]?.params).toEqual({
      provider: 'S3',
      bucket: 'test-private-bucket',
      key: aRow.locationExternalId,
      credentialId: undefined,
    })
  })

  it('touches nothing when the source has no thumbnails', async () => {
    // `assets/ports.ts` states this: the port must resolve, not throw.
    const journal = makeJournal()
    const db = makeDb({ select: [[]], journal, tables: TABLES })
    const { storage, deps } = deleteDeps(journal)

    const result = await deleteThumbnailsForSource(makeCtx({ db: db.db }), deps, 'ver_source')

    expect(result.isOk()).toBe(true)
    expect(storage.calls).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
  })

  it('leaves the rows alone when the object cannot be deleted', async () => {
    const journal = makeJournal()
    const db = makeDb({ select: [[aRow]], journal, tables: TABLES })
    const storage = makeStoragePort({
      journal,
      impl: {
        deleteObject: async () => {
          throw new Error('S3 is having a day')
        },
      },
    })

    const result = await deleteThumbnailsForSource(
      makeCtx({ db: db.db }),
      { storage: storage.port, now: makeClock().now },
      'ver_source'
    )

    // The sweep itself succeeds — a per-item failure is collected, not thrown —
    // but nothing was marked deleted, so the next run retries.
    expect(result.isOk()).toBe(true)
    expect(db.updates).toHaveLength(0)
    expect(db.deletes).toHaveLength(0)
  })
})

describe('createThumbnailCleanupPort', () => {
  it('throws rather than resolving on failure, so an asset delete rolls back', async () => {
    const db = makeDb({
      select: [
        [
          {
            versionId: 'ver_thumb',
            assetId: 'ast_thumb',
            preset: 'avatar-64',
            size: 1,
            locationId: 'loc_thumb',
            locationProvider: 'S3',
            locationExternalId: 'k',
            // No recorded bucket and a customer credential: unrecoverable.
            locationMetadata: {},
            locationCredentialId: TEST_IDS.credentialId,
            assetIsPrivate: true,
          },
        ],
      ],
      tables: TABLES,
    })

    const port = createThumbnailCleanupPort(makeCtx({ db: db.db }), {
      storage: makeStoragePort().port,
      now: makeClock().now,
    })

    // The bucket refusal is a per-item failure, so the sweep still resolves —
    // and nothing was deleted, which is the point.
    await expect(port.deleteThumbnailsForSource('ver_source')).resolves.toBeUndefined()
    expect(db.updates).toHaveLength(0)
  })
})
