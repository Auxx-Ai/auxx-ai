// packages/lib/src/snippets/__tests__/snippet-folder-mutations.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { deleteSnippetFolderWithCascade, updateSnippetFolder } from '../snippet-folder-mutations'

/** Build a `db` stub whose `query.SnippetFolder.findFirst` returns queued values. */
function makeDb(opts: {
  folderFindFirst?: unknown[]
  updateCalls?: Array<Record<string, unknown>>
  deletedTables?: string[]
  txUpdateCalls?: Array<{ table: string; payload: Record<string, unknown> }>
}) {
  const folderQueue = [...(opts.folderFindFirst ?? [])]

  const tx = {
    query: {
      SnippetFolder: { findMany: vi.fn(async () => [{ id: 'sub1' }]) },
    },
    update: (table: { _: { name?: string } } | unknown) => ({
      set: (payload: Record<string, unknown>) => ({
        where: async () => {
          opts.txUpdateCalls?.push({ table: tableName(table), payload })
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        opts.deletedTables?.push(tableName(table))
      },
    }),
  }

  const db = {
    query: {
      SnippetFolder: {
        findFirst: vi.fn(async () => folderQueue.shift()),
      },
    },
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            opts.updateCalls?.push(payload)
            return [{ id: 'f1', ...payload }]
          },
        }),
      }),
    }),
    transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
  }

  return db as unknown as Database
}

function tableName(table: unknown): string {
  // Drizzle columns/tables are undefined under vitest; fall back to a marker.
  const sym = table as { [k: symbol]: unknown } | undefined
  return sym ? 'table' : 'unknown'
}

describe('updateSnippetFolder', () => {
  it('rejects a folder that is its own parent', async () => {
    const db = makeDb({ folderFindFirst: [{ id: 'f1', name: 'A', parentId: null }] })
    const result = await updateSnippetFolder(db, 'org1', 'f1', { parentId: 'f1' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.statusCode).toBe(400)
      expect(result.error.message).toBe('A folder cannot be its own parent')
    }
  })

  it('detects a circular reference while walking the parent chain', async () => {
    // f1 → reparent under f2; f2's parent is f1 → cycle.
    const db = makeDb({
      folderFindFirst: [
        { id: 'f1', name: 'A', parentId: null }, // existing folder lookup
        undefined, // duplicate-name check: none
        { parentId: 'f1' }, // walk: parent of f2 is f1 (already visited)
      ],
    })
    const result = await updateSnippetFolder(db, 'org1', 'f1', { parentId: 'f2' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toBe('Circular reference detected in folder hierarchy')
    }
  })

  it('updates a folder when the new parent chain is acyclic', async () => {
    const updateCalls: Array<Record<string, unknown>> = []
    const db = makeDb({
      folderFindFirst: [
        { id: 'f1', name: 'A', parentId: null }, // existing
        undefined, // duplicate-name check
        { parentId: null }, // walk: f2's parent is root → stop
      ],
      updateCalls,
    })
    const result = await updateSnippetFolder(db, 'org1', 'f1', { parentId: 'f2', name: 'B' })
    expect(result.isOk()).toBe(true)
    expect(updateCalls[0]).toMatchObject({ parentId: 'f2', name: 'B' })
  })
})

describe('deleteSnippetFolderWithCascade', () => {
  it('rejects moving snippets into the folder being deleted', async () => {
    const db = makeDb({ folderFindFirst: [{ id: 'f1', parentId: null }] })
    const result = await deleteSnippetFolderWithCascade(db, 'org1', 'f1', 'f1')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.message).toBe('Cannot move snippets to the folder being deleted')
    }
  })

  it('re-parents subfolders and detaches snippets when no target given', async () => {
    const txUpdateCalls: Array<{ table: string; payload: Record<string, unknown> }> = []
    const deletedTables: string[] = []
    const db = makeDb({
      folderFindFirst: [{ id: 'f1', parentId: 'parent1' }], // existing folder
      txUpdateCalls,
      deletedTables,
    })
    const result = await deleteSnippetFolderWithCascade(db, 'org1', 'f1', undefined)
    expect(result.isOk()).toBe(true)
    // Subfolders re-parented to the deleted folder's parent, snippets detached (null).
    expect(txUpdateCalls.map((c) => c.payload)).toEqual([
      { parentId: 'parent1' },
      { folderId: null },
    ])
    expect(deletedTables).toHaveLength(1)
  })

  it('moves snippets to the target folder when provided', async () => {
    const txUpdateCalls: Array<{ table: string; payload: Record<string, unknown> }> = []
    const db = makeDb({
      folderFindFirst: [
        { id: 'f1', parentId: null }, // existing folder
        { id: 'target1', parentId: null }, // target folder exists
      ],
      txUpdateCalls,
      deletedTables: [],
    })
    const result = await deleteSnippetFolderWithCascade(db, 'org1', 'f1', 'target1')
    expect(result.isOk()).toBe(true)
    expect(txUpdateCalls.some((c) => c.payload.folderId === 'target1')).toBe(true)
  })

  it('returns NotFound when the folder does not exist', async () => {
    const db = makeDb({ folderFindFirst: [undefined] })
    const result = await deleteSnippetFolderWithCascade(db, 'org1', 'missing', undefined)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.statusCode).toBe(404)
  })
})
