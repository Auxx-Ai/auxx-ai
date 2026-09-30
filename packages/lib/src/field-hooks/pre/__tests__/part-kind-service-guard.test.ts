// packages/lib/src/field-hooks/pre/__tests__/part-kind-service-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    moved: [] as { partId: string }[],
    built: [] as { partId: string }[],
    rows: [] as { partId: string | null; fieldId: string }[],
    buildTable: null as unknown,
  }
  const db = {
    selectDistinct: () => ({
      from: (table: unknown) => ({
        where: async () => (table === state.buildTable ? state.built : state.moved),
      }),
    }),
  }
  return { state, db }
})

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: h.db,
}))

vi.mock('../../../resources/system-records', () => ({
  systemFields: async (_db: unknown, _org: string, entityType: string, attrs: string[]) => ({
    defId: `def_${entityType}`,
    fields: Object.fromEntries(attrs.map((a) => [a, { id: `f_${a}` }])),
  }),
  findSystemRecordIdsByValue: async (
    _db: unknown,
    _org: string,
    ctx: { fields: Record<string, { id: string }> },
    where: { attribute: string; related: string[] }
  ) => {
    const out = new Map<string, string[]>()
    for (const row of h.state.rows) {
      if (row.fieldId !== ctx.fields[where.attribute]?.id) continue
      if (row.partId && where.related.includes(row.partId)) out.set(row.partId, ['child_1'])
    }
    return out
  },
}))

import { schema } from '@auxx/database'
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
  h.state.moved = []
  h.state.built = []
  h.state.buildTable = schema.Build
})

describe('guardPartKindService', () => {
  it('lets a part with no stock history become a service', async () => {
    await expect(guardPartKindService(event('service'))).resolves.toEqual({
      type: 'option',
      optionId: 'service',
    })
  })

  it('never checks a change to a stocked kind', async () => {
    h.state.moved = [{ partId: 'part_1' }]
    await expect(guardPartKindService(event('finished_good'))).resolves.toBeDefined()
  })

  it('refuses a part with stock movements, naming why', async () => {
    h.state.moved = [{ partId: 'part_1' }]
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
    h.state.built = [{ partId: 'part_1' }]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/it has builds/)
    h.state.moved = [{ partId: 'part_1' }]
    await expect(guardPartKindService(event('service'))).rejects.toThrow(/stock movements/)
  })
})
