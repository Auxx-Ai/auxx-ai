// packages/lib/src/files/folders/__tests__/folder-queries.test.ts

/**
 * `folders/folder-queries.ts` — the read half of what `FolderService` was.
 *
 * **`vi.mock` is called zero times in this file**: `ctx.db` is a parameter, so
 * there is nothing left to intercept at module scope.
 *
 * Three properties matter beyond "it returns rows":
 *
 * 1. **Organization scope is in every statement.** The db stub does not
 *    interpret SQL, but it stores the predicate the code built and the bound
 *    values survive `JSON.stringify`, which is enough to prove the filter is
 *    present. It is *not* enough to prove which column each condition names —
 *    this package's `@auxx/database` mock hands out `{}` for every table — and
 *    that distinction belongs to the integration lane.
 * 2. **Statement counts.** `getFolderTree` and `getFolderCounts` exist to
 *    replace loops that issued a query per folder, so the count is asserted off
 *    the journal rather than inferred from the return value.
 * 3. **Subtree membership comes from `folderId`, not from a path prefix.** That
 *    is the delete-cascade fix; here it shows up as the ids the aggregate query
 *    was handed.
 */

import { schema } from '@auxx/database'
import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../../../errors'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  getFolder,
  getFolderAncestors,
  getFolderCounts,
  getFolderDescendants,
  getFolderTree,
  getFolderUsage,
  getFolderWithRelations,
  getSubfolders,
  isFolderNameAvailable,
  listFolders,
  loadFileAggregates,
  searchFolders,
} from '../folder-queries'

const TABLES = {
  Folder: schema.Folder,
  FolderFile: schema.FolderFile,
  User: schema.User,
}

const AT = new Date('2026-01-01T00:00:00.000Z')

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

/** The node projection `loadFolderNodes` selects, as the stub must hand it back. */
function aNode(id: string, parentId: string | null, name = id) {
  return { id, parentId, name, path: `/${name}`, depth: 0 }
}

/** The `where` predicate handed to the n-th builder chain, stringified. */
function whereOf(db: ReturnType<typeof makeDb>, index: number): string {
  return JSON.stringify(db.wheres[index]?.predicate)
}

describe('getFolder', () => {
  it('returns the row and scopes the read to the caller organization', async () => {
    const db = makeDb({ select: [[aFolder()]], tables: TABLES })

    const result = await getFolder(makeCtx({ db: db.db, organizationId: 'org_other' }), 'fld_1')

    expect(result._unsafeUnwrap()).toEqual(aFolder())
    expect(whereOf(db, 0)).toContain('org_other')
    expect(whereOf(db, 0)).toContain('fld_1')
  })

  it('returns ok(null) rather than an error when nothing matches', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await getFolder(makeCtx({ db: db.db }), 'fld_missing')
    expect(result._unsafeUnwrap()).toBeNull()
  })
})

describe('getFolderWithRelations', () => {
  it('short-circuits without loading relations when the folder is invisible', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await getFolderWithRelations(makeCtx({ db: db.db }), 'fld_missing')

    expect(result._unsafeUnwrap()).toBeNull()
    expect(db.journal.ops('db')).toEqual(['select'])
  })

  it('assembles parent, children, files and creator', async () => {
    const folder = aFolder({ id: 'fld_2', parentId: 'fld_1', path: '/Docs/Invoices' })
    const db = makeDb({
      select: [
        [folder],
        [aFolder()],
        [aFolder({ id: 'fld_3', parentId: 'fld_2' })],
        [aFile()],
        [{ id: TEST_IDS.userId, name: 'Test User', email: 'test@example.com' }],
      ],
      tables: TABLES,
    })

    const detail = (await getFolderWithRelations(makeCtx({ db: db.db }), 'fld_2'))._unsafeUnwrap()

    expect(detail?.id).toBe('fld_2')
    expect(detail?.parent?.id).toBe('fld_1')
    expect(detail?.children.map((c) => c.id)).toEqual(['fld_3'])
    expect(detail?.files.map((f) => f.id)).toEqual(['file_1'])
    expect(detail?.createdBy?.email).toBe('test@example.com')
  })

  it('scopes the children and files reads to the organization too', async () => {
    const db = makeDb({
      select: [[aFolder()], [], [], []],
      tables: TABLES,
    })

    await getFolderWithRelations(makeCtx({ db: db.db, organizationId: 'org_x' }), 'fld_1')

    // 0 = the folder, 1 = children, 2 = files. No parent read: `parentId` is null.
    for (const index of [0, 1, 2]) {
      expect(whereOf(db, index)).toContain('org_x')
    }
  })
})

describe('listFolders', () => {
  it('reports the page and whether more rows follow', async () => {
    const db = makeDb({
      select: [[aFolder(), aFolder({ id: 'fld_2' })], [{ value: 5 }]],
      tables: TABLES,
    })

    const page = (await listFolders(makeCtx({ db: db.db }), { limit: 2 }))._unsafeUnwrap()

    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(5)
    expect(page.hasMore).toBe(true)
  })

  it('has no more rows when the page reaches the total', async () => {
    const db = makeDb({ select: [[aFolder()], [{ value: 1 }]], tables: TABLES })
    const page = (await listFolders(makeCtx({ db: db.db }), {}))._unsafeUnwrap()
    expect(page.hasMore).toBe(false)
  })

  it('applies a null parent filter as IS NULL rather than dropping it', async () => {
    const db = makeDb({ select: [[], [{ value: 0 }]], tables: TABLES })
    await listFolders(makeCtx({ db: db.db }), { parentId: null })
    expect(whereOf(db, 0)).toContain('is null')
  })
})

describe('getFolderTree', () => {
  it('is two statements regardless of how many folders there are', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => aNode(`n${i}`, i === 0 ? null : `n${i - 1}`))
    const db = makeDb({ select: [nodes, []], tables: TABLES })

    await getFolderTree(makeCtx({ db: db.db }))

    expect(db.journal.ops('db')).toEqual(['select', 'select'])
  })

  it('folds real file counts into the nodes — the legacy always reported zero', async () => {
    const db = makeDb({
      select: [
        [aNode('root', null), aNode('child', 'root')],
        [{ folderId: 'root', fileCount: 2, totalSize: '4096' }],
      ],
      tables: TABLES,
    })

    const tree = (await getFolderTree(makeCtx({ db: db.db })))._unsafeUnwrap()

    expect(tree[0]).toMatchObject({ id: 'root', fileCount: 2, totalSize: 4096 })
    expect(tree[0]?.children[0]).toMatchObject({ id: 'child', fileCount: 0, totalSize: 0 })
  })
})

describe('getSubfolders', () => {
  it('asks for IS NULL at the root and for the id otherwise', async () => {
    const rootDb = makeDb({ select: [[]], tables: TABLES })
    await getSubfolders(makeCtx({ db: rootDb.db }), null)
    expect(whereOf(rootDb, 0)).toContain('is null')

    const childDb = makeDb({ select: [[]], tables: TABLES })
    await getSubfolders(makeCtx({ db: childDb.db }), 'fld_1')
    expect(whereOf(childDb, 0)).toContain('fld_1')
  })
})

describe('getFolderAncestors', () => {
  it('returns the chain root-first', async () => {
    const db = makeDb({
      select: [
        [aNode('a', null), aNode('b', 'a'), aNode('c', 'b')],
        [aFolder({ id: 'b', parentId: 'a' }), aFolder({ id: 'a' })],
      ],
      tables: TABLES,
    })

    const ancestors = (await getFolderAncestors(makeCtx({ db: db.db }), 'c'))._unsafeUnwrap()

    expect(ancestors.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('fails with NotFoundError instead of returning [] for a folder outside the org', async () => {
    const db = makeDb({ select: [[aNode('a', null)]], tables: TABLES })
    const result = await getFolderAncestors(makeCtx({ db: db.db }), 'fld_other')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })

  it('does not query for rows when the folder is a root', async () => {
    const db = makeDb({ select: [[aNode('a', null)]], tables: TABLES })
    const ancestors = (await getFolderAncestors(makeCtx({ db: db.db }), 'a'))._unsafeUnwrap()
    expect(ancestors).toEqual([])
    expect(db.journal.ops('db')).toEqual(['select'])
  })
})

describe('getFolderDescendants', () => {
  it('returns the subtree breadth-first', async () => {
    const db = makeDb({
      select: [
        [aNode('a', null), aNode('b', 'a'), aNode('c', 'a'), aNode('d', 'b')],
        [aFolder({ id: 'd' }), aFolder({ id: 'c' }), aFolder({ id: 'b' })],
      ],
      tables: TABLES,
    })

    const descendants = (await getFolderDescendants(makeCtx({ db: db.db }), 'a'))._unsafeUnwrap()

    expect(descendants.map((f) => f.id)).toEqual(['b', 'c', 'd'])
  })

  it('fails with NotFoundError for a folder outside the org', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await getFolderDescendants(makeCtx({ db: db.db }), 'fld_1')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('getFolderCounts', () => {
  it('selects files by folderId over the whole subtree, never by path prefix', async () => {
    const db = makeDb({
      select: [
        [aNode('doc', null, 'Doc'), aNode('sub', 'doc'), aNode('other', null, 'Documents')],
        [
          { folderId: 'doc', fileCount: 1, totalSize: '10' },
          { folderId: 'sub', fileCount: 2, totalSize: '20' },
        ],
      ],
      tables: TABLES,
    })

    const counts = (await getFolderCounts(makeCtx({ db: db.db }), 'doc'))._unsafeUnwrap()

    expect(counts).toEqual({
      totalSize: 30,
      deepFileCount: 3,
      directFileCount: 1,
      subfolderCount: 1,
    })

    // The aggregate names the subtree ids and nothing else — in particular not
    // the sibling folder whose name starts with the same characters.
    const aggregateWhere = whereOf(db, 1)
    expect(aggregateWhere).toContain('doc')
    expect(aggregateWhere).toContain('sub')
    expect(aggregateWhere).not.toContain('other')
    expect(aggregateWhere).not.toContain('/Doc%')
  })

  it('is two statements, where the legacy was eight', async () => {
    const db = makeDb({ select: [[aNode('doc', null)], []], tables: TABLES })
    await getFolderCounts(makeCtx({ db: db.db }), 'doc')
    expect(db.journal.ops('db')).toEqual(['select', 'select'])
  })

  it('fails with NotFoundError for a folder outside the org', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })
    const result = await getFolderCounts(makeCtx({ db: db.db }), 'doc')
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('getFolderUsage', () => {
  it('credits activity deep in the subtree to the direct child it sits under', async () => {
    const db = makeDb({
      select: [
        [aNode('root', null), aNode('branch', 'root'), aNode('leaf', 'branch')],
        [{ folderId: 'leaf', fileCount: 1, totalSize: '5' }],
        [{ updatedAt: AT }],
        [{ folderId: 'leaf', lastActivity: AT }],
      ],
      tables: TABLES,
    })

    const usage = (await getFolderUsage(makeCtx({ db: db.db }), 'root'))._unsafeUnwrap()

    expect(usage).toEqual({
      fileCount: 1,
      totalSize: 5,
      lastActivity: AT,
      mostActiveSubfolder: { id: 'branch', name: 'branch' },
    })
  })

  it('reports no active subfolder when the only activity is in the folder itself', async () => {
    const db = makeDb({
      select: [
        [aNode('root', null)],
        [{ folderId: 'root', fileCount: 1, totalSize: '5' }],
        [{ updatedAt: AT }],
        [{ folderId: 'root', lastActivity: AT }],
      ],
      tables: TABLES,
    })

    const usage = (await getFolderUsage(makeCtx({ db: db.db }), 'root'))._unsafeUnwrap()
    expect(usage.mostActiveSubfolder).toBeNull()
  })
})

describe('isFolderNameAvailable', () => {
  it('rejects an illegal name without touching the database', async () => {
    const db = makeDb({ tables: TABLES })
    const result = await isFolderNameAvailable(makeCtx({ db: db.db }), 'a/b', null)
    expect(result._unsafeUnwrap()).toBe(false)
    expect(db.journal.ops('db')).toEqual([])
  })

  it('lets a folder keep its own name', async () => {
    const db = makeDb({ select: [[aFolder({ id: 'fld_1' })]], tables: TABLES })
    const result = await isFolderNameAvailable(makeCtx({ db: db.db }), 'Docs', null, 'fld_1')
    expect(result._unsafeUnwrap()).toBe(true)
  })

  it('reports a name taken by a different folder', async () => {
    const db = makeDb({ select: [[aFolder({ id: 'fld_9' })]], tables: TABLES })
    const result = await isFolderNameAvailable(makeCtx({ db: db.db }), 'Docs', null, 'fld_1')
    expect(result._unsafeUnwrap()).toBe(false)
  })
})

describe('searchFolders', () => {
  it('ranks an exact name match above a path match', async () => {
    const db = makeDb({
      select: [
        [
          aFolder({ id: 'path-hit', name: 'Other', path: '/Docs/Other' }),
          aFolder({ id: 'exact', name: 'Docs', path: '/Docs' }),
        ],
      ],
      tables: TABLES,
    })

    const hits = (await searchFolders(makeCtx({ db: db.db }), 'Docs'))._unsafeUnwrap()

    expect(hits.map((h) => h.folder.id)).toEqual(['exact', 'path-hit'])
    expect(hits[0]?.relevance).toBe(13)
    expect(hits[0]?.matchedFields).toEqual(['name', 'path'])
    expect(hits[1]?.relevance).toBe(3)
  })

  it('never scores a hit below 1', async () => {
    const db = makeDb({
      select: [[aFolder({ name: 'Nope', path: '/Nope' })]],
      tables: TABLES,
    })
    const hits = (await searchFolders(makeCtx({ db: db.db }), 'Docs'))._unsafeUnwrap()
    expect(hits[0]?.relevance).toBe(1)
    expect(hits[0]?.snippet).toBe('Nope')
  })
})

describe('loadFileAggregates', () => {
  it('does not query at all for an empty id list', async () => {
    const db = makeDb({ tables: TABLES })
    expect(await loadFileAggregates(makeCtx({ db: db.db }), [])).toEqual(new Map())
    expect(db.journal.ops('db')).toEqual([])
  })

  it('drops rows with a null folderId, which belong to no folder total', async () => {
    const db = makeDb({
      select: [
        [
          { folderId: null, fileCount: 9, totalSize: '900' },
          { folderId: 'fld_1', fileCount: 1, totalSize: '10' },
        ],
      ],
      tables: TABLES,
    })

    const aggregates = await loadFileAggregates(makeCtx({ db: db.db }))

    expect([...aggregates.keys()]).toEqual(['fld_1'])
  })
})
