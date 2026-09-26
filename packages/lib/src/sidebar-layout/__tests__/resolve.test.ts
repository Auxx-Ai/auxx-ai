// packages/lib/src/sidebar-layout/__tests__/resolve.test.ts

import { describe, expect, it } from 'vitest'
import { resolveSidebarLayout } from '../resolve'
import type { SidebarLayoutSnapshot } from '../types'
import { favorite, folder, NAV_IDS, node, outline, RESOURCES } from './support/fixtures'

const resolve = (
  nodes: Parameters<typeof resolveSidebarLayout>[0]['nodes'],
  snapshot: SidebarLayoutSnapshot | null = null
) => resolveSidebarLayout({ nodes, snapshot, resources: RESOURCES, navIds: NAV_IDS })

describe('resolveSidebarLayout — un-customized', () => {
  it('falls back to the code default with no rows and no org snapshot', () => {
    const layout = resolve([])
    expect(layout.customized).toBe(false)
    expect(outline(layout)).toEqual({
      Workspace: ['nav:agents', 'nav:dispatch', 'nav:workflows'],
      Favorites: [],
      Records: ['entity:def_contact', 'entity:def_parcel(hidden)'],
    })
    expect(layout.groups.map((g) => g.key)).toEqual([
      'group:workspace',
      'group:favorites',
      'group:records',
    ])
    expect(layout.groups[0]!.children[0]).toMatchObject({ key: 'nav:agents', nodeId: null })
  })

  it('uses the org snapshot and appends what it does not place', () => {
    const snapshot: SidebarLayoutSnapshot = {
      version: 1,
      groups: [
        {
          key: 'records',
          systemKey: 'records',
          title: 'Customers',
          children: [
            {
              type: 'FOLDER',
              key: 'f1',
              title: 'Ops',
              children: [{ type: 'NAV', navId: 'dispatch' }],
            },
            { type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_parcel', isHidden: false },
          ],
        },
        { key: 'workspace', systemKey: 'workspace', title: 'Workspace', children: [] },
      ],
    }
    const layout = resolve([], snapshot)
    expect(outline(layout)).toEqual({
      Customers: ['folder:Ops', '  nav:dispatch', 'entity:def_parcel', 'entity:def_contact'],
      Workspace: ['nav:agents', 'nav:workflows'],
      Favorites: [],
    })
  })

  it('puts the member favorites (root rows and folders) under Favorites', () => {
    const layout = resolve([
      favorite('f2', 'a1'),
      folder('fold', 'a0'),
      favorite('f1', 'a0', 'fold'),
    ])
    expect(outline(layout).Favorites).toEqual(['folder:fold', '  fav:wf_f1', 'fav:wf_f2'])
    expect(layout.customized).toBe(false)
  })
})

describe('resolveSidebarLayout — customized', () => {
  const rows = [
    node({ id: 'g_ws', nodeType: 'GROUP', systemKey: 'workspace', title: 'Work', sortOrder: 'a1' }),
    node({
      id: 'g_fav',
      nodeType: 'GROUP',
      systemKey: 'favorites',
      title: 'Stars',
      sortOrder: 'a0',
    }),
    node({
      id: 'g_rec',
      nodeType: 'GROUP',
      systemKey: 'records',
      title: 'Records',
      sortOrder: 'a2',
    }),
    node({
      id: 'n_agents',
      parentId: 'g_fav',
      sortOrder: 'a0',
      targetType: 'NAV',
      targetIds: { navId: 'agents' },
    }),
    node({
      id: 'e_contact',
      parentId: 'g_ws',
      sortOrder: 'a0',
      targetType: 'ENTITY_DEFINITION',
      targetIds: { entityDefinitionId: 'def_contact' },
      isHidden: true,
    }),
    favorite('fav1', 'a1', 'g_fav'),
  ]

  it('renders the member rows and appends unplaced nav ids and defs to their home groups', () => {
    const layout = resolve(rows)
    expect(layout.customized).toBe(true)
    expect(outline(layout)).toEqual({
      Stars: ['nav:agents', 'fav:wf_fav1'],
      Work: ['entity:def_contact(hidden)', 'nav:dispatch', 'nav:workflows'],
      Records: ['entity:def_parcel(hidden)'],
    })
  })

  it('ignores the org snapshot once customized', () => {
    const snapshot: SidebarLayoutSnapshot = { version: 1, groups: [] }
    expect(outline(resolve(rows, snapshot))).toEqual(outline(resolve(rows)))
  })

  it('re-homes a stray root favorite into Favorites', () => {
    const layout = resolve([...rows, favorite('stray', 'a0')])
    expect(outline(layout).Stars).toEqual(['nav:agents', 'fav:wf_fav1', 'fav:wf_stray'])
  })

  it('keeps a row for a deleted def (the client skips it) and drops duplicates', () => {
    const layout = resolve([
      ...rows,
      node({
        id: 'e_gone',
        parentId: 'g_rec',
        sortOrder: 'a0',
        targetType: 'ENTITY_DEFINITION',
        targetIds: { entityDefinitionId: 'def_deleted' },
      }),
      node({
        id: 'n_dup',
        parentId: 'g_rec',
        sortOrder: 'a1',
        targetType: 'NAV',
        targetIds: { navId: 'agents' },
      }),
    ])
    expect(outline(layout).Records).toEqual(['entity:def_deleted', 'entity:def_parcel(hidden)'])
  })
})
