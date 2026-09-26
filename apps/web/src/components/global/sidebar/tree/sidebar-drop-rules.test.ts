// apps/web/src/components/global/sidebar/tree/sidebar-drop-rules.test.ts

import type { ResolvedSidebarItem, ResolvedSidebarLayout } from '@auxx/lib/sidebar-layout/client'
import { describe, expect, it } from 'vitest'
import {
  planSidebarDrop,
  type SidebarNodeDragData,
  type SidebarNodeKind,
  sidebarParentAccepts,
  sortableAcceptsDrag,
} from './sidebar-drop-rules'

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
  parentKey: string | null
): SidebarNodeDragData => ({
  type: 'sidebar-node',
  key,
  kind,
  parentKey,
  label: key,
})
const groupTarget = (groupKey: string) => ({ type: 'sidebar-group-target' as const, groupKey })
const folderTarget = (folderKey: string) => ({ type: 'sidebar-folder-target' as const, folderKey })

const plan = (active: SidebarNodeDragData, over: Parameters<typeof planSidebarDrop>[1]) =>
  planSidebarDrop(active, over, LAYOUT)

describe('planSidebarDrop — groups', () => {
  it('reorders down among groups (arrayMove)', () => {
    expect(plan(node('workspace', 'GROUP', null), node('records', 'GROUP', null))).toEqual({
      nodeId: 'workspace',
      parentId: null,
      beforeId: 'records',
      afterId: 'empty',
    })
  })

  it('reorders up among groups', () => {
    expect(plan(node('empty', 'GROUP', null), node('workspace', 'GROUP', null))).toEqual({
      nodeId: 'empty',
      parentId: null,
      afterId: 'workspace',
    })
  })

  it('ignores rows, folders and header targets', () => {
    const g = node('records', 'GROUP', null)
    expect(plan(g, node('a', 'ITEM', 'workspace'))).toBeNull()
    expect(plan(g, node('ops', 'FOLDER', 'workspace'))).toBeNull()
    expect(plan(g, groupTarget('workspace'))).toBeNull()
    expect(plan(g, folderTarget('ops'))).toBeNull()
  })
})

describe('planSidebarDrop — folders', () => {
  const ops = node('ops', 'FOLDER', 'workspace')

  it('appends into another group via its header or section', () => {
    const expected = { nodeId: 'ops', parentId: 'records' }
    expect(plan(ops, groupTarget('records'))).toEqual(expected)
    expect(plan(ops, node('records', 'GROUP', null))).toEqual(expected)
  })

  it('appends into a collapsed/empty group', () => {
    expect(plan(ops, groupTarget('empty'))).toEqual({ nodeId: 'ops', parentId: 'empty' })
  })

  it('is a no-op on its own group', () => {
    expect(plan(ops, groupTarget('workspace'))).toBeNull()
    expect(plan(ops, node('workspace', 'GROUP', null))).toBeNull()
  })

  it('reorders among its group siblings', () => {
    expect(plan(ops, node('a', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'ops',
      parentId: 'workspace',
      afterId: 'a',
    })
    expect(plan(ops, node('e', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'ops',
      parentId: 'workspace',
      beforeId: 'e',
    })
  })

  it('moves into another group at the over row', () => {
    expect(plan(ops, node('y', 'ITEM', 'records'))).toEqual({
      nodeId: 'ops',
      parentId: 'records',
      beforeId: 'x',
      afterId: 'y',
    })
  })

  it('never enters a folder', () => {
    expect(plan(ops, folderTarget('ops'))).toBeNull()
    expect(plan(ops, node('c', 'ITEM', 'ops'))).toBeNull()
  })
})

describe('planSidebarDrop — items', () => {
  it('appends into a folder via its droppable or its sortable row', () => {
    const a = node('a', 'ITEM', 'workspace')
    const expected = { nodeId: 'a', parentId: 'ops' }
    expect(plan(a, folderTarget('ops'))).toEqual(expected)
    expect(plan(a, node('ops', 'FOLDER', 'workspace'))).toEqual(expected)
  })

  it('is a no-op on its own folder', () => {
    const c = node('c', 'ITEM', 'ops')
    expect(plan(c, folderTarget('ops'))).toBeNull()
    expect(plan(c, node('ops', 'FOLDER', 'workspace'))).toBeNull()
  })

  it('appends into a group via its header or section', () => {
    const c = node('c', 'ITEM', 'ops')
    expect(plan(c, groupTarget('records'))).toEqual({ nodeId: 'c', parentId: 'records' })
    expect(plan(c, node('empty', 'GROUP', null))).toEqual({ nodeId: 'c', parentId: 'empty' })
    // Out of a folder into the folder's own group.
    expect(plan(c, groupTarget('workspace'))).toEqual({ nodeId: 'c', parentId: 'workspace' })
  })

  it('is a no-op on its own group', () => {
    expect(plan(node('a', 'ITEM', 'workspace'), groupTarget('workspace'))).toBeNull()
  })

  it('reorders within the same parent (arrayMove)', () => {
    expect(plan(node('a', 'ITEM', 'workspace'), node('b', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'a',
      parentId: 'workspace',
      beforeId: 'b',
      afterId: 'ops',
    })
    expect(plan(node('e', 'ITEM', 'workspace'), node('a', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'e',
      parentId: 'workspace',
      afterId: 'a',
    })
    expect(plan(node('d', 'ITEM', 'ops'), node('c', 'ITEM', 'ops'))).toEqual({
      nodeId: 'd',
      parentId: 'ops',
      afterId: 'c',
    })
  })

  it('moves across parents into the over row slot', () => {
    expect(plan(node('a', 'ITEM', 'workspace'), node('y', 'ITEM', 'records'))).toEqual({
      nodeId: 'a',
      parentId: 'records',
      beforeId: 'x',
      afterId: 'y',
    })
    expect(plan(node('x', 'ITEM', 'records'), node('d', 'ITEM', 'ops'))).toEqual({
      nodeId: 'x',
      parentId: 'ops',
      beforeId: 'c',
      afterId: 'd',
    })
    expect(plan(node('c', 'ITEM', 'ops'), node('a', 'ITEM', 'workspace'))).toEqual({
      nodeId: 'c',
      parentId: 'workspace',
      afterId: 'a',
    })
  })

  it('ignores self, missing over and unknown rows', () => {
    const a = node('a', 'ITEM', 'workspace')
    expect(plan(a, undefined)).toBeNull()
    expect(plan(a, a)).toBeNull()
    expect(plan(a, node('ghost', 'ITEM', 'workspace'))).toBeNull()
  })
})

describe('sortableAcceptsDrag', () => {
  it('matches the drop rules', () => {
    expect(sortableAcceptsDrag({ kind: 'GROUP' }, 'GROUP')).toBe(true)
    expect(sortableAcceptsDrag({ kind: 'GROUP' }, 'ITEM')).toBe(false)
    expect(sortableAcceptsDrag({ kind: 'GROUP' }, 'FOLDER')).toBe(false)
    expect(sortableAcceptsDrag({ kind: 'FOLDER' }, 'GROUP')).toBe(false)
    expect(sortableAcceptsDrag({ kind: 'FOLDER' }, 'FOLDER')).toBe(true)
    expect(sortableAcceptsDrag({ kind: 'ITEM' }, 'GROUP')).toBe(false)
    expect(sortableAcceptsDrag({ kind: 'ITEM', inFolder: false }, 'FOLDER')).toBe(true)
    expect(sortableAcceptsDrag({ kind: 'ITEM', inFolder: true }, 'FOLDER')).toBe(false)
    expect(sortableAcceptsDrag({ kind: 'ITEM', inFolder: true }, 'ITEM')).toBe(true)
  })
})

describe('Favorites holds only favorite targets', () => {
  const fav = (key: string): ResolvedSidebarItem => ({ ...item(key), targetType: 'TABLE_VIEW' })
  // favorites: [f1, favs{f2}]   workspace: [n (NAV), f3, mixed{f4, n2 (NAV)}, clean{f5}, bare{}]
  const FAV_LAYOUT: ResolvedSidebarLayout = {
    customized: true,
    groups: [
      {
        kind: 'GROUP',
        key: 'favorites',
        nodeId: 'favorites',
        systemKey: 'favorites',
        title: 'Favorites',
        isHidden: false,
        children: [
          fav('f1'),
          {
            kind: 'FOLDER',
            key: 'favs',
            nodeId: 'favs',
            title: 'Favs',
            isHidden: false,
            children: [fav('f2')],
          },
        ],
      },
      {
        kind: 'GROUP',
        key: 'workspace',
        nodeId: 'workspace',
        systemKey: 'workspace',
        title: 'Workspace',
        isHidden: false,
        children: [
          item('n'),
          fav('f3'),
          {
            kind: 'FOLDER',
            key: 'mixed',
            nodeId: 'mixed',
            title: 'Mixed',
            isHidden: false,
            children: [fav('f4'), item('n2')],
          },
          {
            kind: 'FOLDER',
            key: 'clean',
            nodeId: 'clean',
            title: 'Clean',
            isHidden: false,
            children: [fav('f5')],
          },
          {
            kind: 'FOLDER',
            key: 'bare',
            nodeId: 'bare',
            title: 'Bare',
            isHidden: false,
            children: [],
          },
        ],
      },
    ],
  }
  const accepts = (parent: string | null, key: string) =>
    sidebarParentAccepts(FAV_LAYOUT, parent, key)
  const planFav = (active: SidebarNodeDragData, over: Parameters<typeof planSidebarDrop>[1]) =>
    planSidebarDrop(active, over, FAV_LAYOUT)

  it('keeps nav/entity items out of Favorites and its folders', () => {
    expect(accepts('favorites', 'n')).toBe(false)
    expect(accepts('favs', 'n')).toBe(false)
    expect(accepts('favs', 'n2')).toBe(false)
    expect(accepts('favorites', 'f3')).toBe(true)
    expect(accepts('favs', 'f4')).toBe(true)
  })

  it('lets a folder in only when every child is a favorite target', () => {
    expect(accepts('favorites', 'mixed')).toBe(false)
    expect(accepts('favorites', 'clean')).toBe(true)
    expect(accepts('favorites', 'bare')).toBe(true)
  })

  it('leaves other containers, the group list and unknown nodes alone', () => {
    expect(accepts('workspace', 'f1')).toBe(true)
    expect(accepts('clean', 'n')).toBe(true)
    expect(accepts(null, 'favorites')).toBe(true)
    expect(accepts('favorites', 'ghost')).toBe(true)
  })

  it('rejects the drops in planSidebarDrop', () => {
    const n = node('n', 'ITEM', 'workspace')
    expect(planFav(n, groupTarget('favorites'))).toBeNull()
    expect(planFav(n, folderTarget('favs'))).toBeNull()
    expect(planFav(n, node('favs', 'FOLDER', 'favorites'))).toBeNull()
    expect(planFav(n, node('f1', 'ITEM', 'favorites'))).toBeNull()
    expect(planFav(node('mixed', 'FOLDER', 'workspace'), groupTarget('favorites'))).toBeNull()
    expect(planFav(node('clean', 'FOLDER', 'workspace'), groupTarget('favorites'))).toEqual({
      nodeId: 'clean',
      parentId: 'favorites',
    })
    // Favorites still move out.
    expect(planFav(node('f1', 'ITEM', 'favorites'), groupTarget('workspace'))).toEqual({
      nodeId: 'f1',
      parentId: 'workspace',
    })
  })
})
