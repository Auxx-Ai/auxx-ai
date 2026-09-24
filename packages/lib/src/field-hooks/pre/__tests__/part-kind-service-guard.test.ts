// packages/lib/src/field-hooks/pre/__tests__/part-kind-service-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rows: [] as { partId: string | null; fieldId: string }[] }
  const db = {
    selectDistinct: () => ({
      from: () => ({ innerJoin: () => ({ where: async () => state.rows }) }),
    }),
  }
  return { state, db }
})

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: h.db,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(attrs.map((a) => [a, { id: `f_${a}` }])),
    }),
  }),
}))

import { BadRequestError } from '../../../errors'
import { guardPartKindService } from '../part-kind-service-guard'

function event(optionId: string) {
  return {
    recordId: 'def_part:part_1',
    entityDefinitionId: 'def_part',
    entityType: 'part',
    entitySlug: 'parts',
    fieldId: 'f_part_kind',
    systemAttribute: 'part_kind',
    field: {},
    newValue: { type: 'option', optionId },
    existingValue: undefined,
    allValues: new Map(),
    organizationId: 'org_1',
    userId: 'user_1',
    bypass: new Set(),
  } as never
}

beforeEach(() => {
  h.state.rows = []
})

describe('guardPartKindService', () => {
  it('lets a part with no stock history become a service', async () => {
    await expect(guardPartKindService(event('service'))).resolves.toEqual({
      type: 'option',
      optionId: 'service',
    })
  })

  it('never checks a change to a stocked kind', async () => {
    h.state.rows = [{ partId: 'part_1', fieldId: 'f_stock_movement_part' }]
    await expect(guardPartKindService(event('finished_good'))).resolves.toBeDefined()
  })

  it('refuses a part with stock movements, naming why', async () => {
    h.state.rows = [{ partId: 'part_1', fieldId: 'f_stock_movement_part' }]
    const run = guardPartKindService(event('service'))
    await expect(run).rejects.toBeInstanceOf(BadRequestError)
    await expect(run).rejects.toThrow(/it has stock movements/)
  })

  it('refuses a BOM component and a BOM parent', async () => {
    h.state.rows = [{ partId: 'part_1', fieldId: 'f_subpart_child_part' }]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/component/)
    h.state.rows = [{ partId: 'part_1', fieldId: 'f_subpart_parent_part' }]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/bill of materials/)
  })

  it('refuses a part with a build, and movements win the sentence', async () => {
    h.state.rows = [{ partId: 'part_1', fieldId: 'f_build_part' }]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/it has builds/)
    h.state.rows = [
      { partId: 'part_1', fieldId: 'f_build_part' },
      { partId: 'part_1', fieldId: 'f_stock_movement_part' },
    ]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/stock movements/)
  })
})
