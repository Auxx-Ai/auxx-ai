// packages/lib/src/field-hooks/__tests__/channel-cost-seed-registration.test.ts
//
// A connector write of `part_channel_cost` reaches the seed's batch core at sync finalize,
// through the REAL hook bootstrap (106 D5). `dispatch.test.ts` registers fakes; this one
// catches a registration under the wrong slug or without a `batch` core.

import { FieldType } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedCustomFields: vi.fn(),
  seedStandardFromChannelCost: vi.fn(),
}))

vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  findCachedResource: h.findCachedResource,
  getCachedCustomFields: h.getCachedCustomFields,
}))
vi.mock('../../inventory/costing/channel-cost-seed', () => ({
  seedStandardFromChannelCost: h.seedStandardFromChannelCost,
}))

import { dispatchFieldChanges } from '../dispatch'

const ORG = 'org_1'
const DEF = 'def_parts'
const DB = { tag: 'db' } as never

const FIELDS = [
  {
    id: 'fld_channel',
    systemAttribute: 'part_channel_cost',
    name: 'Channel cost',
    type: FieldType.CURRENCY,
  },
  { id: 'fld_title', systemAttribute: 'part_title', name: 'Title', type: FieldType.TEXT },
] as unknown as CustomFieldEntity[]

function sync(changes: { recordId: RecordId; outputKey: string }[], degraded: RecordId[] = []) {
  return dispatchFieldChanges({
    organizationId: ORG,
    userId: 'system',
    lane: 'sync',
    db: DB,
    changes,
    degraded,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findCachedResource.mockResolvedValue({
    entityDefinitionId: DEF,
    entityType: 'part',
    apiSlug: 'parts',
  })
  h.getCachedCustomFields.mockResolvedValue(FIELDS)
  h.seedStandardFromChannelCost.mockResolvedValue(ok({ writtenPartIds: [] }))
})

describe('channel cost seed on the sync lane', () => {
  it('hands every part whose channel cost the run wrote to the batch core in one call', async () => {
    const report = await sync([
      { recordId: `${DEF}:p1` as RecordId, outputKey: 'part_channel_cost' },
      { recordId: `${DEF}:p2` as RecordId, outputKey: 'part_title' },
      { recordId: `${DEF}:p3` as RecordId, outputKey: 'part_channel_cost' },
    ])

    expect(h.seedStandardFromChannelCost).toHaveBeenCalledTimes(1)
    expect(h.seedStandardFromChannelCost).toHaveBeenCalledWith(DB, ORG, ['p1', 'p3'])
    expect(report.handlers.seedStandardOnChannelCost?.fired).toBeGreaterThan(0)
  })

  it('seeds a record whose keys were shed under the byte budget', async () => {
    await sync([], [`${DEF}:p9` as RecordId])

    expect(h.seedStandardFromChannelCost).toHaveBeenCalledWith(DB, ORG, ['p9'])
  })

  it('does not run the seed when the run wrote no channel cost', async () => {
    await sync([{ recordId: `${DEF}:p2` as RecordId, outputKey: 'part_title' }])

    expect(h.seedStandardFromChannelCost).not.toHaveBeenCalled()
  })
})
