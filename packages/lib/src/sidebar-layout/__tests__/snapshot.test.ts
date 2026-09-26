// packages/lib/src/sidebar-layout/__tests__/snapshot.test.ts

import { describe, expect, it } from 'vitest'
import { resolveSidebarLayout } from '../resolve'
import {
  codeDefaultSnapshot,
  parseSidebarLayoutSnapshot,
  snapshotFromLayout,
  snapshotFromLegacyEntitySettings,
} from '../snapshot'
import { favorite, folder, NAV_IDS, node, outline, RESOURCES } from './support/fixtures'

describe('snapshotFromLegacyEntitySettings', () => {
  it('reproduces the legacy Records tree: folders, order, visibility, hidden group', () => {
    const snapshot = snapshotFromLegacyEntitySettings(
      {
        order: ['def_b', 'fold1', 'def_a', 'def_c'],
        visibility: { def_a: false, def_c: true, def_z: false },
        groupVisible: false,
        folders: [
          { id: 'fold1', title: 'Sales' },
          { id: 'fold2', title: 'Unordered' },
        ],
        folderItems: { fold1: ['def_c', 'def_d'] },
      },
      NAV_IDS
    )

    const records = snapshot.groups.find((g) => g.systemKey === 'records')!
    expect(records.isHidden).toBe(true)
    expect(records.children).toEqual([
      { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_b' },
      {
        type: 'FOLDER',
        key: 'fold1',
        title: 'Sales',
        children: [
          { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_c', isHidden: false },
          { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_d' },
        ],
      },
      { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_a', isHidden: true },
      { type: 'FOLDER', key: 'fold2', title: 'Unordered', children: [] },
      { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_z', isHidden: true },
    ])
    expect(snapshot.groups.map((g) => g.systemKey)).toEqual(['workspace', 'favorites', 'records'])
    expect(snapshot.groups[0]!.children).toEqual(NAV_IDS.map((navId) => ({ type: 'NAV', navId })))
    expect(parseSidebarLayoutSnapshot(snapshot)).toEqual(snapshot)
  })

  it('tolerates malformed legacy values', () => {
    const snapshot = snapshotFromLegacyEntitySettings(
      { order: 'nope', visibility: [], folders: [{ id: 1 }], folderItems: null },
      NAV_IDS
    )
    expect(snapshot.groups.find((g) => g.systemKey === 'records')!.children).toEqual([])
  })
})

describe('parseSidebarLayoutSnapshot', () => {
  it('reads malformed values as no org default', () => {
    expect(parseSidebarLayoutSnapshot(null)).toBeNull()
    expect(parseSidebarLayoutSnapshot({ version: 2, groups: [] })).toBeNull()
    expect(parseSidebarLayoutSnapshot(codeDefaultSnapshot(NAV_IDS))).not.toBeNull()
  })
})

describe('snapshotFromLayout', () => {
  it('strips favorites and the folders they leave empty, and round-trips the rest', () => {
    const rows = [
      node({
        id: 'g_ws',
        nodeType: 'GROUP',
        systemKey: 'workspace',
        title: 'Work',
        sortOrder: 'a0',
      }),
      node({
        id: 'g_fav',
        nodeType: 'GROUP',
        systemKey: 'favorites',
        title: 'Favorites',
        sortOrder: 'a1',
      }),
      node({
        id: 'g_rec',
        nodeType: 'GROUP',
        systemKey: 'records',
        title: 'Records',
        sortOrder: 'a2',
      }),
      folder('favs_only', 'a0', 'g_fav'),
      favorite('f1', 'a0', 'favs_only'),
      folder('mixed', 'a1', 'g_fav', 'Mixed'),
      favorite('f2', 'a0', 'mixed'),
      node({
        id: 'n1',
        parentId: 'mixed',
        sortOrder: 'a1',
        targetType: 'NAV',
        targetIds: { navId: 'agents' },
      }),
      folder('empty', 'a2', 'g_fav', 'Empty'),
    ]
    const layout = resolveSidebarLayout({
      nodes: rows,
      snapshot: null,
      resources: RESOURCES,
      navIds: NAV_IDS,
    })
    const snapshot = snapshotFromLayout(layout)
    const favorites = snapshot.groups.find((g) => g.systemKey === 'favorites')!
    expect(favorites.children).toEqual([
      {
        type: 'FOLDER',
        key: 'mixed',
        title: 'Mixed',
        children: [{ type: 'NAV', navId: 'agents' }],
      },
      { type: 'FOLDER', key: 'empty', title: 'Empty', children: [] },
    ])
    expect(JSON.stringify(snapshot)).not.toContain('WORKFLOW')

    // A member with no rows under this snapshot sees the same non-favorite layout.
    const fromSnapshot = resolveSidebarLayout({
      nodes: [],
      snapshot,
      resources: RESOURCES,
      navIds: NAV_IDS,
    })
    expect(outline(fromSnapshot).Work).toEqual(outline(layout).Work)
    expect(outline(fromSnapshot).Records).toEqual(outline(layout).Records)
  })
})
