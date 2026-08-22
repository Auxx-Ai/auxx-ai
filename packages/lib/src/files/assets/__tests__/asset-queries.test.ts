// packages/lib/src/files/assets/__tests__/asset-queries.test.ts

/**
 * `assets/asset-queries.ts` — the read half of what `MediaAssetService` was.
 *
 * As with every test written to the `files/` contract, **`vi.mock` is called
 * zero times in this file**: `ctx.db` is a parameter, so there is nothing left
 * to intercept at module scope.
 *
 * The assertions that matter beyond "it returns rows" are the WHERE clauses.
 * The db stub does not interpret SQL, but it stores the predicate the code
 * built, and the bound values survive `JSON.stringify` — which is enough to
 * prove an organization filter is present. It is not enough to prove *which
 * column* each condition names (this package's `@auxx/database` mock hands out
 * `{}` for every table, so column references serialize as `null`); that
 * distinction belongs to the integration lane.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { anAsset, aStorageLocation, makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  findAssetsByKind,
  findExpiredAssets,
  getAsset,
  getAssetCurrentVersion,
  getAssetVersionByNumber,
  getAssetVersions,
  getAssetWithRelations,
  getLatestAssetVersion,
  listAssets,
} from '../asset-queries'

const TABLES = { MediaAsset: schema.MediaAsset, MediaAssetVersion: schema.MediaAssetVersion }

function aVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_IDS.versionId,
    assetId: TEST_IDS.assetId,
    versionNumber: 1,
    size: 1024,
    mimeType: 'image/png',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

/** The `where` predicate handed to the n-th relational read, stringified. */
function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  const reads = db.journal.entries.filter(
    (entry) => entry.op === 'query.findFirst' || entry.op === 'query.findMany'
  )
  return JSON.stringify((reads[index]?.detail?.args as { where?: unknown })?.where)
}

describe('getAsset', () => {
  it('returns the row and scopes the read to the caller organization', async () => {
    const db = makeDb({ query: { MediaAsset: [anAsset()] }, tables: TABLES })

    const result = await getAsset(makeCtx({ db: db.db, organizationId: 'org_other' }), 'ast_1')

    expect(result._unsafeUnwrap()).toEqual(anAsset())
    const where = whereOf(db, 0)
    expect(where).toContain('org_other')
    expect(where).toContain('ast_1')
    // `deletedAt IS NULL` — a soft-deleted asset must not come back.
    expect(where).toContain(' is null')
  })

  it('returns ok(null) rather than an error when nothing matches', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })

    const result = await getAsset(makeCtx({ db: db.db }), 'ast_missing')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('scopes unconditionally — there is no "no organization" branch left', async () => {
    // The legacy body was `if (this.organizationId) filters.push(...)`, so a
    // service built without one queried every tenant. `FilesCtx.organizationId`
    // is required, so the filter is always in the statement.
    const db = makeDb({ query: { MediaAsset: [anAsset()] }, tables: TABLES })

    await getAsset(makeCtx({ db: db.db, organizationId: TEST_IDS.organizationId }), 'ast_1')

    expect(whereOf(db, 0)).toContain(TEST_IDS.organizationId)
  })
})

describe('getAssetWithRelations', () => {
  it('asks for the current version, all versions, attachments and the creator', async () => {
    const db = makeDb({ query: { MediaAsset: [anAsset()] }, tables: TABLES })

    await getAssetWithRelations(makeCtx({ db: db.db }), TEST_IDS.assetId)

    const read = db.journal.entries.find((entry) => entry.op === 'query.findFirst')
    const relations = (read?.detail?.args as { with?: Record<string, unknown> })?.with
    expect(Object.keys(relations ?? {}).sort()).toEqual([
      'attachments',
      'createdBy',
      'currentVersion',
      'versions',
    ])
  })
})

describe('listAssets', () => {
  it('reports hasMore when the page is full and total as the page size', async () => {
    const db = makeDb({ query: { MediaAsset: [[anAsset(), anAsset()]] }, tables: TABLES })

    const result = await listAssets(makeCtx({ db: db.db }), { limit: 2 })

    // `total` is inherited verbatim from the legacy `list`, which never issued a
    // count query. Documented on `AssetPage`, asserted here so a future "fix"
    // is a deliberate change rather than a surprise.
    expect(result._unsafeUnwrap()).toMatchObject({ total: 2, hasMore: true })
  })

  it('does not report hasMore on a short page', async () => {
    const db = makeDb({ query: { MediaAsset: [[anAsset()]] }, tables: TABLES })

    const result = await listAssets(makeCtx({ db: db.db }), { limit: 5 })

    expect(result._unsafeUnwrap().hasMore).toBe(false)
  })

  it('keeps soft-deleted rows out unless asked for them', async () => {
    const withDefault = makeDb({ query: { MediaAsset: [[]] }, tables: TABLES })
    await listAssets(makeCtx({ db: withDefault.db }), {})
    expect(whereOf(withDefault, 0)).toContain(' is null')

    const withDeleted = makeDb({ query: { MediaAsset: [[]] }, tables: TABLES })
    await listAssets(makeCtx({ db: withDeleted.db }), { includeDeleted: true })
    expect(whereOf(withDeleted, 0)).not.toContain(' is null')
  })

  it('binds the kind and isPrivate filters into the statement', async () => {
    const db = makeDb({ query: { MediaAsset: [[]] }, tables: TABLES })

    await listAssets(makeCtx({ db: db.db }), { kind: 'THUMBNAIL', isPrivate: false })

    const where = whereOf(db, 0)
    expect(where).toContain('THUMBNAIL')
    expect(where).toContain('false')
  })
})

describe('findAssetsByKind', () => {
  it('filters on kind, live rows and the caller organization', async () => {
    const db = makeDb({ query: { MediaAsset: [[anAsset({ kind: 'DOCUMENT' })]] }, tables: TABLES })

    const result = await findAssetsByKind(makeCtx({ db: db.db }), 'DOCUMENT')

    expect(result._unsafeUnwrap()).toHaveLength(1)
    const where = whereOf(db, 0)
    expect(where).toContain('DOCUMENT')
    expect(where).toContain(TEST_IDS.organizationId)
  })
})

describe('findExpiredAssets', () => {
  it('takes the cutoff as an instant instead of reading the clock', async () => {
    const db = makeDb({ query: { MediaAsset: [[]] }, tables: TABLES })
    const cutoff = new Date('2026-01-01T00:00:00.000Z')

    await findExpiredAssets(makeCtx({ db: db.db }), cutoff)

    const where = whereOf(db, 0)
    expect(where).toContain('TEMP_UPLOAD')
    expect(where).toContain('2026-01-01T00:00:00.000Z')
  })

  it('can sweep a kind other than TEMP_UPLOAD', async () => {
    const db = makeDb({ query: { MediaAsset: [[]] }, tables: TABLES })

    await findExpiredAssets(makeCtx({ db: db.db }), new Date(0), 'THUMBNAIL')

    expect(whereOf(db, 0)).toContain('THUMBNAIL')
  })
})

describe('getAssetCurrentVersion', () => {
  it('follows currentVersionId when the asset has one', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
    })

    const result = await getAssetCurrentVersion(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrap()?.id).toBe(TEST_IDS.versionId)
    // The version read is constrained by BOTH the version id and the asset id,
    // so a version belonging to another asset cannot be served through this one.
    const where = whereOf(db, 1)
    expect(where).toContain(TEST_IDS.versionId)
    expect(where).toContain(TEST_IDS.assetId)
  })

  it('falls back to the highest version number when currentVersionId is null', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ currentVersionId: null })],
        MediaAssetVersion: [aVersion({ versionNumber: 7 })],
      },
      tables: TABLES,
    })

    const result = await getAssetCurrentVersion(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrap()?.versionNumber).toBe(7)
    expect(whereOf(db, 1)).not.toContain(TEST_IDS.versionId)
  })

  it('returns NotFoundError when the asset is missing, not ok(null)', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })

    const result = await getAssetCurrentVersion(makeCtx({ db: db.db }), 'ast_missing')

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })

  it('returns ok(null) when the asset exists but has no version', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset({ currentVersionId: null })], MediaAssetVersion: [] },
      tables: TABLES,
    })

    const result = await getAssetCurrentVersion(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrap()).toBeNull()
  })
})

describe('getAssetVersions', () => {
  it('resolves the asset first, so the listing is organization-scoped', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [[aVersion()]] },
      tables: TABLES,
    })

    const result = await getAssetVersions(
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrap()).toHaveLength(1)
    expect(whereOf(db, 0)).toContain('org_owner')
  })

  it('refuses to list versions of an asset in another organization', async () => {
    const db = makeDb({
      query: { MediaAsset: [], MediaAssetVersion: [[aVersion()]] },
      tables: TABLES,
    })

    const result = await getAssetVersions(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    // The version query never ran.
    expect(db.journal.ops('db')).toEqual(['query.findFirst'])
  })
})

describe('getAssetVersionByNumber', () => {
  it('addresses the version by number, not by id', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion({ versionNumber: 3 })] },
      tables: TABLES,
    })

    const result = await getAssetVersionByNumber(makeCtx({ db: db.db }), TEST_IDS.assetId, 3)

    expect(result._unsafeUnwrap()?.versionNumber).toBe(3)
    const where = whereOf(db, 1)
    expect(where).toContain(TEST_IDS.assetId)
    expect(where).toContain('3')
  })
})

describe('getLatestAssetVersion', () => {
  it('is organization-scoped, which the legacy getLatestVersion was not', async () => {
    // The legacy method queried `MediaAssetVersion` by bare `assetId` and never
    // loaded the asset, so no statement in it carried an organization filter.
    const db = makeDb({
      query: { MediaAsset: [], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
    })

    const result = await getLatestAssetVersion(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.journal.ops('db')).toEqual(['query.findFirst'])
  })

  it('returns the newest version for an asset the caller owns', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion({ versionNumber: 9 })] },
      tables: TABLES,
    })

    const result = await getLatestAssetVersion(makeCtx({ db: db.db }), TEST_IDS.assetId)

    expect(result._unsafeUnwrap()?.versionNumber).toBe(9)
  })
})
