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
})

describe('atomic fulfillment command', () => {
  it('commits durable source capture before acceptance and plans delivery before its commit', async () => {
    const result = await acceptFulfillmentWorkGroup(db(), input)
    expect(result?.shipments).toBe(2)
    const acceptedAt = h.events.indexOf('accept')
    expect(h.events.slice(0, acceptedAt).filter((event) => event === 'commit')).toHaveLength(2)
    expect(h.events.slice(acceptedAt)).toEqual(['accept', 'plan', 'commit', 'deliver'])
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
  it('does not release a manual external delivery just because a person posted the fulfillment', async () => {
    await acceptFulfillmentWorkGroup(db(), input)
    expect(h.deliver).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org',
      glPostingId: 'journal',
    })
  })
  it('rechecks automatic eligibility inside the commit transaction', async () => {
    h.mode = 'manual'
    expect(await acceptFulfillmentWorkGroup(db(), { ...input, automatic: true })).toBeNull()
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
    expect(await acceptFulfillmentWorkGroup(db(), input)).toBeNull()
    expect(h.accept).not.toHaveBeenCalled()
  })
  it('retains committed capture when accounting configuration refuses', async () => {
    h.intent.mockRejectedValueOnce(new Error('Unbridged QuickBooks company'))
    await expect(acceptFulfillmentWorkGroup(db(), input)).rejects.toThrow('Unbridged')
    expect(h.events.filter((event) => event === 'commit')).toHaveLength(2)
    expect(h.events.at(-1)).toBe('rollback')
    expect(h.deliver).not.toHaveBeenCalled()
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
    expect(h.deliver).not.toHaveBeenCalled()
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
  it('preserves accepted local results when the delivery wakeup fails after commit', async () => {
    h.deliver.mockRejectedValueOnce(new Error('connection unavailable'))
    const result = await acceptFulfillmentWorkGroup(db(), input)
    expect(result?.glPostingId).toBe('journal')
    expect(h.events.at(-1)).toBe('commit')
  })
})
