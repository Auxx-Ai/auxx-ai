// packages/lib/src/files/folder-files/__tests__/version-mutations.test.ts

/**
 * `folder-files/version-mutations.ts`.
 *
 * The properties worth pinning here are the ones the legacy `FileService`
 * version methods got wrong: the `currentVersionId` move was unscoped, the
 * `size`/`mimeType` inheritance from the storage location was overwritten with
 * `undefined`, `copyVersions` inverted the history, and every method opened a
 * nested savepoint through `getTx`.
 *
 * Zero `vi.mock` calls.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  aStorageLocation,
  DEFAULT_TEST_INSTANT,
  makeClock,
  makeCtx,
  makeDb,
  TEST_IDS,
} from '../../__tests__/support'
import {
  copyFileVersions,
  createFileVersion,
  deleteFileVersion,
  restoreFileVersion,
} from '../version-mutations'
import { aFileVersion, aFolderFile, FILE_IDS } from './support/fixtures'

const TABLES = {
  FolderFile: schema.FolderFile,
  FileVersion: schema.FileVersion,
  StorageLocation: schema.StorageLocation,
}

const deps = { now: makeClock().now }
const AT = new Date(DEFAULT_TEST_INSTANT)

function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  return JSON.stringify(db.wheres[index]?.predicate)
}

describe('createFileVersion', () => {
  it('numbers the row last + 1 and scopes the currentVersionId move to the organization', async () => {
    // The legacy `UPDATE FolderFile SET currentVersionId = … WHERE id = ?` had
    // no organization filter anywhere in the statement.
    const db = makeDb({
      select: [[aFolderFile()]],
      query: {
        FileVersion: [{ versionNumber: 4 }],
        StorageLocation: [aStorageLocation()],
      },
      insert: [[aFileVersion({ id: 'fve_new', versionNumber: 5 })]],
      tables: TABLES,
    })

    const result = await createFileVersion(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      { fileId: FILE_IDS.fileId, storageLocationId: TEST_IDS.storageLocationId }
    )

    expect(result.isOk()).toBe(true)
    expect(db.inserts[0]?.values).toMatchObject({ versionNumber: 5 })
    // wheres[0] is the file existence check; wheres[1] is the pointer move.
    expect(whereOf(db, 1)).toContain('org_owner')
    expect(db.transactions).toBe(0)
  })

  it('inherits size and mimeType from the storage location when the input omits them', async () => {
    // The legacy body spread `metadata` over the location's values, so
    // `{ size: undefined }` — which `createWithVersion` passed whenever
    // `CreateFileRequest.size` was absent — persisted NULL.
    const db = makeDb({
      select: [[aFolderFile()]],
      query: {
        FileVersion: [undefined],
        StorageLocation: [aStorageLocation({ size: 4096, mimeType: 'image/png' })],
      },
      insert: [[aFileVersion()]],
      tables: TABLES,
    })

    await createFileVersion(db.db as unknown as Transaction, makeCtx({ db: db.db }), {
      fileId: FILE_IDS.fileId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.inserts[0]?.values).toMatchObject({ size: 4096, mimeType: 'image/png' })
  })

  it('starts at version 1 for a file with no versions yet', async () => {
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: null })]],
      query: { FileVersion: [undefined], StorageLocation: [aStorageLocation()] },
      insert: [[aFileVersion()]],
      tables: TABLES,
    })

    await createFileVersion(db.db as unknown as Transaction, makeCtx({ db: db.db }), {
      fileId: FILE_IDS.fileId,
      storageLocationId: TEST_IDS.storageLocationId,
    })

    expect(db.inserts[0]?.values).toMatchObject({ versionNumber: 1 })
  })

  it('refuses a file in another organization before touching FileVersion', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await createFileVersion(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      { fileId: FILE_IDS.fileId, storageLocationId: TEST_IDS.storageLocationId }
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })

  it('404s a missing storage location rather than inserting a dangling version', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [undefined], StorageLocation: [undefined] },
      tables: TABLES,
    })

    const result = await createFileVersion(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      { fileId: FILE_IDS.fileId, storageLocationId: 'loc_missing' }
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })
})

describe('restoreFileVersion', () => {
  it('points the file at the numbered version, organization-scoped', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [aFileVersion({ id: 'fve_old', versionNumber: 2 })] },
      update: [[aFolderFile()]],
      tables: TABLES,
    })

    const result = await restoreFileVersion(
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      deps,
      FILE_IDS.fileId,
      2
    )

    expect(result.isOk()).toBe(true)
    expect(db.updates[0]?.values).toEqual({ currentVersionId: 'fve_old', updatedAt: AT })
    // wheres[0] is the file existence check inside the version lookup.
    expect(whereOf(db, 1)).toContain('org_owner')
  })

  it('404s a version number the file does not have', async () => {
    const db = makeDb({
      select: [[aFolderFile()]],
      query: { FileVersion: [undefined] },
      tables: TABLES,
    })

    const result = await restoreFileVersion(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, 9)

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.updates).toEqual([])
  })
})

describe('deleteFileVersion', () => {
  it('refuses to delete the current version with a 409', async () => {
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: FILE_IDS.versionId })], [aFolderFile()]],
      query: { FileVersion: [aFileVersion()] },
      tables: TABLES,
    })

    const result = await deleteFileVersion(makeCtx({ db: db.db }), FILE_IDS.fileId, 1)

    expect(result._unsafeUnwrapErr().statusCode).toBe(409)
    expect(db.deletes).toEqual([])
  })

  it('deletes a non-current version, constrained by both the version id and the file id', async () => {
    const db = makeDb({
      select: [[aFolderFile({ currentVersionId: 'fve_current' })], [aFolderFile()]],
      query: { FileVersion: [aFileVersion({ id: 'fve_old', versionNumber: 2 })] },
      tables: TABLES,
    })

    const result = await deleteFileVersion(makeCtx({ db: db.db }), FILE_IDS.fileId, 2)

    expect(result.isOk()).toBe(true)
    expect(db.deletes).toEqual([{ table: 'FileVersion' }])
    const where = whereOf(db, 2)
    expect(where).toContain('fve_old')
    expect(where).toContain(FILE_IDS.fileId)
  })
})

describe('copyFileVersions', () => {
  it('copies oldest-first so the history is not inverted', async () => {
    // The legacy `copyVersions` iterated `getVersions`, which orders
    // `versionNumber DESC`, while each insert numbered its row `last + 1` — so
    // a three-version file came out reversed.
    const source = [
      aFileVersion({ id: 'fve_1', versionNumber: 1, storageLocationId: 'loc_1' }),
      aFileVersion({ id: 'fve_2', versionNumber: 2, storageLocationId: 'loc_2' }),
    ]
    const db = makeDb({
      // requireFolderFile(source), requireFolderFile(target), then one
      // requireFolderFile(target) per inserted version.
      select: [
        [aFolderFile()],
        [aFolderFile({ id: 'fil_copy' })],
        [aFolderFile({ id: 'fil_copy' })],
        [aFolderFile({ id: 'fil_copy' })],
      ],
      query: {
        FileVersion: [source, undefined, { versionNumber: 1 }],
        StorageLocation: [aStorageLocation({ id: 'loc_1' }), aStorageLocation({ id: 'loc_2' })],
      },
      insert: [
        [aFileVersion({ id: 'fve_c1', fileId: 'fil_copy', versionNumber: 1 })],
        [aFileVersion({ id: 'fve_c2', fileId: 'fil_copy', versionNumber: 2 })],
      ],
      tables: TABLES,
    })

    const result = await copyFileVersions(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      FILE_IDS.fileId,
      'fil_copy'
    )

    expect(result.isOk()).toBe(true)
    expect(db.inserts.map((i) => (i.values as { storageLocationId: string }).storageLocationId)) //
      .toEqual(['loc_1', 'loc_2'])
    expect(db.inserts.map((i) => (i.values as { versionNumber: number }).versionNumber)) //
      .toEqual([1, 2])
  })

  it('refuses when the target file is not in the caller organization', async () => {
    const db = makeDb({ select: [[aFolderFile()], []], tables: TABLES })

    const result = await copyFileVersions(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      FILE_IDS.fileId,
      'fil_elsewhere'
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })
})
