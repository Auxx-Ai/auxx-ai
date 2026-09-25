// packages/lib/src/data-migrations/migrations/__tests__/193-inventory-ledger-under-mrp.test.ts

import { type Database, schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateAndRecompute = vi.fn(async () => {})
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOrgCache: () => ({ invalidateAndRecompute }),
}))

// X4 (c): the count-fact fields go through the seeder's `ensureCustomFields`; the fake below
// creates whichever of the two the org lacks and records that it did.
const countFact = vi.hoisted(() => ({
  hasMovementDef: true,
  /** systemAttributes the org already has on `stock_movement`. */
  existingFields: new Set<string>(),
  ensured: [] as string[],
  /** `initial` rows the stamp finds without a fact. */
  unstamped: [] as Array<{
    id: string
    entityDefinitionId: string
    createdAt: Date
    quantity: number | null
    occurredAt: string | null
  }>,
  inserted: [] as Array<Record<string, unknown>>,
}))
vi.mock('../../../seed/entity-helpers', () => ({
  loadExistingState: async () => ({
    entityDefs: new Map(
      countFact.hasMovementDef
        ? [['stock_movement', { id: 'def_mv', entityType: 'stock_movement' }]]
        : []
    ),
    fields: new Map(),
  }),
  ensureCustomFields: async (
    _db: unknown,
    _org: string,
    _type: string,
    _defId: string,
    fields: Record<string, { systemAttribute: string }>,
    _existing: unknown,
    state: { fieldsCreated: number }
  ) => {
    for (const field of Object.values(fields)) {
      if (countFact.existingFields.has(field.systemAttribute)) continue
      countFact.existingFields.add(field.systemAttribute)
      countFact.ensured.push(field.systemAttribute)
      state.fieldsCreated++
    }
    return new Map()
  },
}))

const { countFactOf, migration193InventoryLedgerUnderMrp, withBackflushOption, withPendingOption } =
  await import('../193-inventory-ledger-under-mrp')
const { ALL_DATA_MIGRATIONS } = await import('../../registry')

const SEEDED = [
  { value: 'standard', label: 'Standard', color: 'blue' },
  { value: 'actual', label: 'Actual', color: 'green' },
]

const BUILD_SOURCES = [
  { value: 'manual', label: 'Manual', color: 'gray' },
  { value: 'order', label: 'Order', color: 'blue' },
  { value: 'batch', label: 'Batch', color: 'purple' },
]

type StoredField = { id: string; options: { options: typeof SEEDED; isCustom: boolean } } | null

/** One stored `stock_movement_cost_basis` field; `null` for an org without the def. */
let stored: StoredField
/** One stored `build_source` field; `null` for an org without the def. */
let storedBuildSource: StoredField
let fieldUpdates = 0

/** The two `CustomField` reads are told apart by the literal their `where` carries. */
const mentions = (where: unknown, literal: string) => JSON.stringify(where).includes(literal)
/** The org's work items by stage, as the fake update/delete see them. */
let workItems: Array<{ id: string; stage: string; sourceId: string }>
let workItemWrites: Array<{ op: 'update' | 'delete'; values?: Record<string, unknown> }>

/** The stamp's two reads: the field ids by systemAttribute, then the unstamped `initial` rows. */
function selectChain(table: unknown) {
  const link: Record<string, unknown> = {}
  for (const step of ['from', 'innerJoin', 'leftJoin']) link[step] = () => link
  link.where = async () => {
    if (table !== undefined) return countFact.unstamped
    return [...countFact.existingFields].map((systemAttribute) => ({
      id: `f_${systemAttribute}`,
      systemAttribute,
    }))
  }
  return link
}

function fakeDb(): Database {
  return {
    select: (columns: Record<string, unknown>) =>
      selectChain('entityDefinitionId' in columns ? 'rows' : undefined),
    insert: (table: unknown) => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        onConflictDoNothing: async () => {
          expect(table).toBe(schema.FieldValue)
          countFact.inserted.push(...rows)
        },
      }),
    }),
    query: {
      CustomField: {
        findFirst: async ({ where }: { where: unknown }) =>
          mentions(where, 'build_source') ? storedBuildSource : stored,
      },
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (...args: unknown[]) => {
          if (table === schema.CustomField) {
            fieldUpdates++
            if (mentions(args[0], 'f_source')) {
              if (storedBuildSource)
                storedBuildSource = { ...storedBuildSource, options: values.options as never }
            } else if (stored) stored = { ...stored, options: values.options as never }
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
  storedBuildSource = { id: 'f_source', options: { options: [...BUILD_SOURCES], isCustom: false } }
  fieldUpdates = 0
  workItems = []
  workItemWrites = []
  invalidateAndRecompute.mockClear()
  countFact.hasMovementDef = true
  countFact.existingFields = new Set([
    'stock_movement_type',
    'stock_movement_quantity',
    'stock_movement_occurred_at',
    'stock_movement_count_quantity',
    'stock_movement_count_date',
  ])
  countFact.ensured = []
  countFact.unstamped = []
  countFact.inserted = []
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

    const second = await runUp()
    expect(second.alreadyUpToDate).toBe(true)
    expect(second.steps.costBasisPendingAdded).toBe(false)
    expect(stored?.options.options.map((o) => o.value)).toEqual(['standard', 'actual', 'pending'])
  })

  it('skips an org without the cost basis field', async () => {
    stored = null
    storedBuildSource = null
    expect((await runUp()).steps.costBasisPendingAdded).toBe(false)
    expect(fieldUpdates).toBe(0)
  })
})

describe('withBackflushOption', () => {
  it('appends backflush after every stored option', () => {
    expect(withBackflushOption(BUILD_SOURCES)?.map((o) => o.value)).toEqual([
      'manual',
      'order',
      'batch',
      'backflush',
    ])
  })

  it('is a no-op once present, whatever the org relabelled it to', () => {
    expect(
      withBackflushOption([...BUILD_SOURCES, { value: 'backflush', label: 'Replay' }])
    ).toBeNull()
  })
})

describe('step: the backflush build source option (X5 d)', () => {
  it('adds the option once, then reports the step done', async () => {
    const first = await runUp()
    expect(first.steps.buildSourceBackflushAdded).toBe(true)
    expect(storedBuildSource?.options.options.map((o) => o.value)).toEqual([
      'manual',
      'order',
      'batch',
      'backflush',
    ])
    expect(storedBuildSource?.options.isCustom).toBe(false)
    // One `CustomField` write per step, and the cache bust follows each.
    expect(fieldUpdates).toBe(2)
    expect(invalidateAndRecompute).toHaveBeenCalledTimes(2)

    const second = await runUp()
    expect(second.alreadyUpToDate).toBe(true)
    expect(second.steps.buildSourceBackflushAdded).toBe(false)
    expect(fieldUpdates).toBe(2)
  })

  it('skips an org without the build source field, and leaves the cost basis step alone', async () => {
    storedBuildSource = null
    const result = await runUp()
    expect(result.steps.buildSourceBackflushAdded).toBe(false)
    expect(result.steps.costBasisPendingAdded).toBe(true)
    expect(fieldUpdates).toBe(1)
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

describe('step: the count fact on initial rows (X4 c, 111 Q26)', () => {
  it('ensures the two fields once, and reports them as created', async () => {
    countFact.existingFields = new Set(['stock_movement_type', 'stock_movement_quantity'])
    const first = await runUp()
    expect(countFact.ensured).toEqual([
      'stock_movement_count_quantity',
      'stock_movement_count_date',
    ])
    expect(first.steps.countFactFieldsCreated).toBe(2)
    expect(first.fieldsCreated).toBe(2)
    expect(first.alreadyUpToDate).toBe(false)

    const second = await runUp()
    expect(second.steps.countFactFieldsCreated).toBe(0)
    expect(countFact.ensured).toHaveLength(2)
  })

  it('stamps every unstamped initial with its own quantity and UTC day, once', async () => {
    countFact.unstamped = [
      {
        id: 'mv_1',
        entityDefinitionId: 'def_mv',
        createdAt: new Date('2026-02-02T10:00:00Z'),
        quantity: 10,
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'mv_2',
        entityDefinitionId: 'def_mv',
        createdAt: new Date('2026-02-02T10:00:00Z'),
        quantity: 4,
        occurredAt: null,
      },
    ]
    const first = await runUp()
    expect(first.steps.initialsStamped).toBe(2)
    expect(first.alreadyUpToDate).toBe(false)
    expect(countFact.inserted).toHaveLength(4)
    expect(countFact.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'mv_1',
          fieldId: 'f_stock_movement_count_quantity',
          valueNumber: 10,
        }),
        expect.objectContaining({
          entityId: 'mv_1',
          fieldId: 'f_stock_movement_count_date',
          valueDate: '2026-01-01T00:00:00.000Z',
        }),
        expect.objectContaining({
          entityId: 'mv_2',
          fieldId: 'f_stock_movement_count_quantity',
          valueNumber: 4,
        }),
        expect.objectContaining({
          entityId: 'mv_2',
          fieldId: 'f_stock_movement_count_date',
          valueDate: '2026-02-02T00:00:00.000Z',
        }),
      ])
    )

    // The stamp's read excludes stamped rows, so a second run finds none.
    countFact.unstamped = []
    const second = await runUp()
    expect(second.steps.initialsStamped).toBe(0)
    expect(second.alreadyUpToDate).toBe(true)
  })

  it('does nothing on an org without the stock_movement def or the count fields', async () => {
    countFact.hasMovementDef = false
    countFact.existingFields = new Set(['stock_movement_type', 'stock_movement_quantity'])
    countFact.unstamped = [
      {
        id: 'mv_1',
        entityDefinitionId: 'def_mv',
        createdAt: new Date(),
        quantity: 1,
        occurredAt: null,
      },
    ]
    const result = await runUp()
    expect(result.steps).toMatchObject({ countFactFieldsCreated: 0, initialsStamped: 0 })
    expect(countFact.inserted).toEqual([])
  })

  it('derives the fact from the row itself: its quantity, on the day it occurred or was created', () => {
    expect(
      countFactOf({
        quantity: 7,
        occurredAt: '2026-03-31T23:30:00.000Z',
        createdAt: new Date('2026-04-02T00:00:00Z'),
      })
    ).toEqual({ countQuantity: 7, countDate: '2026-03-31T00:00:00.000Z' })
    expect(
      countFactOf({ quantity: null, occurredAt: null, createdAt: new Date('2026-04-02T09:00:00Z') })
    ).toEqual({
      countQuantity: 0,
      countDate: '2026-04-02T00:00:00.000Z',
    })
  })
})
