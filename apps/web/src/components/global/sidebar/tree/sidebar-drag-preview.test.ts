// apps/web/src/components/global/sidebar/tree/sidebar-drag-preview.test.ts

import type { ResolvedSidebarItem, ResolvedSidebarLayout } from '@auxx/lib/sidebar-layout/client'
import { describe, expect, it } from 'vitest'
import { parentKeyIn, planSidebarPreviewDrop, previewSidebarDragOver } from './sidebar-drag-preview'
import type { SidebarNodeDragData, SidebarNodeKind, SidebarOverData } from './sidebar-drop-rules'

const item = (key: string): ResolvedSidebarItem => ({
  kind: 'ITEM',
  key,
  nodeId: null,
  targetType: 'NAV',
  targetIds: {},
  isHidden: false,
})

// workspace: [a, b, ops{c, d}, e]   records: [x, y]   empty: []
const LAYOUT: ResolvedSidebarLayout = {
  customized: false,
  groups: [
    {
      kind: 'GROUP',
      key: 'workspace',
      nodeId: null,
      systemKey: 'workspace',
      title: 'Workspace',
      isHidden: false,
      children: [
        item('a'),
        item('b'),
        {
          kind: 'FOLDER',
          key: 'ops',
          nodeId: 'ops',
          title: 'Ops',
          isHidden: false,
          children: [item('c'), item('d')],
        },
        item('e'),
      ],
    },
    {
      kind: 'GROUP',
      key: 'records',
      nodeId: null,
      systemKey: 'records',
      title: 'Records',
      isHidden: false,
      children: [item('x'), item('y')],
    },
    {
      kind: 'GROUP',
      key: 'empty',
      nodeId: 'empty',
      systemKey: null,
      title: 'Empty',
      isHidden: false,
      children: [],
    },
  ],
}

const node = (
  key: string,
  kind: SidebarNodeKind,
  parentKey: string | null,
  open?: boolean
): SidebarNodeDragData => ({ type: 'sidebar-node', key, kind, parentKey, label: key, open })
const groupTarget = (groupKey: string, open = true): SidebarOverData => ({
  type: 'sidebar-group-target',
  groupKey,
  open,
})
const folderTarget = (folderKey: string, open = true): SidebarOverData => ({
  type: 'sidebar-folder-target',
  folderKey,
  open,
})

/** Container → child keys, for readable assertions. */
function shape(layout: ResolvedSidebarLayout): Record<string, string[]> {
  const out: Record<string, string[]> = { root: layout.groups.map((g) => g.key) }
  for (const g of layout.groups) {
    out[g.key] = g.children.map((c) => c.key)
    for (const c of g.children) if (c.kind === 'FOLDER') out[c.key] = c.children.map((i) => i.key)
  }
  return out
}

const preview = (
  active: SidebarNodeDragData,
  over: SidebarOverData | undefined,
  below = false,
  layout = LAYOUT
) => previewSidebarDragOver(layout, active, over, below)

describe('parentKeyIn', () => {
  it('finds groups, group children and folder children', () => {
    expect(parentKeyIn(LAYOUT, 'records')).toBeNull()
    expect(parentKeyIn(LAYOUT, 'ops')).toBe('workspace')
    expect(parentKeyIn(LAYOUT, 'd')).toBe('ops')
    expect(parentKeyIn(LAYOUT, 'ghost')).toBeUndefined()
  })
})

describe('previewSidebarDragOver', () => {
  const a = node('a', 'ITEM', 'workspace')

  it('moves an item into another group above or below the over row', () => {
    expect(shape(preview(a, node('y', 'ITEM', 'records'))).records).toEqual(['x', 'a', 'y'])
    const below = shape(preview(a, node('y', 'ITEM', 'records'), true))
    expect(below.records).toEqual(['x', 'y', 'a'])
    expect(below.workspace).toEqual(['b', 'ops', 'e'])
  })

  it('moves an item into an open folder via its row or target, appended', () => {
    expect(shape(preview(a, node('ops', 'FOLDER', 'workspace', true))).ops).toEqual(['c', 'd', 'a'])
    expect(shape(preview(a, folderTarget('ops'))).ops).toEqual(['c', 'd', 'a'])
  })

  it('moves an item into a folder at a folder row', () => {
    expect(shape(preview(node('x', 'ITEM', 'records'), node('d', 'ITEM', 'ops'))).ops).toEqual([
      'c',
      'x',
      'd',
    ])
  })

  it('moves an item out of a folder onto a group row', () => {
    const next = shape(preview(node('c', 'ITEM', 'ops'), node('e', 'ITEM', 'workspace'), true))
    expect(next.ops).toEqual(['d'])
    expect(next.workspace).toEqual(['a', 'b', 'ops', 'e', 'c'])
  })

  it('prepends into an open group via its header, including an empty one', () => {
    expect(shape(preview(a, groupTarget('records'))).records).toEqual(['a', 'x', 'y'])
    expect(shape(preview(a, groupTarget('empty'))).empty).toEqual(['a'])
    // A folder's item onto its own group's header leaves the folder.
    expect(shape(preview(node('c', 'ITEM', 'ops'), groupTarget('workspace'))).workspace).toEqual([
      'c',
      'a',
      'b',
      'ops',
      'e',
    ])
  })

  it('moves a folder into another group at the over row', () => {
    const ops = node('ops', 'FOLDER', 'workspace')
    expect(shape(preview(ops, node('x', 'ITEM', 'records'), true)).records).toEqual([
      'x',
      'ops',
      'y',
    ])
    expect(shape(preview(ops, groupTarget('empty'))).empty).toEqual(['ops'])
  })

  it('leaves the layout alone for same-container, closed, rejected or empty overs', () => {
    const cases: [SidebarNodeDragData, SidebarOverData | undefined][] = [
      [a, undefined],
      [a, a],
      [a, node('b', 'ITEM', 'workspace')],
      [node('c', 'ITEM', 'ops'), node('d', 'ITEM', 'ops')],
      [a, folderTarget('ops', false)],
      [a, node('ops', 'FOLDER', 'workspace', false)],
      [a, groupTarget('records', false)],
      [a, groupTarget('workspace')],
      [node('c', 'ITEM', 'ops'), folderTarget('ops')],
      [node('ops', 'FOLDER', 'workspace'), node('c', 'ITEM', 'ops')],
      [node('ops', 'FOLDER', 'workspace'), folderTarget('ops')],
      [node('records', 'GROUP', null), node('workspace', 'GROUP', null)],
      [a, node('records', 'GROUP', null)],
      [a, node('ghost', 'ITEM', 'records')],
      [node('ghost', 'ITEM', 'records'), node('x', 'ITEM', 'records')],
    ]
    for (const [active, over] of cases) expect(preview(active, over)).toBe(LAYOUT)
  })
})

describe('planSidebarPreviewDrop', () => {
  const a = node('a', 'ITEM', 'workspace')

  it('commits the preview position when released on itself or nothing', () => {
    const moved = preview(a, node('y', 'ITEM', 'records'))
    const expected = { nodeId: 'a', parentId: 'records', beforeId: 'x', afterId: 'y' }
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, a)).toEqual(expected)
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, undefined)).toEqual(expected)
  })

  it('applies the final same-container sort on top of the preview', () => {
    const moved = preview(a, node('x', 'ITEM', 'records')) // records: [a, x, y]
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, node('y', 'ITEM', 'records'))).toEqual({
      nodeId: 'a',
      parentId: 'records',
    })
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, node('x', 'ITEM', 'records'))).toEqual({
      nodeId: 'a',
      parentId: 'records',
      beforeId: 'x',
      afterId: 'y',
    })
  })

  it('reads the drag data parent from the preview, not the stale payload', () => {
    // Moved into records, then released on records' header: stays prepended.
    const moved = preview(a, groupTarget('records'))
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, groupTarget('records'))).toEqual({
      nodeId: 'a',
      parentId: 'records',
      afterId: 'x',
    })
  })

  it('appends into a folder with no anchors (the server reads that as end)', () => {
    const moved = preview(a, folderTarget('ops'))
    expect(planSidebarPreviewDrop(LAYOUT, moved, a, folderTarget('ops'))).toEqual({
      nodeId: 'a',
      parentId: 'ops',
    })
    // Closed folder: no preview, the drop itself goes in.
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, a, folderTarget('ops', false))).toEqual({
      nodeId: 'a',
      parentId: 'ops',
    })
  })

  it('moves out of a folder', () => {
    const c = node('c', 'ITEM', 'ops')
    const moved = preview(c, node('a', 'ITEM', 'workspace'))
    expect(planSidebarPreviewDrop(LAYOUT, moved, c, c)).toEqual({
      nodeId: 'c',
      parentId: 'workspace',
      afterId: 'a',
    })
  })

  it('keeps plain same-container sorting and group reordering', () => {
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, a, node('b', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'a',
      parentId: 'workspace',
      beforeId: 'b',
      afterId: 'ops',
    })
    const ws = node('workspace', 'GROUP', null)
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, ws, node('records', 'GROUP', null))).toEqual({
      nodeId: 'workspace',
      parentId: null,
      beforeId: 'records',
      afterId: 'empty',
    })
  })

  it('is a no-op when the node ends where it started', () => {
    // Out to records and back to its original slot.
    const out = preview(a, node('x', 'ITEM', 'records'))
    const back = preview(a, node('b', 'ITEM', 'workspace'), false, out)
    expect(planSidebarPreviewDrop(LAYOUT, back, a, a)).toBeNull()
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, a, undefined)).toBeNull()
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, a, groupTarget('workspace'))).toBeNull()
  })

  it('rejects drops the rules reject', () => {
    const ops = node('ops', 'FOLDER', 'workspace')
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, ops, node('c', 'ITEM', 'ops'))).toBeNull()
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, ops, folderTarget('ops'))).toBeNull()
    expect(planSidebarPreviewDrop(LAYOUT, LAYOUT, node('ghost', 'ITEM', 'x'), a)).toBeNull()
  })
})

describe('previewSidebarDragOver — Favorites', () => {
  const FAV: ResolvedSidebarLayout = {
    ...LAYOUT,
    groups: [
      {
        kind: 'GROUP',
        key: 'favorites',
        nodeId: 'favorites',
        systemKey: 'favorites',
        title: 'Favorites',
        isHidden: false,
        children: [{ ...item('f1'), targetType: 'TABLE_VIEW' }],
      },
      ...LAYOUT.groups,
    ],
  }

  it('never previews a nav item into Favorites', () => {
    const a = node('a', 'ITEM', 'workspace')
    expect(preview(a, groupTarget('favorites'), false, FAV)).toBe(FAV)
    expect(preview(a, node('f1', 'ITEM', 'favorites'), false, FAV)).toBe(FAV)
    expect(preview(node('ops', 'FOLDER', 'workspace'), groupTarget('favorites'), false, FAV)).toBe(
      FAV
    )
  })

  it('still previews a favorite out of Favorites', () => {
    const f1 = node('f1', 'ITEM', 'favorites')
    expect(shape(preview(f1, node('x', 'ITEM', 'records'), false, FAV)).records).toEqual([
      'f1',
      'x',
      'y',
    ])
  })
})
