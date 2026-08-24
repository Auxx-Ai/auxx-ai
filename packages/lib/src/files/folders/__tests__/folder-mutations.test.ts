// packages/lib/src/files/folders/__tests__/folder-mutations.test.ts

/**
 * `folders/folder-mutations.ts` — the write half of what `FolderService` was.
 *
 * **`vi.mock` is called zero times in this file.** `tx` and `ctx.db` are
 * parameters and the version copier arrives as a `FileVersionCopyPort`, so there
 * is nothing left to intercept at module scope — where the legacy `copy` did
 * `new FileService(this.organizationId, this.userId, this.db)` inside its loop.
 *
 * The assertions that matter are the three fixes the module header names:
 *
 * 1. **every `UPDATE` and `DELETE` carries the organization filter** — asserted
 *    off the predicate the stub recorded, not off the return value;
 * 2. **the cascade selects by `folderId`, never by a path prefix** — asserted by
 *    showing a same-prefix sibling (`/Documents` next to `/Doc`) is *not* in the
 *    id set;
 * 3. **a move into a folder's own subtree is refused** with a `ConflictError`
 *    rather than silently creating the cycle the legacy path check missed.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestError, ConflictError, NotFoundError } from '../../../errors'
import { makeClock, makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  copyFolder,
  createFolder,
  deleteFolder,
  ensureFolderPath,
  mergeFolders,
  moveFolder,
  permanentlyDeleteFolder,
  renameFolder,
  restoreFolder,
  updateFolder,
} from '../folder-mutations'
import type { FileVersionCopyPort } from '../ports'

const TABLES = { Folder: schema.Folder, FolderFile: schema.FolderFile }
const AT = new Date('2026-01-01T00:00:00.000Z')
const clock = () => ({ now: makeClock(AT.toISOString()).now })

function aFolder(overrides: Partial<FolderEntity> = {}): FolderEntity {
  return {
    id: 'fld_1',
    organizationId: TEST_IDS.organizationId,
    name: 'Docs',
    parentId: null,
    path: '/Docs',
    depth: 0,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    isArchived: false,
    ...overrides,
  }
}

function aFile(overrides: Partial<FolderFileEntity> = {}): FolderFileEntity {
  return {
    id: 'file_1',
    organizationId: TEST_IDS.organizationId,
    folderId: 'fld_1',
    name: 'report.pdf',
    path: '/Docs/report.pdf',
    ext: 'pdf',
    mimeType: 'application/pdf',
    size: 100,
    checksum: null,
    currentVersionId: null,
    isArchived: false,
    deletedAt: null,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    updatedAt: AT,
    provider: null,
    ...overrides,
  }
}

function aNode(id: string, parentId: string | null, name = id, path = `/${name}`, depth = 0) {
  return { id, parentId, name, path, depth }
}

function asTx(db: ReturnType<typeof makeDb>): Transaction {
  return db.db as unknown as Transaction
}

/** Every `where` predicate the stub recorded, stringified and concatenated. */
function allWheres(db: ReturnType<typeof makeDb>): string {
  return JSON.stringify(db.wheres.map((w) => w.predicate))
}

describe('createFolder', () => {
  it('refuses an illegal name before touching the database', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await createFolder(makeCtx({ db: db.db }), { name: 'a/b' }, clock())

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('writes the caller organization, never one from the payload', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await createFolder(
      makeCtx({ db: db.db, organizationId: 'org_actor' }),
      { name: 'Docs', createdById: TEST_IDS.userId },
      clock()
    )

    expect(result.isOk()).toBe(true)
    expect(db.inserts[0]?.values).toMatchObject({
      organizationId: 'org_actor',
      name: 'Docs',
      parentId: null,
      path: '/Docs',
      depth: 0,
      createdAt: AT,
      updatedAt: AT,
    })
  })

  it('derives path and depth from the parent row', async () => {
    const db = makeDb({
      select: [[aFolder({ id: 'parent', path: '/Docs', depth: 2 })], []],
      tables: TABLES,
    })

    await createFolder(makeCtx({ db: db.db }), { name: 'Invoices', parentId: 'parent' }, clock())

    expect(db.inserts[0]?.values).toMatchObject({ path: '/Docs/Invoices', depth: 3 })
  })

  it('treats the UI root sentinel as no parent', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    await createFolder(makeCtx({ db: db.db }), { name: 'Docs', parentId: 'root' }, clock())
    expect(db.inserts[0]?.values).toMatchObject({ parentId: null, depth: 0 })
    // No parent lookup was issued: the only select is the name-collision check.
    expect(db.journal.ops('db')).toEqual(['select', 'insert'])
  })

  it('fails with ConflictError, not a generic 500, when the name is taken', async () => {
    const db = makeDb({ select: [[aFolder({ id: 'other' })]], tables: TABLES })
    const result = await createFolder(makeCtx({ db: db.db }), { name: 'Docs' }, clock())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })

  it('fails with NotFoundError when the parent is invisible to the caller', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await createFolder(
      makeCtx({ db: db.db }),
      { name: 'Docs', parentId: 'gone' },
      clock()
    )
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('updateFolder', () => {
  it('scopes the UPDATE to the organization, not just the pre-check', async () => {
    const db = makeDb({
      select: [[aFolder()], [], [aNode('fld_1', null, 'Docs', '/Docs')], []],
      update: [[aFolder({ name: 'Papers', path: '/Papers' })]],
      tables: TABLES,
    })

    const result = await updateFolder(
      asTx(db),
      makeCtx({ db: db.db, organizationId: 'org_actor' }),
      'fld_1',
      { name: 'Papers' },
      clock()
    )

    expect(result.isOk()).toBe(true)
    const updateWhere = db.wheres.find((w) => w.table === 'Folder' && w.predicate)
    expect(JSON.stringify(updateWhere?.predicate)).toContain('org_actor')
    expect(allWheres(db)).toContain('org_actor')
  })

  it('recomputes the path from the new name', async () => {
    const db = makeDb({
      select: [[aFolder()], [], [aNode('fld_1', null, 'Docs', '/Docs')], []],
      update: [[aFolder({ name: 'Papers' })]],
      tables: TABLES,
    })

    await updateFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', { name: 'Papers' }, clock())

    expect(db.updates[0]?.values).toMatchObject({
      name: 'Papers',
      path: '/Papers',
      depth: 0,
      updatedAt: AT,
    })
  })

  it('refuses a move into the folder own subtree with ConflictError', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', name: 'A', path: '/A' })],
        [],
        [aNode('a', null, 'A', '/A'), aNode('b', 'a', 'B', '/A/B')],
      ],
      tables: TABLES,
    })

    const result = await updateFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      'a',
      { parentId: 'b' },
      clock()
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(db.updates).toEqual([])
  })

  it('detects the cycle even when every stored path is stale', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', name: 'A', path: '/wrong' })],
        [],
        [aNode('a', null, 'A', '/wrong'), aNode('b', 'a', 'B', '/also-wrong')],
      ],
      tables: TABLES,
    })

    const result = await updateFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      'a',
      { parentId: 'b' },
      clock()
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
  })

  it('fails with NotFoundError when the target parent is invisible', async () => {
    const db = makeDb({
      select: [[aFolder({ id: 'a' })], [], [aNode('a', null)]],
      tables: TABLES,
    })

    const result = await updateFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      'a',
      { parentId: 'other_org_folder' },
      clock()
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('rewrites descendant folders and their file paths', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', name: 'A', path: '/A' })],
        [],
        [
          aNode('a', null, 'A', '/A'),
          aNode('b', 'a', 'B', '/A/B', 1),
          aNode('c', 'b', 'C', '/A/B/C', 2),
        ],
        [aFile({ id: 'f1', folderId: 'b', name: 'x.pdf', path: '/A/B/x.pdf' })],
      ],
      update: [[aFolder({ id: 'a', name: 'Z', path: '/Z' })]],
      tables: TABLES,
    })

    await updateFolder(asTx(db), makeCtx({ db: db.db }), 'a', { name: 'Z' }, clock())

    const written = db.updates.map((u) => u.values as Record<string, unknown>)
    expect(written[0]).toMatchObject({ path: '/Z' })
    expect(written[1]).toMatchObject({ path: '/Z/B', depth: 1 })
    expect(written[2]).toMatchObject({ path: '/Z/B/C', depth: 2 })
    expect(written[3]).toMatchObject({ path: '/Z/B/x.pdf' })
  })

  it('leaves the subtree alone when nothing about the position changed', async () => {
    const db = makeDb({
      select: [[aFolder()], [aNode('fld_1', null, 'Docs', '/Docs')]],
      update: [[aFolder()]],
      tables: TABLES,
    })

    await updateFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', {}, clock())

    expect(db.updates).toHaveLength(1)
  })
})

describe('renameFolder / moveFolder', () => {
  it('rename rejects an illegal name', async () => {
    const db = makeDb({ select: [[aFolder()]], tables: TABLES })
    const result = await renameFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', 'a/b', clock())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('move normalises the UI root sentinel to null', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', parentId: 'p', name: 'A', path: '/P/A', depth: 1 })],
        [],
        [aNode('a', 'p', 'A', '/P/A', 1)],
        [],
      ],
      update: [[aFolder({ id: 'a', parentId: null })]],
      tables: TABLES,
    })

    await moveFolder(asTx(db), makeCtx({ db: db.db }), 'a', 'root', clock())

    expect(db.updates[0]?.values).toMatchObject({ parentId: null, path: '/A', depth: 0 })
  })
})

describe('deleteFolder', () => {
  it('is two statements and names the subtree by id, not by path prefix', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'doc', name: 'Doc', path: '/Doc' })],
        [
          aNode('doc', null, 'Doc', '/Doc'),
          aNode('sub', 'doc', 'Sub', '/Doc/Sub'),
          // The sibling whose name shares a prefix. `/Documents/report.pdf`
          // matched `ilike(path, '/Doc%')` and was deleted with it.
          aNode('documents', null, 'Documents', '/Documents'),
        ],
      ],
      tables: TABLES,
    })

    const result = await deleteFolder(asTx(db), makeCtx({ db: db.db }), 'doc', clock())

    expect(result.isOk()).toBe(true)
    expect(db.journal.ops('db')).toEqual(['select', 'select', 'update', 'update'])
    const wheres = allWheres(db)
    expect(wheres).toContain('doc')
    expect(wheres).toContain('sub')
    expect(wheres).not.toContain('documents')
    expect(wheres).not.toContain('/Doc%')
  })

  it('stamps both tables with the same instant', async () => {
    const db = makeDb({
      select: [[aFolder()], [aNode('fld_1', null)]],
      tables: TABLES,
    })

    await deleteFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', clock())

    expect(db.updates[0]?.values).toMatchObject({ deletedAt: AT, updatedAt: AT })
    expect(db.updates[1]?.values).toMatchObject({ deletedAt: AT, updatedAt: AT })
  })

  it('fails with NotFoundError for a folder outside the organization', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await deleteFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', clock())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(db.updates).toEqual([])
  })
})

describe('restoreFolder', () => {
  it('returns the folder untouched when it was never deleted', async () => {
    const db = makeDb({ select: [[aFolder({ deletedAt: null })]], tables: TABLES })

    const result = await restoreFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', clock())

    expect(result._unsafeUnwrap().id).toBe('fld_1')
    expect(db.updates).toEqual([])
  })

  it('reads the hierarchy including deleted rows, or it would restore nothing', async () => {
    const db = makeDb({
      select: [[aFolder({ deletedAt: AT })], [aNode('fld_1', null), aNode('child', 'fld_1')]],
      update: [[aFolder({ id: 'fld_1', deletedAt: null }), aFolder({ id: 'child' })]],
      tables: TABLES,
    })

    const result = await restoreFolder(asTx(db), makeCtx({ db: db.db }), 'fld_1', clock())

    expect(result._unsafeUnwrap().id).toBe('fld_1')
    // Neither read asks for `deletedAt IS NULL`; both statements carry the org.
    expect(allWheres(db)).toContain(TEST_IDS.organizationId)
    expect(db.updates[0]?.values).toMatchObject({ deletedAt: null })
    expect(db.updates[1]?.values).toMatchObject({ deletedAt: null })
  })
})

describe('permanentlyDeleteFolder', () => {
  it('scopes both hard DELETEs to the organization', async () => {
    const db = makeDb({
      select: [[aFolder({ deletedAt: AT })], [aNode('fld_1', null), aNode('child', 'fld_1')]],
      tables: TABLES,
    })

    const result = await permanentlyDeleteFolder(
      asTx(db),
      makeCtx({ db: db.db, organizationId: 'org_actor' }),
      'fld_1'
    )

    expect(result.isOk()).toBe(true)
    expect(db.deletes.map((d) => d.table)).toEqual(['FolderFile', 'Folder'])
    const deleteWheres = db.wheres.filter((w) => w.table === 'FolderFile' || w.table === 'Folder')
    for (const where of deleteWheres) {
      expect(JSON.stringify(where.predicate)).toContain('org_actor')
    }
  })
})

describe('mergeFolders', () => {
  it('refuses to merge a folder with itself', async () => {
    const db = makeDb({ tables: TABLES })
    const result = await mergeFolders(asTx(db), makeCtx({ db: db.db }), 'a', 'a', clock())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('refuses to merge into its own subtree — the legacy created the cycle', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', name: 'A', path: '/A' })],
        [aFolder({ id: 'b', name: 'B', path: '/A/B', parentId: 'a' })],
        [aNode('a', null, 'A', '/A'), aNode('b', 'a', 'B', '/A/B', 1)],
      ],
      tables: TABLES,
    })

    const result = await mergeFolders(asTx(db), makeCtx({ db: db.db }), 'a', 'b', clock())

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(db.updates).toEqual([])
  })

  it('re-parents files and subfolders, then soft-deletes the source', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'src', name: 'Src', path: '/Src' })],
        [aFolder({ id: 'dst', name: 'Dst', path: '/Dst' })],
        [
          aNode('src', null, 'Src', '/Src'),
          aNode('dst', null, 'Dst', '/Dst'),
          aNode('child', 'src', 'Child', '/Src/Child', 1),
        ],
        [aFile({ id: 'f1', folderId: 'src', name: 'x.pdf', path: '/Src/x.pdf' })],
        [],
      ],
      tables: TABLES,
    })

    const result = await mergeFolders(asTx(db), makeCtx({ db: db.db }), 'src', 'dst', clock())

    expect(result.isOk()).toBe(true)
    const written = db.updates.map((u) => u.values as Record<string, unknown>)
    expect(written[0]).toMatchObject({ folderId: 'dst', path: '/Dst/x.pdf' })
    expect(written[1]).toMatchObject({ parentId: 'dst', path: '/Dst/Child', depth: 1 })
    expect(written.at(-1)).toMatchObject({ deletedAt: AT })
  })
})

describe('copyFolder', () => {
  function copyDeps(port: FileVersionCopyPort) {
    return { now: makeClock(AT.toISOString()).now, files: port }
  }

  it('copies files through the port instead of constructing a FileService', async () => {
    const copyFileVersions = vi.fn(async () => {})
    const db = makeDb({
      select: [
        [aFolder({ id: 'src', name: 'Src', path: '/Src' })], // requireFolder(source)
        [], // assertNameAvailable
        [aNode('src', null, 'Src', '/Src')], // loadFolderNodes
        [], // insertFolder -> assertNameAvailable (no parent)
        [aFile({ id: 'f1', folderId: 'src', name: 'x.pdf', path: '/Src/x.pdf' })], // files
      ],
      insert: [
        [aFolder({ id: 'copy', name: 'Copy of Src', path: '/Copy of Src' })],
        [aFile({ id: 'f2', folderId: 'copy', name: 'x.pdf', path: '/Copy of Src/x.pdf' })],
      ],
      tables: TABLES,
    })

    const result = await copyFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      { sourceId: 'src', targetParentId: null },
      copyDeps({ copyFileVersions })
    )

    expect(result._unsafeUnwrap().id).toBe('copy')
    expect(copyFileVersions).toHaveBeenCalledExactlyOnceWith('f1', 'f2')
    expect(db.inserts[1]?.values).toMatchObject({
      folderId: 'copy',
      path: '/Copy of Src/x.pdf',
    })
  })

  it('defaults the copy name to "Copy of <source>"', async () => {
    const db = makeDb({
      select: [[aFolder({ id: 'src', name: 'Src' })], [], [aNode('src', null)], [], []],
      insert: [[aFolder({ id: 'copy' })]],
      tables: TABLES,
    })

    await copyFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      { sourceId: 'src', targetParentId: null },
      copyDeps({ copyFileVersions: async () => {} })
    )

    expect(db.inserts[0]?.values).toMatchObject({ name: 'Copy of Src' })
  })

  it('refuses to copy a folder into its own subtree', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'src', name: 'Src', path: '/Src' })],
        [aFolder({ id: 'child', name: 'Child', path: '/Src/Child', parentId: 'src' })],
        [],
        [aNode('src', null, 'Src', '/Src'), aNode('child', 'src', 'Child', '/Src/Child', 1)],
      ],
      tables: TABLES,
    })

    const result = await copyFolder(
      asTx(db),
      makeCtx({ db: db.db }),
      { sourceId: 'src', targetParentId: 'child' },
      copyDeps({ copyFileVersions: async () => {} })
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    expect(db.inserts).toEqual([])
  })
})

describe('ensureFolderPath', () => {
  it('rejects a path that names no folder', async () => {
    const db = makeDb({ tables: TABLES })
    const result = await ensureFolderPath(makeCtx({ db: db.db }), '///', clock())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('reuses an existing segment and creates only the missing one', async () => {
    const db = makeDb({
      select: [
        [aFolder({ id: 'a', name: 'a', path: '/a' })], // 'a' exists
        [], // 'b' does not
        [aFolder({ id: 'a', name: 'a', path: '/a' })], // insertFolder -> parent lookup
        [], // insertFolder -> name check
      ],
      insert: [[aFolder({ id: 'b', name: 'b', parentId: 'a', path: '/a/b', depth: 1 })]],
      tables: TABLES,
    })

    const result = await ensureFolderPath(makeCtx({ db: db.db }), 'a/b', clock(), {
      createdById: TEST_IDS.userId,
    })

    expect(result._unsafeUnwrap().id).toBe('b')
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]?.values).toMatchObject({ name: 'b', parentId: 'a', path: '/a/b' })
  })
})
