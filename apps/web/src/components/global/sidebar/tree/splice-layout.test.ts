// apps/web/src/components/global/sidebar/tree/splice-layout.test.ts

import type { ResolvedSidebarItem, ResolvedSidebarLayout } from '@auxx/lib/sidebar-layout/client'
import { describe, expect, it } from 'vitest'
import {
  addFolderInLayout,
  addGroupInLayout,
  moveInLayout,
  removeFromLayout,
  setHiddenInLayout,
} from './splice-layout'

const item = (key: string, targetType = 'NAV'): ResolvedSidebarItem => ({
  kind: 'ITEM',
  key,
  nodeId: null,
  targetType,
  targetIds: {},
  isHidden: false,
})

function layout(): ResolvedSidebarLayout {
  return {
    customized: false,
    groups: [
      {
        kind: 'GROUP',
        key: 'group:workspace',
        nodeId: null,
        systemKey: 'workspace',
        title: 'Workspace',
        isHidden: false,
        children: [item('nav:a'), item('nav:b')],
      },
      {
        kind: 'GROUP',
        key: 'group:records',
        nodeId: null,
        systemKey: 'records',
        title: 'Records',
        isHidden: false,
        children: [
          item('entity:x', 'ENTITY_DEFINITION'),
          {
            kind: 'FOLDER',
            key: 'folder:f',
            nodeId: null,
            title: 'F',
            isHidden: false,
            children: [item('nav:c')],
          },
        ],
      },
      {
        kind: 'GROUP',
        key: 'g-custom',
        nodeId: 'g-custom',
        systemKey: null,
        title: 'Custom',
        isHidden: false,
        children: [item('entity:y', 'ENTITY_DEFINITION'), item('nav:d')],
      },
    ],
  }
}

const keys = (l: ResolvedSidebarLayout) =>
  l.groups.map((g) => [
    g.key,
    g.children.map((c) => (c.kind === 'FOLDER' ? [c.key, c.children.map((i) => i.key)] : c.key)),
  ])

describe('splice-layout', () => {
  it('moves an item into a folder after the beforeId neighbour', () => {
    const next = moveInLayout(layout(), {
      nodeId: 'nav:a',
      parentId: 'folder:f',
      beforeId: 'nav:c',
    })
    expect(keys(next)[1]).toEqual(['group:records', ['entity:x', ['folder:f', ['nav:c', 'nav:a']]]])
    expect(keys(next)[0]).toEqual(['group:workspace', ['nav:b']])
  })

  it('places before afterId when no beforeId is given, and reorders groups', () => {
    const next = moveInLayout(layout(), {
      nodeId: 'g-custom',
      parentId: null,
      afterId: 'group:workspace',
    })
    expect(next.groups.map((g) => g.key)).toEqual(['g-custom', 'group:workspace', 'group:records'])
  })

  it('refuses a folder into a folder and leaves the input untouched', () => {
    const source = layout()
    expect(moveInLayout(source, { nodeId: 'folder:f', parentId: 'folder:f' })).toBe(source)
  })

  it('re-homes a deleted group by target type and dissolves a deleted folder into its group', () => {
    const noGroup = removeFromLayout(layout(), 'g-custom')
    expect(keys(noGroup)).toEqual([
      ['group:workspace', ['nav:a', 'nav:b', 'nav:d']],
      ['group:records', ['entity:x', ['folder:f', ['nav:c']], 'entity:y']],
    ])
    const noFolder = removeFromLayout(layout(), 'folder:f')
    expect(keys(noFolder)[1]).toEqual(['group:records', ['entity:x', 'nav:c']])
  })

  it('flips isHidden on the named node only', () => {
    const next = setHiddenInLayout(layout(), 'nav:c', true)
    const folder = next.groups[1]?.children[1]
    expect(folder?.kind === 'FOLDER' && folder.children[0]?.isHidden).toBe(true)
    expect(layout().groups[1]?.children[1]).toMatchObject({ isHidden: false })
  })
})

describe('optimistic create', () => {
  it('inserts a new group after its anchor', () => {
    const next = addGroupInLayout(layout(), 'pending-group:1', 'Mine', {
      beforeId: 'group:workspace',
    })
    expect(next.groups.map((g) => g.key).slice(0, 3)).toEqual([
      'group:workspace',
      'pending-group:1',
      'group:records',
    ])
    expect(next.groups[1]).toMatchObject({ title: 'Mine', children: [] })
  })

  it('appends a new folder to its group', () => {
    const next = addFolderInLayout(layout(), 'group:workspace', 'pending-folder:1', 'F', {})
    expect(next.groups[0]!.children.map((c) => c.key)).toEqual([
      'nav:a',
      'nav:b',
      'pending-folder:1',
    ])
  })

  it('leaves the layout alone when the parent group is unknown', () => {
    const before = layout()
    expect(addFolderInLayout(before, 'group:nope', 'pending-folder:1', 'F', {})).toBe(before)
  })
})
