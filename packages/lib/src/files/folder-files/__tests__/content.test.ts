// packages/lib/src/files/folder-files/__tests__/content.test.ts

/**
 * `getFolderFileContent` / `streamFolderFileContent` / `resolveFolderFileObjectRef`
 * — the content reads that replace `FileService.getContent`.
 *
 * Zero `vi.mock` calls: `ctx.db` and `deps.storage` are both parameters.
 *
 * Two behaviours here are inherited rather than chosen, and both have a test so
 * a future change to either is deliberate: an **archived** file's bytes are
 * still readable (the download path refuses one), and the bucket comes off the
 * `StorageLocation` row rather than from config (#1816/#1817/#1818).
 */

import { Readable } from 'node:stream'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  aStorageLocation,
  makeCtx,
  makeDb,
  makeJournal,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import {
  getFolderFileContent,
  resolveFolderFileObjectRef,
  streamFolderFileContent,
} from '../content'
import { aFileVersion, aFolderFile, FILE_IDS } from './support/fixtures'

const TABLES = { FolderFile: schema.FolderFile, FileVersion: schema.FileVersion }

describe('resolveFolderFileObjectRef', () => {
  it('addresses the object with the bucket off the row', () => {
    const ref = resolveFolderFileObjectRef(
      aFolderFile(),
      aFileVersion({
        storageLocation: aStorageLocation({
          externalId: 'org_test/file/fil_test/contract.pdf',
          credentialId: TEST_IDS.credentialId,
          metadata: { bucket: TEST_BUCKETS.private, key: 'ignored' },
        }),
      })
    )

    expect(ref).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: 'org_test/file/fil_test/contract.pdf',
      credentialId: TEST_IDS.credentialId,
    })
  })

  it('throws rather than inventing a bucket', () => {
    expect(() =>
      resolveFolderFileObjectRef(
        aFolderFile(),
        aFileVersion({ storageLocation: aStorageLocation({ metadata: { key: 'k' } }) })
      )
    ).toThrow(/has no metadata\.bucket/)
  })
})

describe('getFolderFileContent', () => {
  it('reads the current version through the port, in exactly two statements', async () => {
    const journal = makeJournal()
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal, results: { getObject: Buffer.from('the-bytes') } })

    const result = await getFolderFileContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrap().toString()).toBe('the-bytes')
    // No `StorageLocation` read: `StorageManager.getContent(locationId)` did one,
    // unscoped, on every call.
    expect(journal.ops('storage')).toEqual(['getObject'])
  })

  it('passes the bucket from the row, not a configured default', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: {
        FileVersion: [
          aFileVersion({
            storageLocation: aStorageLocation({
              externalId: 'keys/contract.pdf',
              credentialId: TEST_IDS.credentialId,
              metadata: { bucket: TEST_BUCKETS.public },
            }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    await getFolderFileContent(makeCtx({ db: db.db }), { storage: storage.port }, FILE_IDS.fileId)

    expect(storage.callsTo('getObject')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'keys/contract.pdf',
      credentialId: TEST_IDS.credentialId,
    })
  })

  it('still reads an ARCHIVED file, unlike the download path', async () => {
    // `FileService.getContent` resolved through `requireFolderFile`, which does
    // not look at `isArchived`. Narrowing that is a product decision, so the
    // asymmetry with `getFolderFileDownloadRef` is preserved on purpose.
    const db = makeDb({
      select: [[aFolderFile({ isArchived: true })]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      FILE_IDS.fileId
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('getObject')).toHaveLength(1)
  })

  it('returns NotFoundError for a file in another organization, and reads nothing', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const storage = makeStoragePort()

    const result = await getFolderFileContent(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      { storage: storage.port },
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(`File ${FILE_IDS.fileId} not found`)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError when the version has no storage location', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      // `FileVersion.storageLocationId` is NOT NULL, so the reachable shape of
      // "no location" is a row whose join came back empty (a purged location).
      query: { FileVersion: [aFileVersion({ storageLocation: null })] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(
      `No storage location found for file ${FILE_IDS.fileId}`
    )
    expect(storage.calls).toEqual([])
  })
})

describe('streamFolderFileContent', () => {
  it('opens a stream over the same object address the buffered read uses', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })
    const storage = makeStoragePort({
      results: { streamObject: Readable.from([Buffer.from('streamed')]) },
    })

    const result = await streamFolderFileContent(
      makeCtx({ db: db.db }),
      { storage: storage.port },
      FILE_IDS.fileId
    )

    expect(result.isOk()).toBe(true)
    expect(storage.callsTo('streamObject')).toHaveLength(1)
    expect(storage.callsTo('getObject')).toHaveLength(0)
  })
})
