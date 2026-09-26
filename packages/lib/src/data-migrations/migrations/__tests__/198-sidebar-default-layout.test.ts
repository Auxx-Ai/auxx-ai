// packages/lib/src/data-migrations/migrations/__tests__/198-sidebar-default-layout.test.ts

import { describe, expect, it } from 'vitest'
import { ALL_DATA_MIGRATIONS } from '../../registry'
import { planSidebarDefaultLayouts } from '../198-sidebar-default-layout'

describe('198-sidebar-default-layout', () => {
  it('is registered', () => {
    expect(ALL_DATA_MIGRATIONS.map((m) => m.id)).toContain('198-sidebar-default-layout')
  })

  it('converts only orgs that stored a legacy Records setting and have no snapshot yet', () => {
    const planned = planSidebarDefaultLayouts([
      { organizationId: 'org_a', key: 'sidebar.entities.order', value: ['def_1'] },
      { organizationId: 'org_a', key: 'sidebar.entities.groupVisible', value: false },
      { organizationId: 'org_b', key: 'sidebar.entities.order', value: ['def_2'] },
      { organizationId: 'org_b', key: 'sidebar.defaultLayout', value: { version: 1, groups: [] } },
      { organizationId: 'org_c', key: 'sidebar.defaultLayout', value: null },
      { organizationId: 'org_d', key: 'sidebar.inboxes', value: {} },
    ])

    expect([...planned.keys()]).toEqual(['org_a'])
    const records = planned.get('org_a')!.groups.find((g) => g.systemKey === 'records')!
    expect(records.isHidden).toBe(true)
    expect(records.children).toEqual([{ type: 'ENTITY_DEFINITION', entityDefinitionId: 'def_1' }])
  })
})
