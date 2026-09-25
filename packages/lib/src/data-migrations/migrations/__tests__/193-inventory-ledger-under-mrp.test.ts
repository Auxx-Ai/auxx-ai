// packages/lib/src/data-migrations/migrations/__tests__/193-inventory-ledger-under-mrp.test.ts

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

const { migration193InventoryLedgerUnderMrp, withPendingOption } = await import(
  '../193-inventory-ledger-under-mrp'
)
const { ALL_DATA_MIGRATIONS } = await import('../../registry')

const SEEDED = [
  { value: 'standard', label: 'Standard', color: 'blue' },
  { value: 'actual', label: 'Actual', color: 'green' },
]

/** One stored `stock_movement_cost_basis` field; `null` for an org without the def. */
let stored: { id: string; options: { options: typeof SEEDED; isCustom: boolean } } | null
let fieldUpdates = 0
/** The org's work items by stage, as the fake update/delete see them. */
let workItems: Array<{ id: string; stage: string; sourceId: string }>
let workItemWrites: Array<{ op: 'update' | 'delete'; values?: Record<string, unknown> }>

function fakeDb(): Database {
  return {
    query: { CustomField: { findFirst: async () => stored } },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (..._args: unknown[]) => {
          if (table === schema.CustomField) {
            fieldUpdates++
            if (stored) stored = { ...stored, options: values.options as never }
            return Promise.resolve()
          }
          expect(table).toBe(schema.AccountingWorkItem)
          workItemWrites.push({ op: 'update', values })
          // Rows at `relieve` whose source holds no `price` row move; the rest stay for the delete.
          const priced = new Set(
            workItems.filter((w) => w.stage === 'price').map((w) => w.sourceId)
          )
          const moved = workItems.filter((w) => w.stage === 'relieve' && !priced.has(w.sourceId))
          for (const row of moved) row.stage = String(values.stage)
          return { returning: async () => moved.map(({ id }) => ({ id })) }
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        expect(table).toBe(schema.AccountingWorkItem)
        workItemWrites.push({ op: 'delete' })
        const dropped = workItems.filter((w) => w.stage === 'relieve')
        workItems = workItems.filter((w) => w.stage !== 'relieve')
        return { returning: async () => dropped.map(({ id }) => ({ id })) }
      },
    }),
  } as unknown as Database
}

beforeEach(() => {
  stored = { id: 'f_basis', options: { options: [...SEEDED], isCustom: false } }
  fieldUpdates = 0
  workItems = []
  workItemWrites = []
  invalidateAndRecompute.mockClear()
})

const runUp = () => migration193InventoryLedgerUnderMrp.up(fakeDb(), 'org_1')

describe('the registry', () => {
  it('is registered once, as the one 111 per-org migration', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('193-'))).toEqual(['193-inventory-ledger-under-mrp'])
  })
})

describe('withPendingOption', () => {
  it('appends pending after every stored option, including an org-added one', () => {
    const custom = { value: 'landed', label: 'Landed', color: 'teal' }
    expect(withPendingOption([...SEEDED, custom])?.map((o) => o.value)).toEqual([
      'standard',
      'actual',
      'landed',
      'pending',
    ])
  })

  it('writes the value the movement writers stamp', () => {
    expect(withPendingOption(SEEDED)?.at(-1)).toMatchObject({ value: 'pending', label: 'Pending' })
  })

  it('is a no-op once present, whatever the org relabelled it to', () => {
    expect(withPendingOption([...SEEDED, { value: 'pending', label: 'Awaiting cost' }])).toBeNull()
  })
})

describe('step: the pending cost basis option', () => {
  it('adds the option once, then reports the step done', async () => {
    const first = await runUp()
    expect(first.alreadyUpToDate).toBe(false)
    expect(first.steps.costBasisPendingAdded).toBe(true)
    expect(stored?.options.options.map((o) => o.value)).toEqual(['standard', 'actual', 'pending'])
    expect(stored?.options.isCustom).toBe(false)
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(1)

    const second = await runUp()
    expect(second.alreadyUpToDate).toBe(true)
    expect(second.steps.costBasisPendingAdded).toBe(false)
    expect(fieldUpdates).toBe(1)
  })

  it('skips an org without the cost basis field', async () => {
    stored = null
    expect((await runUp()).steps.costBasisPendingAdded).toBe(false)
    expect(fieldUpdates).toBe(0)
  })
})

describe('step: relieve work items re-staged to price', () => {
  beforeEach(() => {
    stored = {
      ...stored!,
      options: {
        ...stored!.options,
        options: [...SEEDED, { value: 'pending', label: 'Pending', color: 'amber' }],
      },
    }
  })

  it('moves every relieve row to price and makes it due now', async () => {
    workItems = [
      { id: 'wi_1', stage: 'relieve', sourceId: 'ful_1' },
      { id: 'wi_2', stage: 'relieve', sourceId: 'ful_2' },
      { id: 'wi_3', stage: 'post', sourceId: 'ful_3' },
    ]
    const result = await runUp()
    expect(result.steps).toMatchObject({ workItemsRestaged: 2, workItemsSuperseded: 0 })
    expect(result.alreadyUpToDate).toBe(false)
    expect(workItems.map((w) => w.stage)).toEqual(['price', 'price', 'post'])
    const update = workItemWrites.find((w) => w.op === 'update')
    expect(update?.values).toMatchObject({ stage: 'price' })
    expect(update?.values?.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('drops a relieve row whose source already holds a price row, instead of colliding', async () => {
    workItems = [
      { id: 'wi_1', stage: 'relieve', sourceId: 'ful_1' },
      { id: 'wi_9', stage: 'price', sourceId: 'ful_1' },
    ]
    const result = await runUp()
    expect(result.steps).toMatchObject({ workItemsRestaged: 0, workItemsSuperseded: 1 })
    expect(workItems).toEqual([{ id: 'wi_9', stage: 'price', sourceId: 'ful_1' }])
  })

  it('is idempotent: a second run finds nothing to move', async () => {
    workItems = [{ id: 'wi_1', stage: 'relieve', sourceId: 'ful_1' }]
    await runUp()
    const again = await runUp()
    expect(again.steps).toMatchObject({ workItemsRestaged: 0, workItemsSuperseded: 0 })
    expect(again.alreadyUpToDate).toBe(true)
    expect(workItemWrites.map((w) => w.op)).toEqual(['update', 'delete', 'update', 'delete'])
  })
})
