// packages/lib/src/data-migrations/migrations/__tests__/188-credit-memo-money-pending.test.ts
//
// One INSERT-only field: registered once, a skip for an org without the def, the
// field caches dropped when it is created, and a re-run creates nothing.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

/** Entity types the stubbed `loadExistingState` reports the org as holding. */
let existingDefs: string[] = ['credit_memo']

/** System attributes the org already carries - `ensureCustomFields` is INSERT-only. */
let existingAttributes: Set<string> = new Set()

const ensureCalls: string[][] = []

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
    _entityType: string,
    _defId: string,
    fields: Record<string, { systemAttribute?: string }>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    const attributes = Object.values(fields).map((f) => f.systemAttribute ?? '')
    ensureCalls.push(attributes)
    for (const attribute of attributes) {
      if (existingAttributes.has(attribute)) continue
      existingAttributes.add(attribute)
      state.fieldsCreated++
    }
    return new Map()
  },
}))

const { migration188CreditMemoMoneyPending } = await import('../188-credit-memo-money-pending')
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')
const { CREDIT_MEMO_FIELDS } = await import(
  '../../../resources/registry/resources/credit-memo-fields'
)

const MIGRATION_ID = '188-credit-memo-money-pending'
const ORG = 'org_1'
const DB = {} as Database

const runUp = () => migration188CreditMemoMoneyPending.up(DB, ORG)

beforeEach(() => {
  existingDefs = ['credit_memo']
  existingAttributes = new Set()
  ensureCalls.length = 0
  invalidateAndRecompute.mockClear()
})

describe('migration 188 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration188CreditMemoMoneyPending.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 188, and sorts after 187', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.map((id) => id.split('-')[0]).filter((n) => n === '188')).toHaveLength(1)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('187-journal-entry-line'))
  })
})

describe('the field is in the registry (101 E9)', () => {
  it('resolves on the credit memo under the attribute every reader asks for', () => {
    expect(CREDIT_MEMO_FIELDS.moneyPending?.systemAttribute).toBe('credit_memo_money_pending')
  })
})

describe('migration 188 up()', () => {
  it('creates the field once and drops the caches that serve it', async () => {
    const result = await runUp()

    expect(ensureCalls).toEqual([['credit_memo_money_pending']])
    expect(result.fieldsCreated).toBe(1)
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

  it('is a no-op for an org short of the credit_memo def', async () => {
    existingDefs = []

    const result = await runUp()

    expect(result.alreadyUpToDate).toBe(true)
    expect(ensureCalls).toEqual([])
    expect(invalidateAndRecompute).not.toHaveBeenCalled()
  })
})
