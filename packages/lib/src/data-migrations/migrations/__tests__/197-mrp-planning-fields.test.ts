// packages/lib/src/data-migrations/migrations/__tests__/197-mrp-planning-fields.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['part', 'company']

/** System attributes the org already carries - `ensureCustomFields` is INSERT-only. */
let existingAttributes: Set<string> = new Set()

const ensureCalls: { entityType: string; attributes: string[] }[] = []

vi.mock('../../../seed/entity-helpers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadExistingState: async () => ({
    entityDefs: new Map(
      existingDefs.map((type) => [type, { id: `def_${type}`, entityType: type }])
    ),
    fields: new Map(),
  }),
  ensureCustomFields: async (
    _db: unknown,
    _organizationId: string,
    entityType: string,
    _defId: string,
    fields: Record<string, { systemAttribute?: string }>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const attributes = Object.values(fields).map((f) => f.systemAttribute ?? '')
    ensureCalls.push({ entityType, attributes })
    for (const attribute of attributes) {
      if (existingAttributes.has(attribute)) continue
      existingAttributes.add(attribute)
      state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration197MrpPlanningFields } = await import('../197-mrp-planning-fields')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')

const MIGRATION_ID = '197-mrp-planning-fields'
const ORG = 'org_1'
const DB = {} as Database

const PART_ATTRIBUTES = [
  'part_mrp_buffer_mode',
  'part_build_lead_time_days',
  'part_build_cycle_days',
  'part_mrp_lead_time_factor',
  'part_mrp_variability_factor',
]
const COMPANY_ATTRIBUTES = [
  'company_order_mode',
  'company_order_cycle_days',
  'company_next_order_date',
]

const runUp = () => migration197MrpPlanningFields.up(DB, ORG)

beforeEach(() => {
  existingDefs = ['part', 'company']
  existingAttributes = new Set()
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
})

describe('migration 197 registration', () => {
  it('is registered exactly once under its own number', () => {
    expect(PER_ORG_MIGRATIONS.filter((m) => m.id === MIGRATION_ID)).toHaveLength(1)
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.map((id) => id.split('-')[0]).filter((n) => n === '197')).toHaveLength(1)
  })
})

describe('migration 197 up()', () => {
  it('creates the part and company fields once and drops the caches that serve them', async () => {
    const result = await runUp()

    expect(ensureCalls).toEqual([
      { entityType: 'part', attributes: PART_ATTRIBUTES },
      { entityType: 'company', attributes: COMPANY_ATTRIBUTES },
    ])
    expect(result.fieldsCreated).toBe(8)
    expect(result.alreadyUpToDate).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledWith(ORG, ['customFields', 'resources'])
  })

  it('is idempotent: a re-run creates nothing and drops no cache', async () => {
    await runUp()
    invalidateAndRecompute.mockClear()

    const again = await runUp()

    expect(again.fieldsCreated).toBe(0)
    expect(again.alreadyUpToDate).toBe(true)
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })

  it('skips a def the org does not have', async () => {
    existingDefs = ['company']

    const result = await runUp()

    expect(ensureCalls).toEqual([{ entityType: 'company', attributes: COMPANY_ATTRIBUTES }])
    expect(result.fieldsCreated).toBe(3)
  })
})
