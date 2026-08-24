// packages/lib/src/files/folders/__tests__/maintenance.test.ts

/**
 * `folders/maintenance.ts` — the repair sweeps.
 *
 * These have no production caller yet (see the module header for why they were
 * kept anyway), so the tests are what says they work. The property under test is
 * the one the pure core bought: **a sweep writes only the rows that are actually
 * wrong**, from one read rather than two queries per folder.
 *
 * `vi.mock` is called zero times.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { makeClock, makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import { cleanupEmptyFolders, fixFolderDepths, rebuildFolderPaths } from '../maintenance'

const TABLES = { Folder: schema.Folder, FolderFile: schema.FolderFile }
const AT = new Date('2026-01-01T00:00:00.000Z')
const clock = () => ({ now: makeClock(AT.toISOString()).now })

function aNode(id: string, parentId: string | null, name: string, path: string, depth: number) {
  return { id, parentId, name, path, depth }
}

describe('rebuildFolderPaths', () => {
  it('writes nothing when every path and depth already agrees with the edges', async () => {
    const db = makeDb({
      select: [
        [aNode('a', null, 'Docs', '/Docs', 0), aNode('b', 'a', 'Invoices', '/Docs/Invoices', 1)],
      ],
      tables: TABLES,
    })

    const report = (await rebuildFolderPaths(makeCtx({ db: db.db }), clock()))._unsafeUnwrap()

    expect(report).toEqual({ scanned: 2, repaired: 0 })
    expect(db.updates).toEqual([])
  })

  it('repairs only the drifted rows, from a single read', async () => {
    const db = makeDb({
      select: [
        [
          aNode('a', null, 'Docs', '/Docs', 0),
          aNode('b', 'a', 'Invoices', '/Stale/Invoices', 1),
          aNode('c', 'b', '2026', '/Docs/Invoices/2026', 9),
        ],
      ],
      tables: TABLES,
    })

    const report = (await rebuildFolderPaths(makeCtx({ db: db.db }), clock()))._unsafeUnwrap()

    expect(report).toEqual({ scanned: 3, repaired: 2 })
    expect(db.journal.ops('db')).toEqual(['select', 'update', 'update'])
    expect(db.updates[0]?.values).toEqual({
      path: '/Docs/Invoices',
      depth: 1,
      updatedAt: AT,
    })
    expect(db.updates[1]?.values).toEqual({
      path: '/Docs/Invoices/2026',
      depth: 2,
      updatedAt: AT,
    })
  })

  it('scopes every repair write to the organization', async () => {
    const db = makeDb({
      select: [[aNode('a', null, 'Docs', '/Stale', 0)]],
      tables: TABLES,
    })

    await rebuildFolderPaths(makeCtx({ db: db.db, organizationId: 'org_actor' }), clock())

    for (const where of db.wheres) {
      expect(JSON.stringify(where.predicate)).toContain('org_actor')
    }
  })

  it('re-roots a folder whose parent has gone', async () => {
    const db = makeDb({
      select: [[aNode('orphan', 'deleted', 'Orphan', '/Gone/Orphan', 3)]],
      tables: TABLES,
    })

    await rebuildFolderPaths(makeCtx({ db: db.db }), clock())

    expect(db.updates[0]?.values).toMatchObject({ path: '/Orphan', depth: 0 })
  })
})

describe('fixFolderDepths', () => {
  it('touches depth alone, never path', async () => {
    const db = makeDb({
      select: [[aNode('a', null, 'Docs', '/Docs', 0), aNode('b', 'a', 'Invoices', '/Anything', 7)]],
      tables: TABLES,
    })

    const report = (await fixFolderDepths(makeCtx({ db: db.db }), clock()))._unsafeUnwrap()

    expect(report).toEqual({ scanned: 2, repaired: 1 })
    expect(db.updates[0]?.values).toEqual({ depth: 1, updatedAt: AT })
    expect(db.updates[0]?.values).not.toHaveProperty('path')
  })

  it('ignores a drifted path when the depth is right', async () => {
    const db = makeDb({
      select: [[aNode('a', null, 'Docs', '/Stale', 0)]],
      tables: TABLES,
    })

    const report = (await fixFolderDepths(makeCtx({ db: db.db }), clock()))._unsafeUnwrap()

    expect(report.repaired).toBe(0)
    expect(db.updates).toEqual([])
  })
})

describe('cleanupEmptyFolders', () => {
  it('does not issue an UPDATE when nothing is empty', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const report = (await cleanupEmptyFolders(makeCtx({ db: db.db }), clock()))._unsafeUnwrap()

    expect(report).toEqual({ scanned: 0, repaired: 0 })
    expect(db.journal.ops('db')).toEqual(['select'])
  })

  it('soft-deletes the empty set in one statement, org-scoped', async () => {
    const db = makeDb({
      select: [[{ id: 'e1' }, { id: 'e2' }]],
      tables: TABLES,
    })

    const report = (
      await cleanupEmptyFolders(
        makeCtx({ db: db.db, organizationId: TEST_IDS.organizationId }),
        clock()
      )
    )._unsafeUnwrap()

    expect(report).toEqual({ scanned: 2, repaired: 2 })
    expect(db.journal.ops('db')).toEqual(['select', 'update'])
    expect(db.updates[0]?.values).toEqual({ deletedAt: AT, updatedAt: AT })
    const where = JSON.stringify(db.wheres.at(-1)?.predicate)
    expect(where).toContain(TEST_IDS.organizationId)
    expect(where).toContain('e1')
    expect(where).toContain('e2')
  })
})
