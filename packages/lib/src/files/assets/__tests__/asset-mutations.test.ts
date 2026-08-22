// packages/lib/src/files/assets/__tests__/asset-mutations.test.ts

/**
 * `assets/asset-mutations.ts` — the write half of what `MediaAssetService` was.
 *
 * Three properties this file exists to pin down, all of which the class made
 * unassertable:
 *
 * 1. **Scope comes from `ctx`, never from the payload.** The legacy
 *    `processCreateData` took `organizationId` off the request.
 * 2. **Nothing opens a transaction of its own.** The db stub journals
 *    `begin`/`commit`, so "exactly one pair, and the test opened it" is a
 *    single assertion — which `BaseService.getTx()` made impossible, since it
 *    decided at runtime and silently issued a `SAVEPOINT` every time.
 * 3. **The thumbnail sweep is a parameter.** The legacy delete did
 *    `await import('./thumbnail-service'); new ThumbnailService(...)` inside its
 *    own body; here it is a plain object literal and `vi.mock` is called zero
 *    times in this file.
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
import {
  convertTempAssetToPermanent,
  createAsset,
  createAssetFromFolderFile,
  createAssetWithVersion,
  deleteAsset,
  updateAsset,
} from '../asset-mutations'
import type { ThumbnailCleanupPort } from '../ports'

const TABLES = {
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
  StorageLocation: schema.StorageLocation,
  FolderFile: schema.FolderFile,
}

/**
 * Borrow the db stub as a `Transaction`.
 *
 * Confined to this one line so it can never be mistaken for the production
 * shortcut the `tx`-first signature exists to forbid — the transaction test
 * below takes a genuine `Transaction` from `db.transaction(...)`.
 */
const asTx = (db: Database): Transaction => db as unknown as Transaction

const CLOCK = makeClock()
const NOW = CLOCK.now()
const deps = { now: CLOCK.now }

/** A recording thumbnail sweep. No `vi.fn`, no module interception. */
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
  return { id: TEST_IDS.versionId, assetId: TEST_IDS.assetId, versionNumber: 1, ...overrides }
}

describe('createAsset', () => {
  it('writes the caller organization, never the payload', async () => {
    const db = makeDb({ tables: TABLES })

    await createAsset(makeCtx({ db: db.db, organizationId: 'org_caller' }), deps, {
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      name: 'report.pdf',
    })

    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]?.values).toMatchObject({
      organizationId: 'org_caller',
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      name: 'report.pdf',
    })
  })

  it('defaults isPrivate to true and stamps updatedAt from deps.now', async () => {
    const db = makeDb({ tables: TABLES })

    await createAsset(makeCtx({ db: db.db }), deps, { kind: 'DOCUMENT', purpose: 'ORIGINAL' })

    // `MediaAsset.updatedAt` is NOT NULL with no database default, so an insert
    // that forgets it fails at runtime. Reading the clock through `deps` is what
    // makes that assertable without process-global fake timers.
    expect(db.inserts[0]?.values).toMatchObject({ isPrivate: true, updatedAt: NOW })
  })

  it('rejects a kind the enum does not know with a 400, not a 500', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await createAsset(makeCtx({ db: db.db }), deps, {
      // The union is what production callers see; this is the runtime guard for
      // the untyped edges (job payloads, request bodies) that reach it anyway.
      kind: 'NOT_A_KIND' as 'DOCUMENT',
      purpose: 'ORIGINAL',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(db.inserts).toEqual([])
  })

  it('opens no transaction — a single INSERT does not need one', async () => {
    const db = makeDb({ tables: TABLES })

    await createAsset(makeCtx({ db: db.db }), deps, { kind: 'DOCUMENT', purpose: 'ORIGINAL' })

    expect(db.transactions).toBe(0)
    expect(db.journal.ops('db')).toEqual(['insert'])
  })
})

describe('createAssetWithVersion', () => {
  function aDb() {
    return makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [undefined],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[anAsset()], [aVersionRow()]],
      tables: TABLES,
    })
  }

  it('creates the asset and its first version, and points the asset at it', async () => {
    const db = aDb()

    const result = await createAssetWithVersion(asTx(db.db), makeCtx({ db: db.db }), deps, {
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(result.isOk()).toBe(true)
    expect(db.inserts.map((insert) => insert.table)).toEqual(['MediaAsset', 'MediaAssetVersion'])
    expect(db.updates[0]).toMatchObject({
      table: 'MediaAsset',
      values: { currentVersionId: TEST_IDS.versionId },
    })
  })

  it('never opens a transaction of its own — the caller owns the boundary', async () => {
    const db = aDb()

    await db.db.transaction(async (tx) => {
      await createAssetWithVersion(tx, makeCtx({ db: tx }), deps, {
        kind: 'DOCUMENT',
        purpose: 'ORIGINAL',
        storageLocationId: TEST_IDS.storageLocationId,
      })
    })

    // Exactly one BEGIN/COMMIT pair, and the test opened it. The legacy
    // `createWithVersion` called `getTx`, which in drizzle-orm 0.44 issues a
    // SAVEPOINT even when already inside a transaction.
    expect(db.transactions).toBe(1)
    expect(db.journal.ops('db').filter((op) => op === 'begin')).toEqual(['begin'])
  })

  it('numbers the first version 1 when the asset has none', async () => {
    const db = aDb()

    await createAssetWithVersion(asTx(db.db), makeCtx({ db: db.db }), deps, {
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.inserts[1]?.values).toMatchObject({ versionNumber: 1 })
  })

  it('inherits size and mimeType from the storage location when the input omits them', async () => {
    const db = aDb()

    await createAssetWithVersion(asTx(db.db), makeCtx({ db: db.db }), deps, {
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      storageLocationId: TEST_IDS.storageLocationId,
    })

    // Behaviour change, deliberate: the legacy `createVersion` spread
    // `{ size: undefined }` over the location's values and persisted NULL.
    expect(db.inserts[1]?.values).toMatchObject({ size: 1024, mimeType: 'image/png' })
  })

  it('fails without inserting a version when the storage location is missing', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [undefined], StorageLocation: [] },
      insert: [[anAsset()]],
      tables: TABLES,
    })

    const result = await createAssetWithVersion(asTx(db.db), makeCtx({ db: db.db }), deps, {
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      storageLocationId: 'loc_missing',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts.map((insert) => insert.table)).toEqual(['MediaAsset'])
  })
})

describe('updateAsset', () => {
  it('scopes the UPDATE to the caller organization and stamps updatedAt', async () => {
    const db = makeDb({ update: [[anAsset()]], tables: TABLES })

    await updateAsset(makeCtx({ db: db.db, organizationId: 'org_caller' }), deps, 'ast_1', {
      name: 'renamed.png',
    })

    expect(db.updates[0]?.values).toMatchObject({ name: 'renamed.png', updatedAt: NOW })
    const where = JSON.stringify(db.wheres[0]?.predicate)
    expect(where).toContain('org_caller')
    expect(where).toContain('ast_1')
  })

  it('returns NotFoundError when the UPDATE matched no row', async () => {
    const db = makeDb({ update: [[]], tables: TABLES })

    const result = await updateAsset(makeCtx({ db: db.db }), deps, 'ast_missing', { name: 'x' })

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })
})

describe('deleteAsset', () => {
  function aDb() {
    return makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [[{ id: 'ver_a' }, { id: 'ver_b' }]],
      },
      tables: TABLES,
    })
  }

  it('sweeps thumbnails for every version through the injected port', async () => {
    const db = aDb()
    const thumbnails = makeThumbnails()

    await deleteAsset(
      asTx(db.db),
      makeCtx({ db: db.db }),
      { ...deps, thumbnails },
      TEST_IDS.assetId
    )

    expect(thumbnails.swept).toEqual(['ver_a', 'ver_b'])
  })

  it('clears dangling currentVersionId pointers within the organization only', async () => {
    const db = aDb()

    await deleteAsset(
      asTx(db.db),
      makeCtx({ db: db.db, organizationId: 'org_caller' }),
      { ...deps, thumbnails: makeThumbnails() },
      TEST_IDS.assetId
    )

    expect(db.updates[0]?.values).toEqual({ currentVersionId: null })
    // The legacy `UPDATE MediaAsset SET currentVersionId = NULL WHERE
    // currentVersionId IN (...)` carried no organization filter at all.
    expect(JSON.stringify(db.wheres[0]?.predicate)).toContain('org_caller')
  })

  it('soft-deletes with deps.now and scopes the statement', async () => {
    const db = aDb()

    await deleteAsset(
      asTx(db.db),
      makeCtx({ db: db.db, organizationId: 'org_caller' }),
      { ...deps, thumbnails: makeThumbnails() },
      TEST_IDS.assetId
    )

    expect(db.updates[1]?.values).toEqual({ deletedAt: NOW })
    const where = JSON.stringify(db.wheres[1]?.predicate)
    expect(where).toContain('org_caller')
    expect(where).toContain(TEST_IDS.assetId)
  })

  it('refuses an asset in another organization before touching anything', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const thumbnails = makeThumbnails()

    const result = await deleteAsset(
      asTx(db.db),
      makeCtx({ db: db.db }),
      { ...deps, thumbnails },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(thumbnails.swept).toEqual([])
    expect(db.updates).toEqual([])
  })

  it('skips the pointer sweep when the asset has no versions', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [[]] },
      tables: TABLES,
    })

    await deleteAsset(
      asTx(db.db),
      makeCtx({ db: db.db }),
      { ...deps, thumbnails: makeThumbnails() },
      TEST_IDS.assetId
    )

    expect(db.updates).toHaveLength(1)
    expect(db.updates[0]?.values).toEqual({ deletedAt: NOW })
  })
})

describe('convertTempAssetToPermanent', () => {
  it('promotes a temp upload and clears its expiry', async () => {
    const db = makeDb({ query: { MediaAsset: [anAsset({ kind: 'TEMP_UPLOAD' })] }, tables: TABLES })

    const result = await convertTempAssetToPermanent(
      makeCtx({ db: db.db }),
      TEST_IDS.assetId,
      'EMAIL_ATTACHMENT'
    )

    expect(result.isOk()).toBe(true)
    expect(db.updates[0]?.values).toEqual({ kind: 'EMAIL_ATTACHMENT', expiresAt: null })
  })

  it('is a no-op, not an error, for an asset that is already permanent', async () => {
    const db = makeDb({ query: { MediaAsset: [anAsset({ kind: 'DOCUMENT' })] }, tables: TABLES })

    const result = await convertTempAssetToPermanent(
      makeCtx({ db: db.db }),
      TEST_IDS.assetId,
      'EMAIL_ATTACHMENT'
    )

    // Callers run this speculatively over ids an earlier request may already
    // have converted, so "nothing to do" must not fail them.
    expect(result.isOk()).toBe(true)
    expect(db.updates).toEqual([])
  })

  it('is a no-op for an asset the caller cannot see', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })

    const result = await convertTempAssetToPermanent(makeCtx({ db: db.db }), 'ast_x', 'DOCUMENT')

    expect(result.isOk()).toBe(true)
    expect(db.updates).toEqual([])
  })
})

describe('createAssetFromFolderFile', () => {
  const aFile = (overrides: Record<string, unknown> = {}) => ({
    id: 'file_1',
    organizationId: TEST_IDS.organizationId,
    name: 'contract.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    createdById: TEST_IDS.userId,
    currentVersion: { id: 'fver_1', storageLocationId: TEST_IDS.storageLocationId },
    versions: undefined,
    ...overrides,
  })

  it('scopes the FolderFile read to the caller organization', async () => {
    const db = makeDb({
      query: {
        FolderFile: [aFile()],
        MediaAsset: [anAsset()],
        MediaAssetVersion: [undefined],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[anAsset()], [aVersionRow()]],
      tables: TABLES,
    })

    await createAssetFromFolderFile(
      asTx(db.db),
      makeCtx({ db: db.db, organizationId: 'org_caller' }),
      deps,
      { fileId: 'file_1' }
    )

    // Behaviour change: the legacy body looked the file up by bare id, so any
    // caller holding a file id could mint an asset over another tenant's bytes.
    const read = db.journal.entries.find(
      (entry) => (entry.detail as { table?: string })?.table === 'FolderFile'
    )
    expect(JSON.stringify((read?.detail?.args as { where?: unknown })?.where)).toContain(
      'org_caller'
    )
  })

  it('returns NotFoundError for a file outside the organization', async () => {
    const db = makeDb({ query: { FolderFile: [] }, tables: TABLES })

    const result = await createAssetFromFolderFile(asTx(db.db), makeCtx({ db: db.db }), deps, {
      fileId: 'file_other',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })

  it('reuses an existing asset for the same storage location when asked to', async () => {
    const existing = anAsset({ id: 'ast_existing' })
    const db = makeDb({
      query: {
        FolderFile: [aFile()],
        MediaAssetVersion: [[{ id: TEST_IDS.versionId }]],
        MediaAsset: [existing],
      },
      tables: TABLES,
    })

    const result = await createAssetFromFolderFile(asTx(db.db), makeCtx({ db: db.db }), deps, {
      fileId: 'file_1',
      skipIfExists: true,
    })

    expect(result._unsafeUnwrap().id).toBe('ast_existing')
    expect(db.inserts).toEqual([])
  })

  it('defaults the new asset to DOCUMENT and copies the file metadata', async () => {
    const db = makeDb({
      query: {
        FolderFile: [aFile()],
        MediaAsset: [anAsset()],
        MediaAssetVersion: [undefined],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[anAsset()], [aVersionRow()]],
      tables: TABLES,
    })

    await createAssetFromFolderFile(asTx(db.db), makeCtx({ db: db.db }), deps, { fileId: 'file_1' })

    expect(db.inserts[0]?.values).toMatchObject({
      kind: 'DOCUMENT',
      purpose: 'ORIGINAL',
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      isPrivate: true,
      createdById: TEST_IDS.userId,
    })
  })
})
