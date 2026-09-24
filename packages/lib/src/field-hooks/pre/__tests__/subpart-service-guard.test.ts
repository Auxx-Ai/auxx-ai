// packages/lib/src/field-hooks/pre/__tests__/subpart-service-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ kinds: new Map<string, string>() }))

vi.mock('@auxx/database', () => ({ database: {} }))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        subpart_parent_part: { id: 'f_parent' },
        subpart_child_part: { id: 'f_child' },
      }),
    }),
  }),
}))

vi.mock('../../../inventory/builds/build-queries', () => ({
  readPartKinds: async () => h.kinds,
}))

import { BadRequestError } from '../../../errors'
import { guardSubpartServiceCreate } from '../subpart-service-guard'

function event(values: Record<string, unknown>) {
  return {
    entityDefinitionId: 'def_subpart',
    entityType: 'subpart',
    entitySlug: 'subparts',
    values,
    organizationId: 'org_1',
    userId: 'user_1',
  }
}

beforeEach(() => {
  h.kinds = new Map([
    ['part_asm', 'subassembly'],
    ['part_screw', 'component'],
    ['part_svc', 'service'],
  ])
})

describe('guardSubpartServiceCreate', () => {
  it('lets a BOM line between stocked parts through', async () => {
    await expect(
      guardSubpartServiceCreate(
        event({ subpart_parent_part: 'def_part:part_asm', subpart_child_part: 'part_screw' })
      )
    ).resolves.toBeUndefined()
  })

  it('refuses a service as the component', async () => {
    await expect(
      guardSubpartServiceCreate(
        event({ subpart_parent_part: 'part_asm', subpart_child_part: 'def_part:part_svc' })
      )
    ).rejects.toBeInstanceOf(BadRequestError)
  })

  it('refuses a service as the parent, reading a field-id-keyed patch too', async () => {
    await expect(
      guardSubpartServiceCreate(event({ f_parent: 'part_svc', f_child: 'part_screw' }))
    ).rejects.toThrow(/bill of materials/)
  })
})
