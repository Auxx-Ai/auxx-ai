// packages/lib/src/money/fulfillment-posting/__tests__/run.test.ts
import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: [] as string[],
  works: [] as Array<Record<string, unknown>>,
  effects: [] as Array<{ workId: string; glPostingId: string }>,
  mode: 'auto',
  setup: 'finalized',
  enabled: true,
  blocked: false,
  accept: vi.fn(),
  prepare: vi.fn(),
  capture: vi.fn(),
  intent: vi.fn(),
  plan: vi.fn(),
  deliver: vi.fn(),
  enqueue: vi.fn(),
}))
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: async () => h.enabled,
}))
vi.mock('../../../postings/accounting-commit-lock', () => ({
  withAccountingCommitLock: async () => {
    h.events.push('lock')
  },
}))
vi.mock('../../../postings/accept-entry', () => ({ acceptEntryInTx: h.accept }))
vi.mock('../../../postings/book-connections', () => ({
  resolveFulfillmentDeliveryIntentInTx: h.intent,
}))
vi.mock('../../../postings/delivery', () => ({
  planAccountingDeliveryInTx: h.plan,
  deliverAccountingPosting: h.deliver,
  enqueueAccountingDelivery: h.enqueue,
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'system' }) }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) =>
    key === 'accounting.fulfillmentPosting' ? h.mode : h.setup,
}))
vi.mock('../reads', () => ({
  readFulfillmentPostingSettings: async () =>
    ok({ timeZone: 'UTC', cutoffPeriod: null, lockedThroughMonth: null, ledgerCurrency: 'USD' }),
  readUnpostedShipments: async () => ok([]),
}))
vi.mock('../plan', () => ({
  loadGatewayRoutesForPlan: async () => [],
  planFulfillmentPosting: () => ({ groups: [], exclusions: [], footer: { shipments: 0 } }),
}))
vi.mock('../acceptance-context', () => ({
  resolveFulfillmentAcceptanceContext: async (_tx: unknown, organizationId: string) => ({
    organizationId,
    fields: {},
    orderFields: {},
    ownershipFieldId: 'f_line_item_order',
    settings: {
      timeZone: 'UTC',
      cutoffPeriod: null,
      lockedThroughMonth: null,
      ledgerCurrency: 'USD',
    },
    setupState: h.setup,
    gatewayRoutes: [],
    sources: new Map(),
    shipments: new Map(),
    shipDays: new Map(),
    prefetched: new Set(),
  }),
  prefetchGroupSources: async () => {},
}))
vi.mock('../work', () => ({
  captureFulfillmentAccountingWorkInTx: h.capture,
  prepareFulfillmentEffectMemberInTx: h.prepare,
  revalidateFulfillmentMemberInTx: vi.fn(),
  discoverFulfillmentAccountingWork: vi.fn(),
}))

import { acceptFulfillmentWorkGroup, runFulfillmentPosting } from '../run'

function db(): Database {
  const tx = {
    query: {
      AccountingWork: { findMany: async () => h.works },
      AccountingEffect: { findMany: async () => h.effects },
      GlPosting: { findFirst: async () => ({ id: 'journal', docNumber: 'AUXX-FUL-fg_123' }) },
    },
  }
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.events.push('begin')
      try {
        const result = await fn(tx)
        h.events.push('commit')
        return result
      } catch (error) {
        h.events.push('rollback')
        throw error
      }
    },
  } as unknown as Database
}
const input = {
  organizationId: 'org',
  actorUserId: 'user',
  fulfillmentIds: ['f1', 'f2'],
  groupKey: '2026-09',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.events = []
  h.effects = []
  h.mode = 'auto'
  h.setup = 'finalized'
  h.enabled = true
  h.blocked = false
  h.works = ['f1', 'f2'].map((id) => ({
    id: `w_${id}`,
    entityInstanceId: id,
    state: 'pending',
    eligibility: 'automatic',
  }))
  h.capture.mockImplementation(async (_tx, args) => {
    h.events.push('capture')
    return {
      id: `w_${args.fulfillmentInstanceId}`,
      state: h.blocked ? 'blocked' : 'pending',
      blockedReason: 'Unresolved source',
    }
  })
  h.prepare.mockImplementation(async (_tx, _org, workId: string) => ({
    member: { workId, expectedBasisVersion: 1, acceptedBasis: {} },
    shipment: {
      fulfillmentInstanceId: workId.slice(2),
      orderId: 'order',
      orderNumber: 'O1',
      sequence: 1,
      shippedAt: workId.endsWith('1') ? '2026-09-01' : '2026-09-12',
      amounts: { totalMinor: 100 },
    },
    entry: {
      postingType: 'fulfillment',
      txnDate: workId.endsWith('1') ? '2026-09-01' : '2026-09-12',
      lines: [
        { accountRole: 'clearing_card', direction: 'debit', amount: 100 },
        { accountRole: 'revenue_product', direction: 'credit', amount: 100 },
      ],
      totalDebit: 100,
      totalCredit: 100,
    },
  }))
  h.intent.mockResolvedValue({ kind: 'automatic', connectionId: 'connection' })
  h.accept.mockImplementation(async () => {
    h.events.push('accept')
    return { status: 'accepted', glPostingId: 'journal' }
  })
  h.plan.mockImplementation(async () => {
    h.events.push('plan')
  })
  h.deliver.mockImplementation(async () => {
    h.events.push('deliver')
  })
  h.enqueue.mockImplementation(async () => {
    h.events.push('enqueue')
  })
})

describe('atomic fulfillment command', () => {
  it('commits durable source capture before acceptance and plans delivery before its commit', async () => {
    const result = await acceptFulfillmentWorkGroup(db(), input)
    expect(result).toMatchObject({ status: 'accepted', shipments: 2 })
    const acceptedAt = h.events.indexOf('accept')
    const beforeAccept = h.events.slice(0, acceptedAt)
    // 🛑 The contract is the ORDERING, not the transaction count: the capture
    // pass commits before the acceptance opens, so a bookkeeping refusal cannot
    // take the source evidence down with it. It is one transaction for the whole
    // group now, so assert what actually matters - every shipment captured, and
    // that capture committed, before acceptance started.
    expect(beforeAccept.filter((event) => event === 'commit')).toHaveLength(1)
    const captureCommit = beforeAccept.indexOf('commit')
    expect(beforeAccept.slice(0, captureCommit).filter((e) => e === 'capture')).toHaveLength(2)
    // The export is ENQUEUED after the commit, never sent inside the request.
    expect(h.events.slice(acceptedAt)).toEqual(['accept', 'plan', 'commit', 'enqueue'])
    expect(h.deliver).not.toHaveBeenCalled()
  })
  it('aggregates exactly the pending members and dates a monthly journal to their latest shipment', async () => {
    await acceptFulfillmentWorkGroup(db(), input)
    const call = h.accept.mock.calls[0]![1]
    expect(call.members.map((member: { workId: string }) => member.workId)).toEqual([
      'w_f1',
      'w_f2',
    ])
    expect(call.entry).toMatchObject({ txnDate: '2026-09-12', totalDebit: 200, totalCredit: 200 })
    expect(call.entry.lines).toHaveLength(2)
    expect(call.entry.sources).toHaveLength(2)
  })
  it('removes accepted overlap before rebuilding totals', async () => {
    h.effects = [{ workId: 'w_f1', glPostingId: 'older' }]
    await acceptFulfillmentWorkGroup(db(), input)
    const call = h.accept.mock.calls[0]![1]
    expect(call.members).toHaveLength(1)
    expect(call.members[0].workId).toBe('w_f2')
    expect(call.entry.totalDebit).toBe(100)
  })
  it('hands the accepted journal to the delivery queue rather than exporting it in the request', async () => {
    await acceptFulfillmentWorkGroup(db(), input)
    // 🛑 An export is 3-5 sequential Lambda round trips to QuickBooks and a bulk
    // run makes one per GROUP. It must leave through the queue, never inline.
    expect(h.enqueue).toHaveBeenCalledWith({ organizationId: 'org', glPostingId: 'journal' })
    expect(h.deliver).not.toHaveBeenCalled()
  })
  it('rechecks automatic eligibility inside the commit transaction', async () => {
    h.mode = 'manual'
    expect(await acceptFulfillmentWorkGroup(db(), { ...input, automatic: true })).toEqual({
      status: 'disabled',
    })
    expect(h.accept).not.toHaveBeenCalled()
    expect(h.capture).toHaveBeenCalledTimes(2)
  })
  it('manual execution can accept manual work', async () => {
    h.mode = 'manual'
    h.works.forEach((work) => {
      work.eligibility = 'manual'
    })
    await acceptFulfillmentWorkGroup(db(), input)
    expect(h.accept).toHaveBeenCalledOnce()
  })
  it('does not accept excluded work', async () => {
    h.works.forEach((work) => {
      work.eligibility = 'excluded'
    })
    expect(await acceptFulfillmentWorkGroup(db(), input)).toEqual({ status: 'not_eligible' })
    expect(h.accept).not.toHaveBeenCalled()
  })
  // 🛑 Two groups write nothing for opposite reasons, and the dialog used to
  // call both "already posted". Deleting a month's journals leaves work nothing
  // claims; reporting that as posted hid an empty January behind a reassurance.
  it('separates a group whose journal exists from one whose work nothing claims', async () => {
    h.works.forEach((work) => {
      work.state = 'canceled'
    })
    expect(await acceptFulfillmentWorkGroup(db(), input)).toEqual({ status: 'not_eligible' })
    h.effects = [
      { workId: 'w_f1', glPostingId: 'journal' },
      { workId: 'w_f2', glPostingId: 'journal' },
    ]
    expect(await acceptFulfillmentWorkGroup(db(), input)).toEqual({ status: 'already_posted' })
    expect(h.accept).not.toHaveBeenCalled()
  })
  it('retains committed capture when accounting configuration refuses', async () => {
    h.intent.mockRejectedValueOnce(new Error('Unbridged QuickBooks company'))
    await expect(acceptFulfillmentWorkGroup(db(), input)).rejects.toThrow('Unbridged')
    // The capture pass committed and STAYS committed; only the acceptance rolls
    // back. That is the whole reason capture is a separate transaction.
    expect(h.events.filter((event) => event === 'commit')).toHaveLength(1)
    expect(h.events.indexOf('commit')).toBeLessThan(h.events.indexOf('rollback'))
    expect(h.events.at(-1)).toBe('rollback')
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('does not create a delivery when source sealing remains blocked', async () => {
    h.blocked = true
    await expect(acceptFulfillmentWorkGroup(db(), input)).rejects.toThrow('Unresolved source')
    expect(h.accept).not.toHaveBeenCalled()
    expect(h.plan).not.toHaveBeenCalled()
  })
  it('rolls acceptance back when its delivery plan cannot be persisted', async () => {
    h.plan.mockRejectedValueOnce(new Error('write failed'))
    await expect(acceptFulfillmentWorkGroup(db(), input)).rejects.toThrow('write failed')
    expect(h.events.at(-1)).toBe('rollback')
    expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('does not write accounting when the organization disabled it', async () => {
    h.enabled = false
    expect(
      await runFulfillmentPosting(db(), {
        organizationId: 'org',
        actorUserId: 'user',
        range: { from: '2026-09-01', to: '2026-10-01' },
        grouping: 'month',
      })
    ).toEqual({ posted: [], skipped: [], failed: [], exclusions: [] })
    expect(h.capture).not.toHaveBeenCalled()
  })
  it('does not execute a queued automatic run after switching to manual', async () => {
    h.mode = 'manual'
    await runFulfillmentPosting(db(), {
      organizationId: 'org',
      actorUserId: null,
      range: { from: '2026-09-01', to: '2026-10-01' },
      grouping: 'month',
    })
    expect(h.capture).not.toHaveBeenCalled()
  })
  it('returns the accepted journal after the commit, with the export still only queued', async () => {
    const result = await acceptFulfillmentWorkGroup(db(), input)
    expect(result).toMatchObject({ status: 'accepted', glPostingId: 'journal' })
    // The acceptance is durable at the commit; the export is a later, separate
    // concern. `enqueueAccountingDelivery` swallows its own queue failures (and
    // `sweepAccountingDeliveries` is the backstop), so a wakeup that never
    // arrives cannot cost us the journal.
    expect(h.events.indexOf('commit')).toBeLessThan(h.events.indexOf('enqueue'))
    expect(h.deliver).not.toHaveBeenCalled()
  })
})
