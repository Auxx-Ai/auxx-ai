// packages/lib/src/files/filesystem/__tests__/items.test.ts

/**
 * `filesystem/items.ts` — the pure shaping half of the filesystem read.
 *
 * **No doubles of any kind**, not even the `files/` db stub: everything here
 * takes data and returns data (`plans/attachments/09-testing-strategy.md` §9.2
 * shape 1). That is the whole point — three of `FilesystemService`'s four
 * mappers were wrong precisely because reaching them meant standing up a
 * database.
 *
 * The breadcrumb cases are the ones that matter. The legacy folder walk looped
 * on `currentFolder?.parent`, a field its own `SELECT` never projected, so it
 * never executed and every trail was `[Files, itself]`; the legacy file walk
 * split the path string and emitted the literal id `'folder-lookup-needed'`.
 */

import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import type { FolderNode } from '../../folders/tree'
import { indexById } from '../../folders/tree'
import type { FilesystemFileRow, FilesystemFolderRow } from '../items'
import {
  buildBreadcrumbs,
  decodeFileCursor,
  encodeFileCursor,
  fileItemFromFile,
  fileItemFromFolder,
  fileItemFromFolderRow,
  fileItemFromRow,
} from '../items'

const AT = new Date('2026-01-01T00:00:00.000Z')
const ORG = 'org_1'

function node(id: string, parentId: string | null, name = id, path = `/${name}`): FolderNode {
  return { id, parentId, name, path, depth: 0 }
}

/** `/a` -> `/a/b` -> `/a/b/c`, the shape every breadcrumb assertion walks. */
const CHAIN: FolderNode[] = [
  node('a', null, 'a', '/a'),
  node('b', 'a', 'b', '/a/b'),
  node('c', 'b', 'c', '/a/b/c'),
]

function fileRow(overrides: Partial<FilesystemFileRow> = {}): FilesystemFileRow {
  return {
    id: 'file_1',
    name: 'report.pdf',
    size: 2048,
    mimeType: 'application/pdf',
    ext: 'pdf',
    createdAt: AT,
    updatedAt: AT,
    path: '/a/b/report.pdf',
    folderId: 'b',
    isArchived: false,
    organizationId: ORG,
    createdById: 'usr_1',
    currentVersionId: 'ver_1',
    deletedAt: null,
    folderName: 'b',
    folderPath: '/a/b',
    ...overrides,
  }
}

function folderRow(overrides: Partial<FilesystemFolderRow> = {}): FilesystemFolderRow {
  return {
    id: 'c',
    parentId: 'b',
    name: 'c',
    path: '/a/b/c',
    depth: 2,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    isArchived: false,
    organizationId: ORG,
    createdById: 'usr_1',
    ...overrides,
  }
}

describe('buildBreadcrumbs', () => {
  it('walks the whole ancestor chain with real ids — the bug that made every trail two crumbs', () => {
    expect(buildBreadcrumbs(indexById(CHAIN), 'c')).toEqual([
      { id: null, name: 'Files', path: '/' },
      { id: 'a', name: 'a', path: '/a' },
      { id: 'b', name: 'b', path: '/a/b' },
      { id: 'c', name: 'c', path: '/a/b/c' },
    ])
  })

  it('never emits a placeholder id', () => {
    const ids = buildBreadcrumbs(indexById(CHAIN), 'c').map((crumb) => crumb.id)
    expect(ids).not.toContain('folder-lookup-needed')
  })

  it('returns the root alone for a null folder', () => {
    expect(buildBreadcrumbs(indexById(CHAIN), null)).toEqual([
      { id: null, name: 'Files', path: '/' },
    ])
  })

  it('returns the root alone for a folder outside the index', () => {
    // Soft-deleted, archived, or another organization's — all indistinguishable
    // here, and a partial trail with a hole in it is worse than none.
    expect(buildBreadcrumbs(indexById(CHAIN), 'missing')).toEqual([
      { id: null, name: 'Files', path: '/' },
    ])
  })

  it('terminates on a two-node cycle instead of looping forever', () => {
    const cyclic = [node('x', 'y'), node('y', 'x')]
    const trail = buildBreadcrumbs(indexById(cyclic), 'x')
    expect(trail.map((crumb) => crumb.id)).toEqual([null, 'y', 'x'])
  })

  it('terminates on a self-parenting folder', () => {
    const trail = buildBreadcrumbs(indexById([node('s', 's')]), 's')
    expect(trail.map((crumb) => crumb.id)).toEqual([null, 's'])
  })

  it('stops at the first unreachable ancestor', () => {
    // `b`'s parent `a` is not in the index (its row was soft-deleted); the trail
    // is the reachable part, not an exception.
    const partial = [node('b', 'a', 'b', '/a/b')]
    expect(buildBreadcrumbs(indexById(partial), 'b').map((c) => c.id)).toEqual([null, 'b'])
  })

  it('survives a 2,000-deep chain', () => {
    const deep: FolderNode[] = []
    for (let i = 0; i < 2000; i += 1) {
      deep.push(node(`n${i}`, i === 0 ? null : `n${i - 1}`))
    }
    expect(buildBreadcrumbs(indexById(deep), 'n1999')).toHaveLength(2001)
  })
})

describe('fileItemFromRow', () => {
  const index = indexById(CHAIN)

  it('maps folderId onto the unified parentId and normalises the size', () => {
    const item = fileItemFromRow(fileRow(), index)
    expect(item).toMatchObject({
      id: 'file_1',
      type: 'file',
      parentId: 'b',
      size: 2048,
      displaySize: 2048,
      isUploading: false,
    })
  })

  it('reports displaySize 0 for a null size rather than NaN', () => {
    expect(fileItemFromRow(fileRow({ size: null }), index).displaySize).toBe(0)
  })

  it('falls back to the library root for a file with no folder', () => {
    const item = fileItemFromRow(
      fileRow({ folderId: null, folderName: null, folderPath: null, path: '/report.pdf' }),
      index
    )
    expect(item.hierarchy).toEqual({
      folderName: 'Files',
      folderPath: '/',
      fullPath: '/report.pdf',
      breadcrumbs: [{ id: null, name: 'Files', path: '/' }],
    })
  })

  it('collapses the separator when joining the folder path and the name', () => {
    expect(fileItemFromRow(fileRow({ folderPath: '/' }), index).hierarchy?.fullPath).toBe(
      '/report.pdf'
    )
  })

  it('keeps the joined folder name even when that folder is absent from the index', () => {
    // The folder list is filtered to live, unarchived rows; the join is not.
    // This is why the join survived the rewrite.
    const item = fileItemFromRow(fileRow({ folderId: 'archived', folderName: 'Old' }), index)
    expect(item.hierarchy?.folderName).toBe('Old')
    expect(item.hierarchy?.breadcrumbs).toHaveLength(1)
  })
})

describe('fileItemFromFolderRow', () => {
  const index = indexById(CHAIN)

  it('carries both counts and names its parent, not itself', () => {
    const item = fileItemFromFolderRow(folderRow(), { fileCount: 7, subfolderCount: 2 }, index)
    expect(item).toMatchObject({
      type: 'folder',
      fileCount: 7,
      subfolderCount: 2,
      displaySize: 0,
      depth: 2,
    })
    expect(item.hierarchy?.folderName).toBe('b')
    expect(item.hierarchy?.fullPath).toBe('/a/b/c')
  })

  it('names the library root as the parent of a top-level folder', () => {
    const item = fileItemFromFolderRow(
      folderRow({ id: 'a', parentId: null, name: 'a', path: '/a', depth: 0 }),
      { fileCount: 0, subfolderCount: 1 },
      index
    )
    expect(item.hierarchy?.folderName).toBe('Files')
    expect(item.hierarchy?.folderPath).toBe('/')
  })
})

describe('fileItemFromFile / fileItemFromFolder', () => {
  it('shapes a full FolderFile row without a hierarchy', () => {
    const file = {
      id: 'file_1',
      organizationId: ORG,
      folderId: 'b',
      name: 'report.pdf',
      path: '/a/b/report.pdf',
      ext: 'pdf',
      mimeType: 'application/pdf',
      size: 10,
      checksum: null,
      currentVersionId: null,
      isArchived: false,
      deletedAt: null,
      createdById: 'usr_1',
      createdAt: AT,
      updatedAt: AT,
      provider: null,
    } as FolderFileEntity

    expect(fileItemFromFile(file)).toMatchObject({ type: 'file', parentId: 'b', displaySize: 10 })
    expect(fileItemFromFile(file).hierarchy).toBeUndefined()
  })

  it('defaults a null folder path to the root', () => {
    const folder = {
      id: 'a',
      organizationId: ORG,
      name: 'a',
      parentId: null,
      path: null,
      depth: 0,
      createdById: null,
      createdAt: AT,
      updatedAt: AT,
      deletedAt: null,
      isArchived: false,
    } as unknown as FolderEntity

    expect(fileItemFromFolder(folder)).toMatchObject({ type: 'folder', path: '/', displaySize: 0 })
  })
})

describe('the keyset cursor', () => {
  it('round-trips all three ordering columns', () => {
    const cursor = { path: '/a/b', name: 'x', id: 'file_1' }
    expect(decodeFileCursor(encodeFileCursor(cursor))).toEqual(cursor)
  })

  it.each([
    ['a path containing a slash and a comma', { path: '/a,b/c', name: 'n', id: 'i' }],
    ['a name containing unicode and whitespace', { path: '/p', name: '  ✓ ünïcode  ', id: 'i' }],
    ['an empty path (the library root)', { path: '', name: 'n', id: 'i' }],
  ])('round-trips %s', (_label, cursor) => {
    expect(decodeFileCursor(encodeFileCursor(cursor))).toEqual(cursor)
  })

  it.each([
    ['garbage', 'not-base64-at-all!!'],
    ['valid base64 that is not JSON', Buffer.from('hello', 'utf8').toString('base64url')],
    ['JSON missing a field', Buffer.from('{"path":"/a"}', 'utf8').toString('base64url')],
    ['JSON with the wrong types', Buffer.from('{"path":1,"name":2,"id":3}').toString('base64url')],
  ])('answers null for %s rather than throwing', (_label, raw) => {
    // A stale cursor from a previous deploy must restart the listing, not 400
    // an infinite query mid-scroll.
    expect(decodeFileCursor(raw)).toBeNull()
  })
})
