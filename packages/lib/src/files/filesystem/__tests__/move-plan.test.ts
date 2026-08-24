// packages/lib/src/files/filesystem/__tests__/move-plan.test.ts

/**
 * `filesystem/move-plan.ts` — every decision a bulk move makes, with no
 * database anywhere.
 *
 * `FilesystemService` reached all of this through `this.dbInstance`, one
 * `SELECT` per question, so the only way to exercise a collision, a cycle or a
 * pruned selection was to stand up Drizzle chain fakes. That is why the three
 * defects asserted below survived:
 *
 * - nested selections were pruned by **path prefix**, which is wrong whenever a
 *   stored `path` has drifted (PR 5d's `rebuildFolderPaths` exists for that);
 * - the cycle check walked one query per ancestor level, so it could not be
 *   proven correct against a graph that already contained a cycle;
 * - two identically-named items in one selection were both handed `name (1)`,
 *   because the "is this name free?" query ran against a database nothing had
 *   been written to yet.
 */

import { describe, expect, it } from 'vitest'
import type { FolderNode } from '../../folders/tree'
import type { FileItem } from '../items'
import type { MoveItemRef, MoveSnapshot } from '../move-plan'
import {
  buildMovePlan,
  generateUniqueName,
  MAX_RENAME_ATTEMPTS,
  pruneNestedSelections,
  summarizeMoveOutcomes,
} from '../move-plan'

function node(id: string, parentId: string | null, name = id, path = `/${name}`): FolderNode {
  return { id, parentId, name, path, depth: 0 }
}

function snapshot(overrides: Partial<MoveSnapshot> = {}): MoveSnapshot {
  return { files: [], folders: [], targetFileNames: [], ...overrides }
}

const anItem = (id: string, type: 'file' | 'folder'): MoveItemRef => ({ id, type })

describe('pruneNestedSelections', () => {
  it('drops a file whose folder is also selected', () => {
    const snap = snapshot({
      files: [{ id: 'f1', name: 'a.txt', folderId: 'A' }],
      folders: [node('A', null)],
    })
    const kept = pruneNestedSelections([anItem('A', 'folder'), anItem('f1', 'file')], snap)
    expect(kept).toEqual([anItem('A', 'folder')])
  })

  it('drops a file nested several levels under a selected folder', () => {
    const snap = snapshot({
      files: [{ id: 'f1', name: 'a.txt', folderId: 'C' }],
      folders: [node('A', null), node('B', 'A'), node('C', 'B')],
    })
    expect(pruneNestedSelections([anItem('A', 'folder'), anItem('f1', 'file')], snap)).toEqual([
      anItem('A', 'folder'),
    ])
  })

  it('drops a selected folder that lives under another selected folder', () => {
    const snap = snapshot({ folders: [node('A', null), node('B', 'A')] })
    expect(pruneNestedSelections([anItem('A', 'folder'), anItem('B', 'folder')], snap)).toEqual([
      anItem('A', 'folder'),
    ])
  })

  it('prunes by parentId, not by path — a drifted path must not change the answer', () => {
    // THE 5d finding, in this file's shape. Both folders carry a stale `path`
    // that says they are unrelated; the `parentId` edge says otherwise.
    const snap = snapshot({
      files: [{ id: 'f1', name: 'a.txt', folderId: 'B' }],
      folders: [node('A', null, 'A', '/somewhere-else'), node('B', 'A', 'B', '/totally/unrelated')],
    })
    expect(pruneNestedSelections([anItem('A', 'folder'), anItem('f1', 'file')], snap)).toEqual([
      anItem('A', 'folder'),
    ])
  })

  it('keeps a sibling whose path merely shares a prefix', () => {
    // `/Doc` vs `/Documents`: the exact pair that broke the delete cascade.
    const snap = snapshot({
      files: [{ id: 'f1', name: 'a.txt', folderId: 'Documents' }],
      folders: [
        node('Doc', null, 'Doc', '/Doc'),
        node('Documents', null, 'Documents', '/Documents'),
      ],
    })
    expect(pruneNestedSelections([anItem('Doc', 'folder'), anItem('f1', 'file')], snap)).toEqual([
      anItem('Doc', 'folder'),
      anItem('f1', 'file'),
    ])
  })

  it('keeps everything when no folder is selected', () => {
    const items = [anItem('f1', 'file'), anItem('f2', 'file')]
    expect(pruneNestedSelections(items, snapshot())).toEqual(items)
  })

  it('terminates on a cyclic parentId pair instead of hanging', () => {
    // `X -> Y -> X`. The descendant walk visits each node once, so `X` is not
    // reported as its own descendant and survives the prune.
    const snap = snapshot({ folders: [node('X', 'Y'), node('Y', 'X')] })
    expect(pruneNestedSelections([anItem('X', 'folder')], snap)).toEqual([anItem('X', 'folder')])
  })

  it('drops the other half of a cycle when both are selected', () => {
    const snap = snapshot({ folders: [node('X', 'Y'), node('Y', 'X')] })
    expect(pruneNestedSelections([anItem('X', 'folder'), anItem('Y', 'folder')], snap)).toEqual([])
  })
})

describe('generateUniqueName', () => {
  it('puts the suffix before the extension for files', () => {
    expect(generateUniqueName('report.pdf', 'file', new Set(['report.pdf']))).toBe('report (1).pdf')
  })

  it('appends the suffix for folders, dots and all', () => {
    expect(generateUniqueName('v1.2', 'folder', new Set(['v1.2']))).toBe('v1.2 (1)')
  })

  it('skips over variants already taken', () => {
    const taken = new Set(['a.txt', 'a (1).txt', 'a (2).txt'])
    expect(generateUniqueName('a.txt', 'file', taken)).toBe('a (3).txt')
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(generateUniqueName('.env', 'file', new Set(['.env']))).toBe('.env (1)')
  })

  it('gives up instead of looping forever when every variant is taken', () => {
    // The legacy was `do { … } while (await exists(candidate))` — no ceiling,
    // and one query per candidate.
    const taken = new Set<string>(['a'])
    for (let i = 1; i <= MAX_RENAME_ATTEMPTS; i += 1) taken.add(`a (${i})`)
    expect(generateUniqueName('a', 'folder', taken)).toBeNull()
  })
})

describe('buildMovePlan', () => {
  const files = [
    { id: 'f1', name: 'a.txt', folderId: 'SRC' },
    { id: 'f2', name: 'b.txt', folderId: 'SRC' },
  ]
  const folders = [node('SRC', null), node('DST', null), node('SUB', 'SRC')]

  it('plans a clean move with no rename', () => {
    const plan = buildMovePlan([anItem('f1', 'file')], 'DST', snapshot({ files, folders }))
    expect(plan).toEqual([{ id: 'f1', type: 'file', fromFolderId: 'SRC', toFolderId: 'DST' }])
  })

  it('emits files before folders, matching the legacy execution order', () => {
    const plan = buildMovePlan(
      [anItem('SUB', 'folder'), anItem('f1', 'file')],
      'DST',
      snapshot({ files, folders })
    )
    expect(plan.map((entry) => entry.id)).toEqual(['f1', 'SUB'])
  })

  it('skips an item already sitting in the target', () => {
    const plan = buildMovePlan([anItem('f1', 'file')], 'SRC', snapshot({ files, folders }))
    expect(plan[0]?.reason).toBe('Already in target folder')
  })

  it('skips an id that names nothing in this organization', () => {
    const plan = buildMovePlan([anItem('ghost', 'file')], 'DST', snapshot({ files, folders }))
    expect(plan[0]?.reason).toBe('File not found')
  })

  it('refuses to move a folder into its own subtree', () => {
    const plan = buildMovePlan([anItem('SRC', 'folder')], 'SUB', snapshot({ files, folders }))
    expect(plan[0]?.reason).toBe('Would create circular reference')
  })

  it('refuses to move a folder into itself', () => {
    const plan = buildMovePlan([anItem('SRC', 'folder')], 'SRC', snapshot({ files, folders }))
    expect(plan[0]?.reason).toBe('Would create circular reference')
  })

  it('treats a folder already under the target as a no-op, not a cycle', () => {
    const plan = buildMovePlan([anItem('SUB', 'folder')], 'SRC', snapshot({ files, folders }))
    expect(plan[0]?.reason).toBe('Already in target folder')
  })

  it('answers the cycle question from parentId even when every path is wrong', () => {
    const drifted = [
      node('P', null, 'P', '/wrong'),
      node('C', 'P', 'C', '/also-wrong'),
      node('DST', null),
    ]
    const plan = buildMovePlan([anItem('P', 'folder')], 'C', snapshot({ folders: drifted }))
    expect(plan[0]?.reason).toBe('Would create circular reference')
  })

  it("renames on collision, and the suffix respects the file's extension", () => {
    const plan = buildMovePlan(
      [anItem('f1', 'file')],
      'DST',
      snapshot({ files, folders, targetFileNames: ['a.txt'] })
    )
    expect(plan[0]).toMatchObject({ willRename: true, newName: 'a (1).txt' })
  })

  it('gives two identically-named items in one selection two DIFFERENT names', () => {
    // The legacy asked the database, which had not been written to yet, so both
    // came back "free at (1)" and the second write landed on the first.
    const twins = [
      { id: 'f1', name: 'a.txt', folderId: 'SRC' },
      { id: 'f2', name: 'a.txt', folderId: 'SRC' },
    ]
    const plan = buildMovePlan(
      [anItem('f1', 'file'), anItem('f2', 'file')],
      'DST',
      snapshot({ files: twins, folders, targetFileNames: ['a.txt'] })
    )
    expect(plan.map((entry) => entry.newName)).toEqual(['a (1).txt', 'a (2).txt'])
  })

  it('checks folder collisions against the target’s children, not against file names', () => {
    const withTwin = [...folders, node('SUB2', 'DST', 'SUB')]
    const plan = buildMovePlan([anItem('SUB', 'folder')], 'DST', snapshot({ folders: withTwin }))
    expect(plan[0]).toMatchObject({ willRename: true, newName: 'SUB (1)' })
  })

  it.each([
    ['fail', 'Name collision: a.txt already exists in target'],
    ['skip', 'SKIPPED due to name collision'],
  ] as const)('honours the %s collision policy', (collision, reason) => {
    const plan = buildMovePlan(
      [anItem('f1', 'file')],
      'DST',
      snapshot({ files, folders, targetFileNames: ['a.txt'] }),
      { collision }
    )
    expect(plan[0]?.reason).toBe(reason)
  })

  it('treats the UI’s `root` sentinel as the library root', () => {
    const rootFiles = [{ id: 'f1', name: 'a.txt', folderId: 'SRC' }]
    const plan = buildMovePlan(
      [anItem('f1', 'file')],
      'root',
      snapshot({ files: rootFiles, folders })
    )
    expect(plan[0]?.toFolderId).toBeNull()
  })

  it('reports a no-op for a root-level file already at the root', () => {
    const rootFiles = [{ id: 'f1', name: 'a.txt', folderId: null }]
    const plan = buildMovePlan(
      [anItem('f1', 'file')],
      null,
      snapshot({ files: rootFiles, folders })
    )
    expect(plan[0]?.reason).toBe('Already in target folder')
  })

  it('plans nothing for an empty selection', () => {
    expect(buildMovePlan([], 'DST', snapshot({ files, folders }))).toEqual([])
  })
})

describe('summarizeMoveOutcomes', () => {
  const anItemResult = { id: 'x' } as unknown as FileItem

  it('counts each status and reports success only when nothing failed', () => {
    const result = summarizeMoveOutcomes([
      { id: 'f1', type: 'file', status: 'moved', renamed: false, item: anItemResult },
      { id: 'f2', type: 'file', status: 'moved', renamed: true, item: anItemResult },
      { id: 'f3', type: 'file', status: 'skipped', reason: 'Already in target folder' },
    ])
    expect(result).toMatchObject({ success: true, moved: 2, failed: 0, skipped: 1 })
    expect(result.results).toHaveLength(3)
  })

  it('reports failure and carries the message through', () => {
    const result = summarizeMoveOutcomes([
      { id: 'f1', type: 'file', status: 'failed', error: 'File not found' },
    ])
    expect(result).toMatchObject({ success: false, moved: 0, failed: 1, skipped: 0 })
    expect(result.results[0]).toEqual({
      id: 'f1',
      type: 'file',
      success: false,
      error: 'File not found',
    })
  })

  it('marks a renamed move as renamed', () => {
    const result = summarizeMoveOutcomes([
      { id: 'f1', type: 'file', status: 'moved', renamed: true, item: anItemResult },
    ])
    expect(result.results[0]).toMatchObject({ success: true, renamed: true })
  })

  it('is success with zero of everything for an empty plan', () => {
    expect(summarizeMoveOutcomes([])).toEqual({
      success: true,
      moved: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
  })
})
