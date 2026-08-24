// packages/lib/src/files/folder-files/__tests__/download.test.ts

/**
 * `getFolderFileDownloadRef` — the single accessor that replaced
 * `FileService.getDownloadRef`, `.getDownloadRefForVersion` and
 * `.getDownloadInfo`.
 *
 * Zero `vi.mock` calls: `ctx.db`, `deps.storage` and `deps.now` are all
 * parameters. The equivalent test against `FileService` needed
 * `vi.mock('../storage/storage-manager')`, a database mock, and fake timers for
 * the `expiresAt` fallback.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  aStorageLocation,
  makeClock,
  makeCtx,
  makeDb,
  makeJournal,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from '../../__tests__/support'
import { DEFAULT_DOWNLOAD_TTL_MS, getFolderFileDownloadRef } from '../download'
import { aFileVersion, aFolderFile, FILE_IDS } from './support/fixtures'

const TABLES = { FolderFile: schema.FolderFile, FileVersion: schema.FileVersion }

const clock = makeClock()

function depsWith(storage: ReturnType<typeof makeStoragePort>) {
  return { storage: storage.port, now: clock.now }
}

describe('getFolderFileDownloadRef', () => {
  it('presigns with the bucket from the StorageLocation row, never from config', async () => {
    const db = makeDb({
      select: [[aFolderFile({ name: 'invoice.pdf', mimeType: 'application/pdf' })]],
      query: {
        FileVersion: [
          aFileVersion({
            storageLocation: aStorageLocation({
              externalId: 'org_test/file/fil_test/invoice.pdf',
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

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId,
      { disposition: 'attachment', ttlSec: 900 }
    )

    expect(result._unsafeUnwrap()).toMatchObject({
      type: 'url',
      url: 'https://s3.test/signed',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      versionNumber: 1,
      expiresAt: new Date(0),
    })
    // The bucket came off the row — the assertion #1816/#1817/#1818 lacked.
    expect(storage.callsTo('presignDownload')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'org_test/file/fil_test/invoice.pdf',
      credentialId: TEST_IDS.credentialId,
      ttlSec: 900,
      disposition: 'attachment',
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
    })
  })

  it('never takes the public-URL shortcut — a FolderFile has no isPrivate column', async () => {
    // `assets/download.ts` returns `location.externalUrl` for a non-private
    // asset. There is no such branch here: a file-library file is always
    // private, so every ref is presigned even when the row carries an
    // `externalUrl`.
    const db = makeDb({
      select: [[aFolderFile()]],
      query: {
        FileVersion: [
          aFileVersion({
            storageLocation: aStorageLocation({ externalUrl: 'https://cdn.test/leak.pdf' }),
          }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    const ref = result._unsafeUnwrap()
    expect(ref.type).toBe('url')
    expect(ref.type === 'url' && ref.url).not.toBe('https://cdn.test/leak.pdf')
    expect(storage.callsTo('presignDownload')).toHaveLength(1)
  })

  it('stamps a 10-minute fallback expiry when the provider gives none', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })
    const storage = makeStoragePort({
      results: { presignDownload: { type: 'url', url: 'https://s3.test/signed' } },
    })

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrap().expiresAt).toEqual(
      new Date(clock.millis() + DEFAULT_DOWNLOAD_TTL_MS)
    )
  })

  it('resolves an explicit version NUMBER, not a version id', async () => {
    const journal = makeJournal()
    const db = makeDb({
      select: [[aFolderFile()], [aFolderFile()]],
      query: {
        FileVersion: [
          aFileVersion({
            id: 'fve_old',
            versionNumber: 3,
            storageLocation: aStorageLocation({ externalId: 'keys/old.pdf' }),
          }),
        ],
      },
      tables: TABLES,
      journal,
    })
    const storage = makeStoragePort({ journal })

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId,
      { version: 3 }
    )

    expect(result._unsafeUnwrap().versionNumber).toBe(3)
    expect(storage.callsTo('presignDownload')[0]?.params.key).toBe('keys/old.pdf')
  })

  it("resolves 'latest' by version number rather than by currentVersionId", async () => {
    // `current` and `latest` diverge after a restore: the pointer moves back
    // while the highest number stays where it was.
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: 'fve_restored' })]],
      query: { FileVersion: [aFileVersion({ id: 'fve_newest', versionNumber: 9 })] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId,
      { version: 'latest' }
    )

    expect(result._unsafeUnwrap().versionNumber).toBe(9)
  })

  it('refuses an archived file, as all three legacy accessors did', async () => {
    const db = makeDb({ select: [[aFolderFile({ isArchived: true })]], tables: TABLES })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError, not a leak, for a file in another organization', async () => {
    // The org-scoped WHERE means the row simply is not there, and the message
    // must not confirm the id exists elsewhere.
    const db = makeDb({ select: [[]], tables: TABLES })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(`File ${FILE_IDS.fileId} not found`)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError when the file has no version at all', async () => {
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: null })]],
      query: { FileVersion: [undefined] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(storage.calls).toEqual([])
  })

  it('returns NotFoundError when the version has no storage location', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion({ storageLocation: null })] },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe(
      `No storage location found for file ${FILE_IDS.fileId}`
    )
    expect(storage.calls).toEqual([])
  })

  it('fails loudly rather than guessing when the storage location has no bucket', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: {
        FileVersion: [
          aFileVersion({ storageLocation: aStorageLocation({ metadata: { key: 'k' } }) }),
        ],
      },
      tables: TABLES,
    })
    const storage = makeStoragePort()

    const result = await getFolderFileDownloadRef(
      makeCtx({ db: db.db }),
      depsWith(storage),
      FILE_IDS.fileId
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(500)
    expect(result._unsafeUnwrapErr().message).toContain('has no metadata.bucket')
    // Never presign against a guessed bucket: a wrong-bucket delete 204s.
    expect(storage.calls).toEqual([])
  })

  it('scopes the file read to the caller org and the version read to the file', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })

    await getFolderFileDownloadRef(
      makeCtx({ db: db.db, organizationId: 'org_other' }),
      depsWith(makeStoragePort()),
      FILE_IDS.fileId
    )

    const fileSql = JSON.stringify(db.wheres[0]?.predicate)
    expect(fileSql).toContain('org_other')
    expect(fileSql).toContain(FILE_IDS.fileId)
    expect(fileSql).toContain(' is null')

    const versionRead = db.journal.entries.find((e) => e.op === 'query.findFirst')
    expect(JSON.stringify((versionRead?.detail?.args as { where?: unknown })?.where)).toContain(
      FILE_IDS.fileId
    )
  })
})
