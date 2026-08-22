// packages/lib/src/files/assets/__tests__/version-mutations.test.ts

/**
 * `assets/version-mutations.ts`.
 *
 * The `tx`-first signature is the load-bearing part here: creating a version is
 * an INSERT plus a `currentVersionId` move, and a `ctx`-only signature would
 * accept a pool and let the two drift apart. `vi.mock` is called zero times.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  makeClock,
  makeCtx,
  makeDb,
  TEST_IDS,
} from '../../__tests__/support'
import type { ThumbnailCleanupPort } from '../ports'
import {
  createAssetVersion,
  deleteAssetVersion,
  restoreAssetVersion,
  updateAssetContent,
} from '../version-mutations'

const TABLES = {
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  StorageLocation: schema.StorageLocation,
}

/** See `asset-mutations.test.ts` — the cast is confined to this one line. */
const asTx = (db: Database): Transaction => db as unknown as Transaction

const CLOCK = makeClock()
const NOW = CLOCK.now()
const deps = { now: CLOCK.now }

function makeThumbnails(): ThumbnailCleanupPort & { swept: string[] } {
  const swept: string[] = []
  return {
    swept,
    deleteThumbnailsForSource: async (sourceVersionId: string) => {
      swept.push(sourceVersionId)
    },
  }
}

function aVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.versionId,
    assetId: TEST_IDS.assetId,
    versionNumber: 1,
    size: 1024,
    mimeType: 'image/png',
    storageLocationId: TEST_IDS.storageLocationId,
    deletedAt: null,
    derivedFromVersionId: null,
    preset: null,
    metadata: {},
    status: 'READY' as const,
    storageLocation: aStorageLocation(),
    ...overrides,
  }
}

describe('createAssetVersion', () => {
  function aDb(options: Parameters<typeof makeDb>[0] = {}) {
    return makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [{ versionNumber: 4 }],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[aVersionRow({ versionNumber: 5 })]],
      tables: TABLES,
      ...options,
    })
  }

  it('numbers the new version one past the highest existing one', async () => {
    const db = aDb()

    await createAssetVersion(asTx(db.db), makeCtx({ db: db.db }), {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.inserts[0]?.values).toMatchObject({ versionNumber: 5 })
  })

  it('moves currentVersionId within the caller organization', async () => {
    const db = aDb()

    await createAssetVersion(asTx(db.db), makeCtx({ db: db.db, organizationId: 'org_caller' }), {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.updates[0]?.values).toEqual({ currentVersionId: TEST_IDS.versionId })
    // The legacy `UPDATE MediaAsset SET currentVersionId = ? WHERE id = ?`
    // carried no organization filter.
    expect(JSON.stringify(db.wheres.at(-1)?.predicate)).toContain('org_caller')
  })

  it('persists caller metadata alongside the location-derived fields', async () => {
    const db = aDb()

    await createAssetVersion(asTx(db.db), makeCtx({ db: db.db }), {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
      metadata: { contentHash: 'abc123' },
    })

    expect(db.inserts[0]?.values).toMatchObject({
      metadata: { contentHash: 'abc123' },
      size: 1024,
      mimeType: 'image/png',
    })
  })

  it('prefers explicit size and mimeType over the location row', async () => {
    const db = aDb()

    await createAssetVersion(asTx(db.db), makeCtx({ db: db.db }), {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
      size: 42,
      mimeType: 'application/pdf',
    })

    expect(db.inserts[0]?.values).toMatchObject({ size: 42, mimeType: 'application/pdf' })
  })

  it('refuses an asset the caller cannot see, before reading anything else', async () => {
    const db = aDb({ query: { MediaAsset: [] } })

    const result = await createAssetVersion(asTx(db.db), makeCtx({ db: db.db }), {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })

  it('opens no transaction of its own', async () => {
    const db = aDb()

    await db.db.transaction(async (tx) => {
      await createAssetVersion(tx, makeCtx({ db: tx }), {
        assetId: TEST_IDS.assetId,
        storageLocationId: TEST_IDS.storageLocationId,
      })
    })

    expect(db.transactions).toBe(1)
  })
})

describe('updateAssetContent', () => {
  function aDb() {
    return makeDb({
      query: {
        MediaAsset: [anAsset(), anAsset()],
        MediaAssetVersion: [{ versionNumber: 1 }],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[aVersionRow({ versionNumber: 2 })]],
      update: [[], [anAsset({ size: 99 })]],
      tables: TABLES,
    })
  }

  it('adds a version and updates only the asset fields the input names', async () => {
    const db = aDb()

    const result = await updateAssetContent(asTx(db.db), makeCtx({ db: db.db }), deps, {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
      size: 99,
    })

    expect(result.isOk()).toBe(true)
    // First update is the `currentVersionId` move inside the version insert;
    // the second is the asset metadata update.
    expect(db.updates[1]?.values).toEqual({ size: 99, updatedAt: NOW })
  })

  it('still stamps updatedAt when no metadata field changes', async () => {
    const db = aDb()

    await updateAssetContent(asTx(db.db), makeCtx({ db: db.db }), deps, {
      assetId: TEST_IDS.assetId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.updates[1]?.values).toEqual({ updatedAt: NOW })
  })
})

describe('restoreAssetVersion', () => {
  it('points the asset at the requested version number, org-scoped', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [aVersionRow({ id: 'ver_old', versionNumber: 2 })],
      },
      update: [[anAsset({ currentVersionId: 'ver_old' })]],
      tables: TABLES,
    })

    const result = await restoreAssetVersion(
      makeCtx({ db: db.db, organizationId: 'org_caller' }),
      deps,
      TEST_IDS.assetId,
      2
    )

    expect(result.isOk()).toBe(true)
    expect(db.updates[0]?.values).toEqual({ currentVersionId: 'ver_old', updatedAt: NOW })
    // The legacy `restoreVersion` read the version org-scoped and then updated
    // by bare id.
    expect(JSON.stringify(db.wheres[0]?.predicate)).toContain('org_caller')
  })

  it('returns NotFoundError for a version number the asset does not have', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [] },
      tables: TABLES,
    })

    const result = await restoreAssetVersion(makeCtx({ db: db.db }), deps, TEST_IDS.assetId, 9)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.updates).toEqual([])
  })
})

describe('deleteAssetVersion', () => {
  it('refuses to delete the version the asset currently points at', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ currentVersionId: TEST_IDS.versionId }), anAsset()],
        MediaAssetVersion: [aVersionRow()],
      },
      tables: TABLES,
    })
    const thumbnails = makeThumbnails()

    const result = await deleteAssetVersion(
      makeCtx({ db: db.db }),
      { thumbnails },
      TEST_IDS.assetId,
      1
    )

    // 409, not a bare 500 — losing the current version leaves the asset
    // pointing at nothing.
    expect(result._unsafeUnwrapErr().statusCode).toBe(409)
    expect(thumbnails.swept).toEqual([])
    expect(db.deletes).toEqual([])
  })

  it('sweeps thumbnails through the port and then deletes the version row', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ currentVersionId: 'ver_current' }), anAsset()],
        MediaAssetVersion: [aVersionRow({ id: 'ver_old', versionNumber: 1 })],
      },
      select: [[]],
      tables: TABLES,
    })
    const thumbnails = makeThumbnails()

    const result = await deleteAssetVersion(
      makeCtx({ db: db.db }),
      { thumbnails },
      TEST_IDS.assetId,
      1
    )

    expect(result.isOk()).toBe(true)
    expect(thumbnails.swept).toEqual(['ver_old'])
    expect(db.deletes.map((entry) => entry.table)).toEqual(['MediaAssetVersion'])
  })

  it('purges the derived thumbnail assets before deleting, or the FK blocks it', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ currentVersionId: 'ver_current' }), anAsset()],
        MediaAssetVersion: [aVersionRow({ id: 'ver_old' })],
      },
      // `selectDistinct` shares the select queue: one derived asset found.
      select: [[{ assetId: 'ast_thumb' }]],
      tables: TABLES,
    })

    await deleteAssetVersion(
      makeCtx({ db: db.db }),
      { thumbnails: makeThumbnails() },
      TEST_IDS.assetId,
      1
    )

    // `purgeMediaAssets` runs raw statements; the journal proves it ran at all,
    // which is the property that matters — a surviving derived row raises 23503.
    expect(db.journal.ops('db')).toContain('execute')
  })

  it('refuses an asset the caller cannot see', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const thumbnails = makeThumbnails()

    const result = await deleteAssetVersion(
      makeCtx({ db: db.db }),
      { thumbnails },
      TEST_IDS.assetId,
      1
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(thumbnails.swept).toEqual([])
  })
})
