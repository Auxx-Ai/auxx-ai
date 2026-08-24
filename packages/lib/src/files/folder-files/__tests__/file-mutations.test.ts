// packages/lib/src/files/folder-files/__tests__/file-mutations.test.ts

/**
 * `folder-files/file-mutations.ts` — the write half of what `FileService` was.
 *
 * Zero `vi.mock` calls: `ctx.db` and `deps.now` are parameters, so neither the
 * database nor the clock has to be intercepted at module scope. The legacy
 * equivalent needed a hand-rolled Drizzle builder chain per statement *and*
 * `vi.useFakeTimers()` to assert a timestamp.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEST_INSTANT, makeClock, makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  copyFolderFile,
  createFolderFile,
  createFolderFileWithVersion,
  deleteFolderFile,
  moveFolderFile,
  renameFolderFile,
  restoreFolderFile,
  updateFolderFile,
} from '../file-mutations'
import { aFolderFile, FILE_IDS } from './support/fixtures'

const TABLES = {
  FolderFile: schema.FolderFile,
  FileVersion: schema.FileVersion,
  Folder: schema.Folder,
  StorageLocation: schema.StorageLocation,
}

const deps = { now: makeClock().now }
const AT = new Date(DEFAULT_TEST_INSTANT)

/** The predicate handed to the n-th builder statement, stringified. */
function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  return JSON.stringify(db.wheres[index]?.predicate)
}

describe('createFolderFile', () => {
  it('takes the organization from ctx, never from the input', async () => {
    // `processCreateData` read `data.organizationId` and only fell back to the
    // service's scope, so a caller could write into an org it was not acting for.
    const db = makeDb({ select: [[]], insert: [[aFolderFile()]], tables: TABLES })

    await createFolderFile(makeCtx({ db: db.db, organizationId: 'org_owner' }), deps, {
      name: 'contract.pdf',
      folderId: null,
    })

    expect(db.inserts[0]?.values).toMatchObject({ organizationId: 'org_owner' })
  })

  it('derives a collision-safe path and lowercases the extension', async () => {
    const db = makeDb({ select: [[]], insert: [[aFolderFile()]], tables: TABLES })

    await createFolderFile(makeCtx({ db: db.db }), deps, {
      name: 'Example.JPG',
      ext: 'JPG',
      folderId: null,
    })

    expect(db.inserts[0]?.values).toMatchObject({ ext: 'jpg', path: '/Example.JPG' })
  })

  it('keeps an explicit path and skips the collision probe entirely', async () => {
    const db = makeDb({ insert: [[aFolderFile()]], tables: TABLES })

    await createFolderFile(makeCtx({ db: db.db }), deps, {
      name: 'x.pdf',
      path: '/provided/path',
    })

    expect(db.inserts[0]?.values).toMatchObject({ path: '/provided/path' })
    expect(db.journal.ops('db')).toEqual(['insert'])
  })

  it('treats an empty-string folderId as the root, not as a folder id', async () => {
    // The uploader sends `''` when nothing is selected, and a bare `''` violates
    // the FK.
    const db = makeDb({ select: [[]], insert: [[aFolderFile()]], tables: TABLES })

    await createFolderFile(makeCtx({ db: db.db }), deps, { name: 'x.pdf', folderId: '' })

    expect(db.inserts[0]?.values).toMatchObject({ folderId: null })
  })

  it('stamps createdAt and updatedAt from deps.now, not the wall clock', async () => {
    const db = makeDb({ select: [[]], insert: [[aFolderFile()]], tables: TABLES })

    await createFolderFile(makeCtx({ db: db.db }), deps, { name: 'x.pdf', folderId: null })

    expect(db.inserts[0]?.values).toMatchObject({ createdAt: AT, updatedAt: AT })
  })

  it('rejects a blank name with a 400 rather than writing a row', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await createFolderFile(makeCtx({ db: db.db }), deps, { name: '   ' })

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(db.inserts).toEqual([])
  })
})

describe('createFolderFileWithVersion', () => {
  it('inserts the file, the version, and moves currentVersionId — all on tx', async () => {
    const db = makeDb({
      select: [[], [aFolderFile()]],
      insert: [[aFolderFile()], [{ id: FILE_IDS.versionId, fileId: FILE_IDS.fileId }]],
      query: { FileVersion: [undefined], StorageLocation: [{ id: TEST_IDS.storageLocationId }] },
      tables: TABLES,
    })

    const result = await createFolderFileWithVersion(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      deps,
      { name: 'x.pdf', folderId: null, storageLocationId: TEST_IDS.storageLocationId }
    )

    expect(result.isOk()).toBe(true)
    expect(db.inserts.map((i) => i.table)).toEqual(['FolderFile', 'FileVersion'])
    expect(db.updates.map((u) => u.table)).toEqual(['FolderFile'])
    // Never opens a transaction of its own — the caller owns the boundary.
    expect(db.transactions).toBe(0)
  })

  it('rejects rather than resolving when the version cannot be written', async () => {
    // Returning `err()` from inside a caller's transaction would resolve
    // normally and the caller would commit a file with no version.
    const db = makeDb({
      select: [[], [aFolderFile()]],
      insert: [[aFolderFile()]],
      query: { FileVersion: [undefined], StorageLocation: [undefined] },
      tables: TABLES,
    })

    const result = await createFolderFileWithVersion(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      deps,
      { name: 'x.pdf', folderId: null, storageLocationId: 'loc_missing' }
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })
})

describe('updateFolderFile', () => {
  it('scopes the UPDATE to the caller organization', async () => {
    const db = makeDb({ update: [[aFolderFile()]], tables: TABLES })

    await updateFolderFile(makeCtx({ db: db.db, organizationId: 'org_owner' }), deps, 'fil_1', {
      isArchived: true,
    })

    expect(whereOf(db, 0)).toContain('org_owner')
    expect(db.updates[0]?.values).toMatchObject({ isArchived: true, updatedAt: AT })
  })

  it('leaves absent fields alone and clears ext on an empty string', async () => {
    const db = makeDb({ update: [[aFolderFile()]], tables: TABLES })

    await updateFolderFile(makeCtx({ db: db.db }), deps, 'fil_1', { ext: '' })

    expect(db.updates[0]?.values).toEqual({ ext: null, updatedAt: AT })
  })

  it('returns NotFoundError when the UPDATE matched no row', async () => {
    const db = makeDb({ update: [[]], tables: TABLES })

    const result = await updateFolderFile(makeCtx({ db: db.db }), deps, 'fil_missing', {
      name: 'x',
    })

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })
})

describe('deleteFolderFile', () => {
  it('stamps deletedAt within the caller organization', async () => {
    const db = makeDb({ update: [[]], tables: TABLES })

    const result = await deleteFolderFile(
      makeCtx({ db: db.db, organizationId: 'org_owner' }),
      deps,
      FILE_IDS.fileId
    )

    expect(result.isOk()).toBe(true)
    expect(db.updates[0]?.values).toEqual({ deletedAt: AT })
    expect(whereOf(db, 0)).toContain('org_owner')
  })

  it('is idempotent: deleting an id that matched nothing still succeeds', async () => {
    // Preserved deliberately — a double-clicked delete button relies on it.
    const db = makeDb({ update: [[]], tables: TABLES })

    const result = await deleteFolderFile(makeCtx({ db: db.db }), deps, 'fil_missing')

    expect(result.isOk()).toBe(true)
  })
})

describe('restoreFolderFile', () => {
  it('clears deletedAt and reports a miss, unlike delete', async () => {
    const found = makeDb({ update: [[aFolderFile()]], tables: TABLES })
    await restoreFolderFile(makeCtx({ db: found.db }), deps, FILE_IDS.fileId)
    expect(found.updates[0]?.values).toEqual({ deletedAt: null, updatedAt: AT })

    const missing = makeDb({ update: [[]], tables: TABLES })
    const result = await restoreFolderFile(makeCtx({ db: missing.db }), deps, 'fil_missing')
    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
  })
})

describe('moveFolderFile', () => {
  it('writes folderId: null when moving to the root', async () => {
    // THE bug this replaces: the legacy `move` passed `target ?? undefined` into
    // an `update` that skipped undefined fields, so a move to the root rewrote
    // `path` while leaving the row in its old folder.
    const db = makeDb({
      select: [[aFolderFile()], []],
      update: [[aFolderFile({ folderId: null })]],
      tables: TABLES,
    })

    await moveFolderFile(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, null)

    expect(db.updates[0]?.values).toMatchObject({ folderId: null, path: '/contract.pdf' })
  })

  it("treats the string 'root' as the root", async () => {
    const db = makeDb({
      select: [[aFolderFile()], []],
      update: [[aFolderFile()]],
      tables: TABLES,
    })

    await moveFolderFile(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, 'root')

    expect(db.updates[0]?.values).toMatchObject({ folderId: null })
  })

  it('refuses a destination folder outside the organization', async () => {
    // The destination is resolved org-scoped by `resolveUniqueFilePath`, so no
    // separate validation can drift from it.
    const db = makeDb({ select: [[aFolderFile()], []], tables: TABLES })

    const result = await moveFolderFile(
      makeCtx({ db: db.db }),
      deps,
      FILE_IDS.fileId,
      'fld_elsewhere'
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.updates).toEqual([])
  })
})

describe('renameFolderFile', () => {
  it('re-derives the path and the extension from the new name', async () => {
    const db = makeDb({
      select: [[aFolderFile()], [{ path: '/Legal' }], []],
      update: [[aFolderFile()]],
      tables: TABLES,
    })

    await renameFolderFile(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, 'notes.md')

    expect(db.updates[0]?.values).toMatchObject({
      name: 'notes.md',
      path: '/Legal/notes.md',
      ext: 'md',
      updatedAt: AT,
    })
  })

  it('clears ext when the new name has none', async () => {
    const db = makeDb({
      select: [[aFolderFile()], [{ path: '/Legal' }], []],
      update: [[aFolderFile()]],
      tables: TABLES,
    })

    await renameFolderFile(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, 'README')

    expect(db.updates[0]?.values).toMatchObject({ ext: null })
  })

  it('rejects a blank name with a 400 before reading anything', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await renameFolderFile(makeCtx({ db: db.db }), deps, FILE_IDS.fileId, '   ')

    expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    expect(db.journal.entries).toEqual([])
  })
})

describe('copyFolderFile', () => {
  it('defaults the name, copies the metadata, and never opens its own transaction', async () => {
    const db = makeDb({
      // requireFolderFile(source), path probe, requireFolderFile(source) again
      // inside copyFileVersions, requireFolderFile(target)
      select: [[aFolderFile()], [], [aFolderFile()], [aFolderFile({ id: 'fil_copy' })]],
      insert: [[aFolderFile({ id: 'fil_copy' })]],
      query: { FileVersion: [[]] },
      tables: TABLES,
    })

    const result = await copyFolderFile(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      deps,
      { sourceFileId: FILE_IDS.fileId, targetFolderId: null, createdById: TEST_IDS.userId }
    )

    expect(result.isOk()).toBe(true)
    expect(db.inserts[0]?.values).toMatchObject({
      name: 'Copy of contract.pdf',
      ext: 'pdf',
      mimeType: 'application/pdf',
      size: 2048,
      createdById: TEST_IDS.userId,
    })
    expect(db.transactions).toBe(0)
  })

  it('refuses a source file in another organization before inserting anything', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await copyFolderFile(
      db.db as unknown as Transaction,
      makeCtx({ db: db.db }),
      deps,
      { sourceFileId: FILE_IDS.fileId, targetFolderId: null }
    )

    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(db.inserts).toEqual([])
  })
})
