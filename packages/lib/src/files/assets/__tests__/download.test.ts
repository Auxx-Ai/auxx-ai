// packages/lib/src/files/assets/__tests__/download.test.ts

/**
 * `getAssetDownloadRef` — the Phase-2 READ pilot.
 *
 * The property this file exists to demonstrate, beyond the behaviour it
 * asserts: **it calls `vi.mock` zero times.** Every collaborator arrives as a
 * parameter (`ctx.db`, `deps.storage`), so there is nothing left to intercept
 * at module scope. The equivalent test against `MediaAssetService` needed
 * ~100 lines of `vi.mock('../storage/storage-manager')` plus a database mock.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  anAsset,
  aStorageLocation,
  makeCtx,
  makeDb,
  makeJournal,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import { getAssetDownloadRef } from '../download'

/** A version row shaped the way the relational query returns it (location joined in). */
function aVersion(
  overrides: {
    id?: string
    assetId?: string
    versionNumber?: number
    storageLocationId?: string | null
    storageLocation?: ReturnType<typeof aStorageLocation> | null
  } = {}
) {
  const storageLocation =
    overrides.storageLocation === undefined ? aStorageLocation() : overrides.storageLocation
  return {
    id: overrides.id ?? TEST_IDS.versionId,
    assetId: overrides.assetId ?? TEST_IDS.assetId,
    versionNumber: overrides.versionNumber ?? 1,
    size: 1024,
    mimeType: 'image/png',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    storageLocationId:
      overrides.storageLocationId === undefined
        ? (storageLocation?.id ?? null)
        : overrides.storageLocationId,
    deletedAt: null,
    derivedFromVersionId: null,
    preset: null,
    metadata: {},
    status: 'READY' as const,
    storageLocation,
  }
}

const TABLES = { MediaAsset: schema.MediaAsset, MediaAssetVersion: schema.MediaAssetVersion }

describe('getAssetDownloadRef', () => {
  it('returns the durable external URL for a public asset and never touches storage', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ isPrivate: false })],
        MediaAssetVersion: [
          aVersion({
            storageLocation: aStorageLocation({ externalUrl: 'https://cdn.test/og.png' }),
          }),
        ],
      },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ type: 'url', url: 'https://cdn.test/og.png' })
    // No expiry: an OG crawler caches this for days, and a presigned URL would 403.
    expect(result._unsafeUnwrap()).not.toHaveProperty('expiresAt')
    expect(storage.calls).toEqual([])
    expect(journal.ops('storage')).toEqual([])
  })

  it('presigns a private asset with the bucket from the StorageLocation row', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [
          anAsset({ isPrivate: true, name: 'invoice.pdf', mimeType: 'application/pdf' }),
        ],
        MediaAssetVersion: [
          aVersion({
            storageLocation: aStorageLocation({
              externalId: 'org_test/media-asset/ast_test/invoice.pdf',
              credentialId: TEST_IDS.credentialId,
              metadata: { bucket: TEST_BUCKETS.public, key: 'ignored' },
            }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort({
      results: {
        presignDownload: { type: 'url', url: 'https://s3.test/signed', expiresAt: new Date(0) },
      },
    })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { disposition: 'attachment', ttlSec: 900 }
    )

    expect(result._unsafeUnwrap()).toEqual({
      type: 'url',
      url: 'https://s3.test/signed',
      expiresAt: new Date(0),
    })
    // The bucket came off the row, not from config — the assertion #1816/#1817/#1818 lacked.
    expect(storage.callsTo('presignDownload')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'org_test/media-asset/ast_test/invoice.pdf',
      credentialId: TEST_IDS.credentialId,
      ttlSec: 900,
      disposition: 'attachment',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
    })
  })

  it('presigns a public asset whose storage location has no external URL', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ isPrivate: false })],
        MediaAssetVersion: [aVersion({ storageLocation: aStorageLocation({ externalUrl: '' }) })],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignDownload')).toHaveLength(1)
  })

  it('serves an explicitly requested version', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ isPrivate: true })],
        MediaAssetVersion: [
          aVersion({
            id: 'ver_old',
            versionNumber: 3,
            storageLocation: aStorageLocation({ id: 'loc_old', externalId: 'keys/old.png' }),
          }),
        ],
      },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { versionId: 'ver_old' }
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignDownload')[0]?.params.key).toBe('keys/old.png')
    expect(journal.ops()).toEqual(['query.findFirst', 'query.findFirst', 'presignDownload'])
  })

  it('returns NotFoundError when the asset does not exist', async () => {
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      'ast_missing'
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe('Asset ast_missing not found')
    expect(storage.calls).toEqual([])
  })

  it('scopes the asset read to the caller org and the version read to the asset', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
    })

    await getAssetDownloadRef(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      { storage: makeStoragePort().port },
      TEST_IDS.assetId
    )

    // The stub does not interpret SQL, so assert the predicate was BUILT — the
    // org filter and the soft-delete filter are what stop a cross-tenant read.
    // Column references serialize as `null` here: under Vitest this package's
    // setup replaces `schema` with a proxy of bare `{}` objects, so a Drizzle
    // table cannot name its own columns. The bound VALUES and the operators
    // survive, which is enough to prove the predicate was built.
    const [assetRead, versionRead] = db.journal.entries.filter((e) => e.op === 'query.findFirst')
    const assetSql = JSON.stringify((assetRead?.detail?.args as { where?: unknown })?.where)
    expect(assetSql).toContain('org_other')
    expect(assetSql).toContain(TEST_IDS.assetId)
    expect(assetSql).toContain(' is null')
    expect(JSON.stringify((versionRead?.detail?.args as { where?: unknown })?.where)).toContain(
      TEST_IDS.assetId
    )
  })

  it('returns NotFoundError, not a leak, for an asset in another organization', async () => {
    // The org-scoped WHERE means the row simply is not there.
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    // The message must not confirm the id exists elsewhere.
    expect(result._unsafeUnwrapErr().message).toBe(`Asset ${TEST_IDS.assetId} not found`)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError when the asset has no version at all', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset({ currentVersionId: null })], MediaAssetVersion: [] },
      tables: TABLES,
    })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: makeStoragePort().port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(`No version found for asset ${TEST_IDS.assetId}`)
  })

  it('returns NotFoundError when the version has no storageLocationId', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [aVersion({ storageLocationId: null, storageLocation: null })],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(
      `No storage location found for asset ${TEST_IDS.assetId}`
    )
    expect(storage.calls).toEqual([])
  })

  it('treats a soft-deleted asset as missing', async () => {
    // `deletedAt IS NULL` is in the WHERE, so the real database returns nothing;
    // the stub models that by having no row queued.
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(storage.calls).toEqual([])
  })

  it('resolves the current version through the already-loaded asset, in two reads', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
      journal,
    })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: makeStoragePort({ journal }).port },
      TEST_IDS.assetId,
      { version: 'current' }
    )

    expect(result.isOk()).toBe(true)
    // `'current'` must NOT cost a second asset read: it goes through
    // `loadCurrentVersion`, which takes the row this function already has.
    expect(journal.ops()).toEqual(['query.findFirst', 'query.findFirst', 'presignDownload'])
  })

  it('serves the highest-numbered version for `latest`', async () => {
    const db = makeDb({
      query: {
        // `getLatestAssetVersion` re-runs `requireAsset`, so the asset is read twice.
        MediaAsset: [anAsset(), anAsset()],
        MediaAssetVersion: [
          aVersion({
            versionNumber: 9,
            storageLocation: aStorageLocation({ externalId: 'keys/v9.png' }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { version: 'latest' }
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignDownload')[0]?.params.key).toBe('keys/v9.png')
  })

  it('addresses a version by its 1-based number, not by row id', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset(), anAsset()],
        MediaAssetVersion: [
          aVersion({
            id: 'ver_three',
            versionNumber: 3,
            storageLocation: aStorageLocation({ externalId: 'keys/v3.png' }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { version: 3 }
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignDownload')[0]?.params.key).toBe('keys/v3.png')
    // The number reached the WHERE as a bound value — the two id spaces
    // (`versionNumber` vs the cuid `id`) must not be confused at a call site.
    const versionRead = db.journal.entries.filter((e) => e.op === 'query.findFirst')[2]
    expect(JSON.stringify((versionRead?.detail?.args as { where?: unknown })?.where)).toContain('3')
  })

  it('prefers versionId over version when a caller supplies both', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [
          aVersion({ id: 'ver_pinned', storageLocation: aStorageLocation({ externalId: 'k/p' }) }),
        ],
      },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { versionId: 'ver_pinned', version: 'latest' }
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('presignDownload')[0]?.params.key).toBe('k/p')
    // The by-id branch never re-reads the asset, so `latest` cannot have run.
    expect(journal.ops()).toEqual(['query.findFirst', 'query.findFirst', 'presignDownload'])
  })

  it('returns NotFoundError when the requested version number does not exist', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset(), anAsset()], MediaAssetVersion: [] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { version: 7 }
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(
      `Version 7 not found for asset ${TEST_IDS.assetId}`
    )
    expect(storage.calls).toEqual([])
  })

  it('fails loudly rather than guessing when the storage location has no bucket', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset({ isPrivate: true })],
        MediaAssetVersion: [
          aVersion({ storageLocation: aStorageLocation({ metadata: { key: 'k' } }) }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetDownloadRef(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().statusCode).toBe(500)
    expect(result._unsafeUnwrapErr().message).toContain('has no metadata.bucket')
    // Never presign against a guessed bucket: a wrong-bucket delete 204s.
    expect(storage.calls).toEqual([])
  })
})
