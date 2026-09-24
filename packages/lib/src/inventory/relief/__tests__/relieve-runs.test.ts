// packages/lib/src/inventory/relief/__tests__/relieve-runs.test.ts

/**
 * Two relief runs over one fulfillment, through the real posting door and entry builder. The
 * ledger is a fake that enforces the two unique keys the real one does - the subject claim and
 * `GlPosting_org_docNumber_key` - so a second run that reused the first run's identity would fail
 * here exactly as it did on DemoOrg1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakePosting {
  id: string
  docNumber: string
  subject: string
  sources: Array<{ sourceKind: string; sourceId: string; linkRole: string; occurrence?: string }>
  lines: Array<{ accountRole: string; direction: string; amount: number; sourceId: string }>
}

const h = vi.hoisted(() => ({
  standardCosts: new Map<string, number>(),
  /** The fake subledger: every `sale` movement written, by fulfillment line. */
  movements: [] as Array<{ id: string; fulfillmentLineId: string; quantity: number }>,
  postings: [] as FakePosting[],
  recalc: vi.fn(async () => {}),
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((attr) => [attr, { id: `f_${attr}` }])),
    }),
  }),
  requireCachedEntityDefId: async (_orgId: string, entityType: string) => `def_${entityType}`,
}))
vi.mock('../../costing', () => ({
  readStandardCost: async (_db: unknown, _orgId: string, partIds: string[]) => {
    const { ok } = await import('neverthrow')
    const map = new Map<string, Record<string, number | null>>()
    for (const id of partIds) {
      const cost = h.standardCosts.get(id)
      if (cost != null)
        map.set(id, { standardCost: cost, standardLaborCost: null, standardOverheadCost: null })
    }
    return ok(map)
  },
}))
vi.mock('../../costing/qoh', () => ({ batchRecalculateQoH: async () => {} }))
vi.mock('../../costing/cost-reads', () => ({
  readPartLedgerAverages: async () => (await import('neverthrow')).ok(new Map()),
  readFulfillmentLineRelievedAverages: async () => (await import('neverthrow')).ok(new Map()),
}))
vi.mock('../../../field-hooks/post/fulfillment-line-rollups', () => ({
  recalculateFulfillmentLineQuantityRelievedBatch: h.recalc,
  readRelievedQuantities: async () => {
    const totals = new Map<string, number>()
    for (const movement of h.movements)
      totals.set(
        movement.fulfillmentLineId,
        (totals.get(movement.fulfillmentLineId) ?? 0) - movement.quantity
      )
    return totals
  },
}))
vi.mock('../write-lane', () => ({
  reliefWriteSession: () => ({ origin: { kind: 'automation' }, mode: { kind: 'quiet' } }),
  announceQuietReliefWrites: () => {},
}))
vi.mock('../../../accounting/work-items/write', () => ({
  upsertWorkItem: async () => ({ isOk: () => true }),
  deleteWorkItemsAtStage: async () => ({ isOk: () => true }),
}))
vi.mock('../../movements', async () => {
  const actual = await vi.importActual<typeof import('../../movements')>('../../movements')
  const { ok } = await import('neverthrow')
  return {
    ...actual,
    writeStockMovements: async (
      _ctx: unknown,
      inputs: Array<{
        partInstanceId: string
        quantity: number
        unitCost: number
        glAccount: string
        occurredAt: Date
        links: { fulfillmentLineId: string }
      }>
    ) => {
      const records = inputs.map((input) => {
        const id = `mv_${h.movements.length}`
        h.movements.push({
          id,
          fulfillmentLineId: input.links.fulfillmentLineId,
          quantity: input.quantity,
        })
        return {
          movementId: id,
          recordId: `def_stock_movement:${id}`,
          partInstanceId: input.partInstanceId,
          quantity: input.quantity,
          unitCost: input.unitCost,
          extendedCost: input.quantity * input.unitCost,
          glAccount: input.glAccount,
          occurredAt: input.occurredAt,
        }
      })
      return ok({ records, affectedPartIds: [...new Set(inputs.map((i) => i.partInstanceId))] })
    },
  }
})

// The ledger side of the posting door.
vi.mock('../../../accounting/ledger/post/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {},
}))
vi.mock('../../../accounting/ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => true,
}))
vi.mock('../../../accounting/ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThrough: null }),
}))
vi.mock('../../../accounting/ledger/reads/read-posting', () => ({
  readPostingLineSourceIds: async () => (await import('neverthrow')).ok([]),
}))
vi.mock('../../../accounting/ledger/post/post-entry', async () => {
  const { buildDocNumber } = await vi.importActual<
    typeof import('../../../accounting/ledger/builders/doc-number')
  >('../../../accounting/ledger/builders/doc-number')
  return {
    exportPostedEntry: async () => null,
    postEntryInTx: async (
      _tx: unknown,
      options: {
        entry: {
          postingType: 'inventory_movement'
          periodKey: string
          lines: FakePosting['lines']
        }
        sources: FakePosting['sources']
      }
    ) => {
      const subject = options.sources.find((source) => source.linkRole === 'subject')!
      const key = `${subject.sourceKind}:${subject.sourceId}:${subject.occurrence ?? 'original'}`
      const held = h.postings.find((posting) => posting.subject === key)
      if (held) return { status: 'already_posted', glPostingId: held.id, docNumber: held.docNumber }
      const docNumber = buildDocNumber({
        postingType: options.entry.postingType,
        periodKey: options.entry.periodKey,
      })
      if (h.postings.some((posting) => posting.docNumber === docNumber))
        throw new Error(`Document number ${docNumber} is already used by a different posting`)
      const id = `gp_${h.postings.length}`
      h.postings.push({
        id,
        docNumber,
        subject: key,
        sources: options.sources,
        lines: options.entry.lines,
      })
      return { status: 'posted', glPostingId: id, docNumber }
    },
  }
})

import type { Database } from '@auxx/database'
import { relieveFulfillmentLines } from '../relieve'

const ORG = 'org_1'
const SHIPPED_AT = new Date('2026-09-03T12:00:00.000Z')

/** `readLineItemParts` then `readPartKindsLocal`, alternating across runs. */
function fakeDb(): Database {
  let call = 0
  const parts = [
    { entityId: 'li_1', relatedEntityId: 'part_1' },
    { entityId: 'li_2', relatedEntityId: 'part_2' },
  ]
  const kinds = [
    { entityId: 'part_1', optionId: 'finished_good' },
    { entityId: 'part_2', optionId: 'finished_good' },
  ]
  return {
    select: () => ({ from: () => ({ where: async () => (call++ % 2 === 0 ? parts : kinds) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as Database
}

/** The two lines of one dispatch, with the roll-up as the subledger currently stands. */
function dispatch() {
  const relieved = (lineId: string) =>
    -h.movements
      .filter((movement) => movement.fulfillmentLineId === lineId)
      .reduce((sum, movement) => sum + movement.quantity, 0) || null
  return [
    { id: 'fl_1', lineItemId: 'li_1', quantity: 2 },
    { id: 'fl_2', lineItemId: 'li_2', quantity: 3 },
  ].map((line) => ({
    fulfillmentLineId: line.id,
    fulfillmentId: 'ful_1',
    orderId: 'ord_1',
    lineItemId: line.lineItemId,
    quantity: line.quantity,
    quantityRelieved: relieved(line.id),
    occurredAt: SHIPPED_AT,
  }))
}

function relieve() {
  return relieveFulfillmentLines(fakeDb(), {
    organizationId: ORG,
    userId: 'u_1',
    lines: dispatch(),
  })
}

function debits(posting: FakePosting, role: string): number {
  return posting.lines
    .filter((line) => line.accountRole === role && line.direction === 'debit')
    .reduce((sum, line) => sum + line.amount, 0)
}

beforeEach(() => {
  h.standardCosts = new Map([['part_1', 1_000]])
  h.movements = []
  h.postings = []
  h.recalc.mockClear()
})

describe('a dispatch relieved in two runs', () => {
  it('posts one entry per run, each under its own identity, both parented by the fulfillment', async () => {
    const first = await relieve()
    expect(first._unsafeUnwrap()).toMatchObject({ skippedNoCost: 1, movementIds: ['mv_0'] })

    h.standardCosts.set('part_2', 2_000)
    const second = await relieve()
    expect(second._unsafeUnwrap()).toMatchObject({ skippedNoCost: 0, movementIds: ['mv_1'] })

    expect(h.postings).toHaveLength(2)
    const [a, b] = h.postings as [FakePosting, FakePosting]
    expect(a.docNumber).not.toBe(b.docNumber)
    expect(a.subject).toBe('stock_movement:mv_0:original')
    expect(b.subject).toBe('stock_movement:mv_1:original')
    for (const posting of [a, b]) {
      expect(posting.sources).toEqual(
        expect.arrayContaining([
          { sourceKind: 'fulfillment', sourceId: 'ful_1', linkRole: 'parent' },
          { sourceKind: 'order', sourceId: 'ord_1', linkRole: 'parent' },
        ])
      )
      // Every line names a real movement, not the fulfillment.
      expect(new Set(posting.lines.map((line) => line.sourceId))).toEqual(
        new Set([posting.subject.split(':')[1]])
      )
    }
    expect(debits(a, 'cogs_product_cost')).toBe(2 * 1_000)
    expect(debits(b, 'cogs_product_cost')).toBe(3 * 2_000)
  })

  it('every run that wrote movements owns a posting of its own', async () => {
    h.standardCosts.set('part_2', 2_000)
    for (let run = 0; run < 3; run++) await relieve()

    // Run one relieved everything; the next two found nothing owed and wrote nothing.
    expect(h.movements).toHaveLength(2)
    expect(h.postings).toHaveLength(1)
    const members = h.postings.flatMap((posting) =>
      posting.sources.filter((source) => source.linkRole === 'member').map((s) => s.sourceId)
    )
    expect(members.sort()).toEqual(h.movements.map((movement) => movement.id).sort())
  })

  it('refuses a retry that read the roll-up before the last run landed', async () => {
    const stale = dispatch()
    await relieve()

    const retry = await relieveFulfillmentLines(fakeDb(), {
      organizationId: ORG,
      userId: 'u_1',
      lines: stale,
    })

    expect(retry.isErr()).toBe(true)
    expect(h.movements).toHaveLength(1)
    expect(h.postings).toHaveLength(1)
    expect(h.recalc).toHaveBeenCalledWith(ORG, ['fl_1'])
  })
})
