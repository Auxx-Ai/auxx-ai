// packages/lib/src/files/assets/__tests__/content.test.ts

/**
 * `getAssetContent` / `streamAssetContent` / `resolveAssetObjectRef` — the
 * content reads that finally replace `MediaAssetService.getContent` and the
 * `StorageManager.getContent(locationId)` hop underneath it.
 *
 * Zero `vi.mock` calls: `ctx.db` and `deps.storage` are both parameters. The
 * equivalent test against the facade needed `vi.mock('../storage/storage-manager')`
 * plus a database mock, which is exactly why the method survived three PRs
 * untested.
 *
 * The load-bearing assertion in this file is that `getObject` is called with the
 * bucket **from the `StorageLocation` row**, and that a row without one produces
 * an error rather than a read against a configured default (#1816/#1817/#1818).
 */

import { Readable } from 'node:stream'
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
import { getAssetContent, resolveAssetObjectRef, streamAssetContent } from '../content'
import type { VersionWithLocation } from '../download'

/** A version row shaped the way the relational query returns it (location joined in). */
function aVersion(
  overrides: {
    id?: string
    assetId?: string
    versionNumber?: number
    storageLocationId?: string | null
    storageLocation?: ReturnType<typeof aStorageLocation> | null
  } = {}
): VersionWithLocation {
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
  } as VersionWithLocation
}

const TABLES = { MediaAsset: schema.MediaAsset, MediaAssetVersion: schema.MediaAssetVersion }

describe('resolveAssetObjectRef', () => {
  it('addresses the object with the bucket off the row, and touches nothing else', () => {
    const ref = resolveAssetObjectRef(
      anAsset(),
      aVersion({
        storageLocation: aStorageLocation({
          externalId: 'org_test/media-asset/ast_test/logo.png',
          credentialId: TEST_IDS.credentialId,
          metadata: { bucket: TEST_BUCKETS.private, key: 'ignored' },
        }),
      })
    )

    expect(ref).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: 'org_test/media-asset/ast_test/logo.png',
      credentialId: TEST_IDS.credentialId,
    })
  })

  it('ignores the durable externalUrl a public asset carries', () => {
    // A public URL is a browser affordance; the server still reads the object.
    const ref = resolveAssetObjectRef(
      anAsset({ isPrivate: false }),
      aVersion({ storageLocation: aStorageLocation({ externalUrl: 'https://cdn.test/og.png' }) })
    )

    expect(ref.key).toBe(aStorageLocation().externalId)
    expect(ref).not.toHaveProperty('url')
  })

  it('throws rather than inventing a bucket', () => {
    expect(() =>
      resolveAssetObjectRef(
        anAsset(),
        aVersion({ storageLocation: aStorageLocation({ metadata: { key: 'k' } }) })
      )
    ).toThrow(/has no metadata\.bucket/)
  })
})

describe('getAssetContent', () => {
  it('reads the current version through the port, in exactly two statements', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({
      journal,
      results: { getObject: Buffer.from('the-bytes') },
    })

    const result = await getAssetContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrap().toString()).toBe('the-bytes')
    // The asset, then its version, then the object. No `StorageLocation` read:
    // `StorageManager.getContent(locationId)` did one, unscoped, per call.
    expect(journal.ops()).toEqual(['query.findFirst', 'query.findFirst', 'getObject'])
  })

  it('passes the bucket from the row, not a configured default', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [
          aVersion({
            storageLocation: aStorageLocation({
              externalId: 'keys/report.pdf',
              credentialId: TEST_IDS.credentialId,
              metadata: { bucket: TEST_BUCKETS.public },
            }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    await getAssetContent(makeCtx({ db: db.db }), { storage: storage.port }, TEST_IDS.assetId)

    expect(storage.callsTo('getObject')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'keys/report.pdf',
      credentialId: TEST_IDS.credentialId,
    })
  })

  it('serves a numbered version without confusing it for a row id', async () => {
    const db = makeDb({
      query: {
        // `getAssetVersionByNumber` re-runs `requireAsset`, so the asset reads twice.
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

    const result = await getAssetContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId,
      { version: 3 }
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('getObject')[0]?.params.key).toBe('keys/v3.png')
  })

  it('returns NotFoundError for an asset in another organization, and reads nothing', async () => {
    // The org-scoped WHERE means the row simply is not there.
    const db = makeDb({ query: { MediaAsset: [] }, tables: TABLES })
    const storage = makeStoragePort()

    const result = await getAssetContent(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(`Asset ${TEST_IDS.assetId} not found`)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError when the version has no storage location', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [aVersion({ storageLocationId: null, storageLocation: null })],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetContent(
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

  it('fails loudly rather than guessing when the storage location has no bucket', async () => {
    const db = makeDb({
      query: {
        MediaAsset: [anAsset()],
        MediaAssetVersion: [
          aVersion({ storageLocation: aStorageLocation({ metadata: { key: 'k' } }) }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getAssetContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result._unsafeUnwrapErr().message).toContain('has no metadata.bucket')
    // Never read against a guessed bucket: it 404s from the wrong place.
    expect(storage.calls).toEqual([])
  })
})

describe('streamAssetContent', () => {
  it('opens a stream over the same object address the buffered read uses', async () => {
    const db = makeDb({
      query: { MediaAsset: [anAsset()], MediaAssetVersion: [aVersion()] },
      tables: TABLES,
    })
    const storage = makeStoragePort({
      results: { streamObject: Readable.from([Buffer.from('streamed')]) },
    })

    const result = await streamAssetContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      TEST_IDS.assetId
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('streamObject')).toHaveLength(1)
    expect(storage.callsTo('getObject')).toHaveLength(0)
    expect(storage.callsTo('streamObject')[0]?.params.bucket).toBe(TEST_BUCKETS.private)
  })
})
