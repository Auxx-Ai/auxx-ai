// packages/lib/src/files/filesystem/__tests__/filesystem-mutations.test.ts

/**
 * `filesystem/filesystem-mutations.ts` — applying one planned entry, and
 * renaming one item.
 *
 * **`vi.mock` is called zero times in this file.** `tx` and `ctx.db` are
 * parameters, and the collaborators are the `folders/` and `folder-files/`
 * functions rather than a `FolderService` constructed on the open transaction —
 * which is what the legacy did at four separate sites.
 *
 * Two properties beyond "it writes something":
 *
 * 1. **Lib opens no transaction.** `FilesystemService` called
 *    `this.dbInstance.transaction(...)` three times, on a client typed
 *    `Database | Transaction` — so on an already-open transaction those were
 *    `SAVEPOINT`s, and whether a best-effort move isolated anything depended on
 *    who constructed the service. `db.transactions` must stay `0`.
 * 2. **A folder move-with-rename is ONE update pass.** The legacy ran `move`
 *    then `rename`, and each rewrote the path and depth of every row in the
 *    subtree, so a collision cost the whole cascade twice.
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import { makeClock, makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import { executeMoveEntry, renameFilesystemItem } from '../filesystem-mutations'
import type { MovePlanEntry } from '../move-plan'

const TABLES = { Folder: schema.Folder, FolderFile: schema.FolderFile }
const AT = new Date('2026-01-01T00:00:00.000Z')
const deps = () => ({ now: makeClock(AT.toISOString()).now })

function asTx(db: ReturnType<typeof makeDb>): Transaction {
  return db.db as unknown as Transaction
}

function aFile(overrides: Partial<FolderFileEntity> = {}): FolderFileEntity {
  return {
    id: 'file_1',
    organizationId: TEST_IDS.organizationId,
    folderId: 'SRC',
    name: 'a.txt',
    path: '/SRC/a.txt',
    ext: 'txt',
    mimeType: 'text/plain',
    size: 10,
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

function aFolder(overrides: Partial<FolderEntity> = {}): FolderEntity {
  return {
    id: 'SUB',
    organizationId: TEST_IDS.organizationId,
    name: 'SUB',
    parentId: 'SRC',
    path: '/SRC/SUB',
    depth: 1,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    isArchived: false,
    ...overrides,
  }
}

const NODES = [
  { id: 'SRC', parentId: null, name: 'SRC', path: '/SRC', depth: 0 },
  { id: 'DST', parentId: null, name: 'DST', path: '/DST', depth: 0 },
  { id: 'SUB', parentId: 'SRC', name: 'SUB', path: '/SRC/SUB', depth: 1 },
]

const fileEntry: MovePlanEntry = {
  id: 'file_1',
  type: 'file',
  fromFolderId: 'SRC',
  toFolderId: 'DST',
}

const folderEntry: MovePlanEntry = {
  id: 'SUB',
  type: 'folder',
  fromFolderId: 'SRC',
  toFolderId: 'DST',
}

describe('executeMoveEntry — files', () => {
  /**
   * `moveFolderFile` reads the file, then resolves a free path (the target
   * folder's path, then one collision probe), then updates.
   */
  function moveFileDb(extra: { rename?: boolean } = {}) {
    const select: unknown[][] = [
      [aFile()], // requireFolderFile
      [{ path: '/DST' }], // target folder path
      [], // path is free
    ]
    const update: unknown[][] = [[aFile({ folderId: 'DST', path: '/DST/a.txt' })]]
    if (extra.rename) {
      select.push([aFile({ folderId: 'DST', path: '/DST/a.txt' })], [{ path: '/DST' }], [])
      update.push([aFile({ folderId: 'DST', name: 'a (1).txt', path: '/DST/a (1).txt' })])
    }
    return makeDb({ select, update, tables: TABLES })
  }

  it('moves a file and opens no transaction of its own', async () => {
    const db = moveFileDb()

    const result = await executeMoveEntry(asTx(db), makeCtx({ db: db.db }), fileEntry, deps())

    expect(result._unsafeUnwrap()).toMatchObject({ id: 'file_1', type: 'file', parentId: 'DST' })
    expect(db.transactions).toBe(0)
    expect(db.updates).toHaveLength(1)
  })

  it('renames after the move, so the new path is derived in the TARGET folder', async () => {
    const db = moveFileDb({ rename: true })

    const result = await executeMoveEntry(
      asTx(db),
      makeCtx({ db: db.db }),
      { ...fileEntry, willRename: true, newName: 'a (1).txt' },
      deps()
    )

    expect(result._unsafeUnwrap()).toMatchObject({ name: 'a (1).txt', path: '/DST/a (1).txt' })
    expect(db.updates).toHaveLength(2)
    expect(db.updates[0]?.values).toMatchObject({ folderId: 'DST' })
    expect(db.updates[1]?.values).toMatchObject({ name: 'a (1).txt' })
  })

  it('writes null, not undefined, when moving a file to the library root', async () => {
    // The legacy `move` passed `target ?? undefined` into an updater that
    // skipped undefined fields, so a move to the root rewrote the path and left
    // `folderId` pointing at the old folder (PR 5c).
    const db = makeDb({
      select: [[aFile()], []],
      update: [[aFile({ folderId: null, path: '/a.txt' })]],
      tables: TABLES,
    })

    await executeMoveEntry(
      asTx(db),
      makeCtx({ db: db.db }),
      { ...fileEntry, toFolderId: null },
      deps()
    )

    expect(db.updates[0]?.values).toMatchObject({ folderId: null })
  })

  it('scopes the update to the caller organization', async () => {
    const db = moveFileDb()

    await executeMoveEntry(
      asTx(db),
      makeCtx({ db: db.db, organizationId: 'org_actor' }),
      fileEntry,
      deps()
    )

    const updateWhere = db.wheres.find((where) => where.table === 'FolderFile' && where.predicate)
    expect(JSON.stringify(db.wheres.map((w) => w.predicate))).toContain('org_actor')
    expect(updateWhere).toBeDefined()
  })

  it('surfaces a missing file as NotFoundError, not a generic 500', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await executeMoveEntry(asTx(db), makeCtx({ db: db.db }), fileEntry, deps())
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('executeMoveEntry — folders', () => {
  /**
   * `updateFolder` reads the folder, checks the name is free in the target,
   * loads the hierarchy, updates the row, then reshapes the subtree.
   */
  function moveFolderDb(rows: { subtreeFiles?: unknown[] } = {}) {
    return makeDb({
      select: [
        [aFolder()], // requireFolder
        [], // findFolderByNameAndParent: free
        NODES, // loadFolderNodes
        rows.subtreeFiles ?? [], // reshapeSubtree's file load
      ],
      update: [[aFolder({ parentId: 'DST', path: '/DST/SUB', depth: 1 })]],
      tables: TABLES,
    })
  }

  it('moves a folder in ONE update pass and opens no transaction', async () => {
    const db = moveFolderDb()

    const result = await executeMoveEntry(asTx(db), makeCtx({ db: db.db }), folderEntry, deps())

    expect(result._unsafeUnwrap()).toMatchObject({ id: 'SUB', type: 'folder', parentId: 'DST' })
    expect(db.transactions).toBe(0)
    expect(db.updates.filter((u) => u.table === 'Folder')).toHaveLength(1)
  })

  it('carries the new name into the SAME update as the new parent', async () => {
    // Two calls (`move` then `rename`) would have rewritten the whole subtree
    // twice. The plan already resolved the name, so one pass does both.
    const db = makeDb({
      select: [[aFolder()], [], NODES, []],
      update: [[aFolder({ parentId: 'DST', name: 'SUB (1)', path: '/DST/SUB (1)' })]],
      tables: TABLES,
    })

    await executeMoveEntry(
      asTx(db),
      makeCtx({ db: db.db }),
      { ...folderEntry, willRename: true, newName: 'SUB (1)' },
      deps()
    )

    expect(db.updates.filter((u) => u.table === 'Folder')).toHaveLength(1)
    expect(db.updates[0]?.values).toMatchObject({ parentId: 'DST', name: 'SUB (1)' })
  })

  it('stamps updatedAt from deps.now, never the wall clock', async () => {
    const db = moveFolderDb()
    await executeMoveEntry(asTx(db), makeCtx({ db: db.db }), folderEntry, deps())
    expect(db.updates[0]?.values).toMatchObject({ updatedAt: AT })
  })
})

describe('executeMoveEntry — refusals', () => {
  it('refuses an entry the plan already declined, rather than running it', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await executeMoveEntry(
      asTx(db),
      makeCtx({ db: db.db }),
      { ...fileEntry, reason: 'Would create circular reference' },
      deps()
    )

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.journal.ops('db')).toEqual([])
  })
})

describe('renameFilesystemItem', () => {
  it('renames a file through the folder-files write', async () => {
    const db = makeDb({
      select: [[aFile()], [{ path: '/SRC' }], []],
      update: [[aFile({ name: 'b.md', path: '/SRC/b.md', ext: 'md' })]],
      tables: TABLES,
    })

    const result = await renameFilesystemItem(
      asTx(db),
      makeCtx({ db: db.db }),
      'file_1',
      'file',
      'b.md',
      deps()
    )

    expect(result._unsafeUnwrap()).toMatchObject({ name: 'b.md', path: '/SRC/b.md', type: 'file' })
    expect(db.transactions).toBe(0)
  })

  it('renames a folder through the folders write, reshaping its subtree', async () => {
    const db = makeDb({
      select: [
        [aFolder()],
        [], // name free
        NODES,
        [], // subtree files
      ],
      update: [[aFolder({ name: 'RENAMED', path: '/SRC/RENAMED' })]],
      tables: TABLES,
    })

    const result = await renameFilesystemItem(
      asTx(db),
      makeCtx({ db: db.db }),
      'SUB',
      'folder',
      'RENAMED',
      deps()
    )

    expect(result._unsafeUnwrap()).toMatchObject({ name: 'RENAMED', type: 'folder' })
    expect(db.transactions).toBe(0)
  })

  it('rejects an empty file name with BadRequestError before writing', async () => {
    const db = makeDb({ tables: TABLES })
    const result = await renameFilesystemItem(
      asTx(db),
      makeCtx({ db: db.db }),
      'file_1',
      'file',
      '   ',
      deps()
    )
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.updates).toEqual([])
  })

  it('reports a missing folder as NotFoundError', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await renameFilesystemItem(
      asTx(db),
      makeCtx({ db: db.db }),
      'ghost',
      'folder',
      'x',
      deps()
    )
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})
