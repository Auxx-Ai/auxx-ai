// packages/lib/src/files/filesystem/__tests__/filesystem-queries.test.ts

/**
 * `filesystem/filesystem-queries.ts` — the two reads.
 *
 * **`vi.mock` is called zero times in this file**: `ctx.db` is a parameter.
 *
 * Statement *counts* are most of what is asserted here, because the count is the
 * defect. `getCompleteFileSystem` used to issue `3 + 2N` statements for `N`
 * folders (`9 + 2N` with `lastSync`), and `planMoveItems`'s predecessor issued
 * one query per collision check, one per rename candidate and one per ancestor
 * level. Both are now a fixed handful, so the journal is the assertion.
 *
 * The other property is organization scope. The stub stores the predicate the
 * code built and the bound values survive `JSON.stringify`, which proves the
 * organization id is in every statement — it cannot prove *which column* each
 * condition names, because this package's `@auxx/database` mock hands out `{}`
 * for every table (`09-testing-strategy.md` §9.3).
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../../../errors'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import { getCompleteFileSystem, planMoveItems } from '../filesystem-queries'
import { encodeFileCursor } from '../items'

const TABLES = { Folder: schema.Folder, FolderFile: schema.FolderFile }
const AT = new Date('2026-01-01T00:00:00.000Z')
const ORG = TEST_IDS.organizationId

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file_1',
    name: 'a.txt',
    size: 10,
    mimeType: 'text/plain',
    ext: 'txt',
    createdAt: AT,
    updatedAt: AT,
    path: '/Docs/a.txt',
    folderId: 'fld_1',
    isArchived: false,
    organizationId: ORG,
    createdById: null,
    currentVersionId: null,
    deletedAt: null,
    folderName: 'Docs',
    folderPath: '/Docs',
    ...overrides,
  }
}

function folderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fld_1',
    name: 'Docs',
    parentId: null,
    path: '/Docs',
    depth: 0,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    isArchived: false,
    organizationId: ORG,
    createdById: null,
    ...overrides,
  }
}

/** Every `where` predicate the stub recorded, stringified and concatenated. */
function allWheres(db: ReturnType<typeof makeDb>): string {
  return JSON.stringify(db.wheres.map((w) => w.predicate))
}

/**
 * How many `=` comparisons a serialised predicate contains.
 *
 * The stub cannot tell which column a condition names (§9.3), and the bound
 * values are not searchable by value — `shouldInlineParams: false` appears on
 * every node, so looking for the literal `false` matches everything. Counting
 * operators is what is left, and it is enough to tell "organization only" from
 * "organization plus one more equality".
 */
function equalityCount(predicate: unknown): number {
  return JSON.stringify(predicate).split('" = "').length - 1
}

/**
 * The four `select` queues `getCompleteFileSystem` drains, in call order:
 * the file page, the folders, the file aggregates, the total.
 */
function fileSystemDb(options: {
  files?: unknown[]
  folders?: unknown[]
  aggregates?: unknown[]
  total?: number
}) {
  return makeDb({
    select: [
      options.files ?? [],
      options.folders ?? [],
      options.aggregates ?? [],
      [{ total: options.total ?? 0 }],
    ],
    tables: TABLES,
  })
}

describe('getCompleteFileSystem', () => {
  it('issues exactly four statements — not 3 + 2N', async () => {
    // Three folders would have cost 9 statements before; the per-folder file
    // count and subfolder count are a GROUP BY and an in-memory walk now.
    const db = fileSystemDb({
      files: [fileRow()],
      folders: [folderRow(), folderRow({ id: 'fld_2' }), folderRow({ id: 'fld_3' })],
      aggregates: [{ folderId: 'fld_1', fileCount: 4, totalSize: 40 }],
      total: 1,
    })

    const result = await getCompleteFileSystem(makeCtx({ db: db.db }))

    expect(result.isOk()).toBe(true)
    expect(db.journal.ops('db')).toEqual(['select', 'select', 'select', 'select'])
  })

  it('never opens a transaction — it is a read', async () => {
    const db = fileSystemDb({})
    await getCompleteFileSystem(makeCtx({ db: db.db }))
    expect(db.transactions).toBe(0)
  })

  it('names the caller organization in every statement', async () => {
    const db = fileSystemDb({ files: [fileRow()], folders: [folderRow()] })

    await getCompleteFileSystem(makeCtx({ db: db.db, organizationId: 'org_actor' }))

    // Four statements, four predicates, all carrying the actor's organization.
    expect(db.wheres).toHaveLength(4)
    for (const where of db.wheres) {
      expect(JSON.stringify(where.predicate)).toContain('org_actor')
    }
  })

  it('folds the aggregate file count and an in-memory subfolder count into each folder', async () => {
    const db = fileSystemDb({
      folders: [folderRow({ id: 'root' }), folderRow({ id: 'child', parentId: 'root' })],
      aggregates: [{ folderId: 'root', fileCount: 2, totalSize: 20 }],
    })

    const result = await getCompleteFileSystem(makeCtx({ db: db.db }))
    const items = result._unsafeUnwrap().items

    expect(items.find((item) => item.id === 'root')).toMatchObject({
      fileCount: 2,
      subfolderCount: 1,
    })
    // A folder absent from the aggregate map reads as zero, never undefined —
    // the legacy `buildTree` read a Prisma `_count` field and reported 0 for
    // every folder, always.
    expect(items.find((item) => item.id === 'child')).toMatchObject({
      fileCount: 0,
      subfolderCount: 0,
    })
  })

  it('returns files and folders in one array, files first, with the folder total', async () => {
    const db = fileSystemDb({
      files: [fileRow({ id: 'f1' })],
      folders: [folderRow({ id: 'fld_1' }), folderRow({ id: 'fld_2' })],
      total: 1,
    })

    const page = (await getCompleteFileSystem(makeCtx({ db: db.db })))._unsafeUnwrap()

    expect(page.items.map((item) => [item.id, item.type])).toEqual([
      ['f1', 'file'],
      ['fld_1', 'folder'],
      ['fld_2', 'folder'],
    ])
    // Folders are never paginated, so the total is the length, not a COUNT.
    expect(page.totalFolders).toBe(2)
    expect(page.totalFiles).toBe(1)
  })

  it('trims the probe row and mints a cursor from the last kept file', async () => {
    const db = fileSystemDb({
      files: [fileRow({ id: 'f1' }), fileRow({ id: 'f2' }), fileRow({ id: 'f3' })],
      total: 3,
    })

    const result = await getCompleteFileSystem(makeCtx({ db: db.db }), { filesLimit: 2 })
    const page = result._unsafeUnwrap()

    expect(page.filesHasNextPage).toBe(true)
    expect(page.items.filter((item) => item.type === 'file').map((item) => item.id)).toEqual([
      'f1',
      'f2',
    ])
    expect(page.filesNextCursor).toBe(
      encodeFileCursor({ path: '/Docs/a.txt', name: 'a.txt', id: 'f2' })
    )
  })

  it('reports no next page and a null cursor on a short page', async () => {
    const db = fileSystemDb({ files: [fileRow()], total: 1 })
    const page = (
      await getCompleteFileSystem(makeCtx({ db: db.db }), { filesLimit: 50 })
    )._unsafeUnwrap()

    expect(page.filesHasNextPage).toBe(false)
    expect(page.filesNextCursor).toBeNull()
  })

  it('adds the keyset comparison to the page statement when a cursor is supplied', async () => {
    const db = fileSystemDb({})
    const cursor = encodeFileCursor({ path: '/Docs/a.txt', name: 'a.txt', id: 'f2' })

    await getCompleteFileSystem(makeCtx({ db: db.db }), { filesCursor: cursor })

    const pagePredicate = JSON.stringify(db.wheres[0]?.predicate)
    expect(pagePredicate).toContain('/Docs/a.txt')
    expect(pagePredicate).toContain('f2')
  })

  it('ignores a corrupt cursor rather than failing the page', async () => {
    const db = fileSystemDb({})
    const result = await getCompleteFileSystem(makeCtx({ db: db.db }), {
      filesCursor: 'not-a-cursor',
    })
    expect(result.isOk()).toBe(true)
  })

  it('applies the extension filter to BOTH the page and the total', async () => {
    // The legacy built the total's predicate in `buildFileWhereClause`, which
    // carried a comment promising to apply `fileTypes` and never did — so
    // `totalFiles` reported the unfiltered count under any type filter.
    const db = fileSystemDb({})

    await getCompleteFileSystem(makeCtx({ db: db.db }), { fileTypes: ['.PDF', 'png'] })

    const page = JSON.stringify(db.wheres[0]?.predicate)
    const total = JSON.stringify(db.wheres[3]?.predicate)
    for (const predicate of [page, total]) {
      expect(predicate).toContain('pdf')
      expect(predicate).toContain('png')
    }
  })

  it('filters archived files out by default and keeps them when asked', async () => {
    // Counting equality comparisons rather than looking for the literal
    // `false`: a serialised Drizzle predicate carries `shouldInlineParams:
    // false` on every node, so the value itself is not searchable.
    const withDefault = fileSystemDb({})
    await getCompleteFileSystem(makeCtx({ db: withDefault.db }))
    expect(equalityCount(withDefault.wheres[0]?.predicate)).toBe(2) // organization + isArchived

    const archived = fileSystemDb({})
    await getCompleteFileSystem(makeCtx({ db: archived.db }), { includeArchived: true })
    expect(equalityCount(archived.wheres[0]?.predicate)).toBe(1) // organization only
  })

  it('keeps archived FOLDERS hidden even when includeArchived is set', async () => {
    // Legacy parity, stated rather than assumed: the option has never had a
    // caller that sets it, so widening it here would be an unforced change.
    const db = fileSystemDb({})
    await getCompleteFileSystem(makeCtx({ db: db.db }), { includeArchived: true })
    expect(equalityCount(db.wheres[1]?.predicate)).toBe(2) // organization + isArchived
  })
})

describe('planMoveItems', () => {
  it('issues three statements for a mixed selection', async () => {
    const db = makeDb({
      select: [
        [{ id: 'SRC', parentId: null, name: 'SRC', path: '/SRC', depth: 0 }],
        [{ id: 'f1', name: 'a.txt', folderId: 'SRC' }],
        [],
      ],
      tables: TABLES,
    })

    const result = await planMoveItems(makeCtx({ db: db.db }), {
      items: [{ id: 'f1', type: 'file' }],
      targetFolderId: null,
    })

    expect(result.isOk()).toBe(true)
    expect(db.journal.ops('db')).toEqual(['select', 'select', 'select'])
  })

  it('skips the file lookup entirely for a folder-only selection', async () => {
    const db = makeDb({
      select: [
        [
          { id: 'SRC', parentId: null, name: 'SRC', path: '/SRC', depth: 0 },
          { id: 'DST', parentId: null, name: 'DST', path: '/DST', depth: 0 },
        ],
        [],
      ],
      tables: TABLES,
    })

    await planMoveItems(makeCtx({ db: db.db }), {
      items: [{ id: 'SRC', type: 'folder' }],
      targetFolderId: 'DST',
    })

    expect(db.journal.ops('db')).toEqual(['select', 'select'])
  })

  it('writes nothing', async () => {
    const db = makeDb({ select: [[], [], []], tables: TABLES })
    await planMoveItems(makeCtx({ db: db.db }), {
      items: [{ id: 'f1', type: 'file' }],
      targetFolderId: null,
    })
    expect(db.updates).toEqual([])
    expect(db.inserts).toEqual([])
    expect(db.transactions).toBe(0)
  })

  it('404s a target folder that is not in this organization', async () => {
    // The folder graph is loaded organization-scoped, so absence from it IS the
    // check. The legacy spent a separate query and threw a bare `Error`, which
    // `fileRouter` flattened into a 400.
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await planMoveItems(makeCtx({ db: db.db }), {
      items: [{ id: 'f1', type: 'file' }],
      targetFolderId: 'someone_elses_folder',
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('scopes every statement to the caller organization', async () => {
    const db = makeDb({
      select: [[{ id: 'DST', parentId: null, name: 'DST', path: '/DST', depth: 0 }], [], []],
      tables: TABLES,
    })

    await planMoveItems(makeCtx({ db: db.db, organizationId: 'org_actor' }), {
      items: [{ id: 'f1', type: 'file' }],
      targetFolderId: 'DST',
    })

    expect(allWheres(db)).toContain('org_actor')
    expect(db.wheres).toHaveLength(3)
    for (const where of db.wheres) {
      expect(JSON.stringify(where.predicate)).toContain('org_actor')
    }
  })

  it('reads the target folder’s names once, not once per item', async () => {
    const db = makeDb({
      select: [
        [{ id: 'DST', parentId: null, name: 'DST', path: '/DST', depth: 0 }],
        [
          { id: 'f1', name: 'a.txt', folderId: null },
          { id: 'f2', name: 'a.txt', folderId: null },
          { id: 'f3', name: 'a.txt', folderId: null },
        ],
        [{ name: 'a.txt' }],
      ],
      tables: TABLES,
    })

    const plan = (
      await planMoveItems(makeCtx({ db: db.db }), {
        items: [
          { id: 'f1', type: 'file' },
          { id: 'f2', type: 'file' },
          { id: 'f3', type: 'file' },
        ],
        targetFolderId: 'DST',
      })
    )._unsafeUnwrap()

    expect(db.journal.ops('db')).toHaveLength(3)
    expect(plan.map((entry) => entry.newName)).toEqual(['a (1).txt', 'a (2).txt', 'a (3).txt'])
  })
})
