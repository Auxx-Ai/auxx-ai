// packages/lib/src/money/credit-memo-posting/__tests__/run.test.ts
//
// The four properties the run exists to hold:
//
//  1. **The attempt counter.** A month key claims the month once, and a memo
//     issued late into an already-posted January - or a January that was
//     reversed and is coming back - has to claim the NEXT key. Getting this
//     wrong converges on `already_posted`, which is a SUCCESS status, so the
//     memos would silently reverse nothing.
//  2. **`already_posted` is a SKIP that stamps nothing.** Stamping this group's
//     memos onto an entry this run did not make would attach them to somebody
//     else's numbers.
//  3. **Never throws**, and a group that posted but could not stamp is reported
//     in BOTH `posted` and `failed` (§4.4).
//  4. **§8's warning is a warning**, never a refusal.
//
// `plan.ts` and the pure builders run FOR REAL; only the database, the poster
// and the stamp are doubles.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnpostedCreditMemo } from '../types'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  memos: [] as unknown[],
  memosError: null as Error | null,
  settlementAccounts: new Map<string, string>(),
  unpostedShipments: 0,
  unpostedShipmentsError: null as Error | null,
  countedMonths: [] as string[],
  /** `GlPosting` rows the attempt counter finds, per call. */
  livePostings: [] as unknown[][],
  post: { status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-CRM-202601' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  postCalls: [] as Array<{ periodKey: string; txnDate: string; memo?: string }>,
  stamps: [] as Array<{ creditMemoId: string; values: unknown }>,
  stampThrowsFor: null as string | null,
  systemUserId: 'usr_system',
  isAccountingEnabled: vi.fn(async () => true),
  readMemoCalls: 0,
  readSettingsCalls: 0,
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))

vi.mock('../reads', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    readUnpostedCreditMemos: async () => {
      h.readMemoCalls++
      return h.memosError ? err(h.memosError) : ok(h.memos)
    },
    readCreditMemoSettlementAccounts: async () => ok(h.settlementAccounts),
    readCreditMemoPostingSettings: async () => {
      h.readSettingsCalls++
      return ok({
        cutoffPeriod: (h.settings['accounting.cutoffPeriod'] as string | null) ?? null,
        lockedThroughMonth: null,
        timeZone: (h.settings['accounting.bookTimeZone'] as string | null) ?? null,
        ledgerCurrency: 'USD',
      })
    },
  }
})

vi.mock('../../fulfillment-posting/reads', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    countUnpostedShipments: async (_db: unknown, { month }: { month: string }) => {
      h.countedMonths.push(month)
      return h.unpostedShipmentsError ? err(h.unpostedShipmentsError) : ok(h.unpostedShipments)
    },
  }
})

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))

vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: async (
    _db: unknown,
    options: { entry: { periodKey: string; txnDate: string }; memo?: string }
  ) => {
    h.postCalls.push({
      periodKey: options.entry.periodKey,
      txnDate: options.entry.txnDate,
      memo: options.memo,
    })
    return h.post
  },
}))

vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async setValuesForEntity(params: { recordId: string; values: unknown }) {
      const creditMemoId = String(params.recordId).split(':').pop() ?? ''
      if (h.stampThrowsFor === creditMemoId) throw new Error('could not lock the memo row')
      h.stamps.push({ creditMemoId, values: params.values })
    }
  },
}))

vi.mock('@auxx/types/resource', () => ({
  toRecordId: (defId: string, instanceId: string) => `${defId}:${instanceId}`,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.systemUserId }),
  getEntityDefIdResolver: async () => (slug: string) => `def_${slug}`,
}))

import type { Database } from '@auxx/database'
import { previewCreditMemoPosting, runCreditMemoPosting } from '../run'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

function memo(overrides: Partial<UnpostedCreditMemo> = {}): UnpostedCreditMemo {
  return {
    creditMemoId: 'cm_1',
    number: 'CM-0001',
    issuedAt: '2026-01-14',
    status: 'issued',
    source: 'channel',
    currency: 'USD',
    subtotalMinor: 10_000,
    taxTotalMinor: 0,
    totalMinor: 10_000,
    amountRefundedMinor: 10_000,
    contactId: 'ct_1',
    orderId: 'ord_1',
    reverseRevenue: true,
    ...overrides,
  }
}

/** `db.select(...).from(...).where(...)` awaited: the attempt counter's read. */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where']) self[method] = () => self
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.livePostings[index++] ?? []).then(resolve, reject)
    return self
  }
  return { select: () => chain() } as unknown as Database
}

const REQUEST = {
  organizationId: ORG,
  actorUserId: 'usr_1',
  range: { from: '2026-01-01', to: '2026-02-01' },
  grouping: 'month',
} as const

beforeEach(() => {
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.cutoffPeriod': null,
  }
  h.memos = [memo()]
  h.memosError = null
  h.settlementAccounts = new Map()
  h.unpostedShipments = 0
  h.unpostedShipmentsError = null
  h.countedMonths = []
  h.livePostings = []
  h.post = { status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-CRM-202601' }
  h.postCalls = []
  h.stamps = []
  h.stampThrowsFor = null
  h.isAccountingEnabled.mockResolvedValue(true)
  h.readMemoCalls = 0
  h.readSettingsCalls = 0
})

// task 17 §3: checked ONCE per org, before the settings read and the netting
// read - this run has no use for either when the org has never turned
// accounting on.
describe('accounting not enabled', () => {
  it('reads nothing, builds nothing, posts nothing, and returns an empty summary', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary).toEqual({ posted: [], skipped: [], failed: [], exclusions: [] })
    expect(h.readSettingsCalls).toBe(0)
    expect(h.readMemoCalls).toBe(0)
    expect(h.postCalls).toEqual([])
  })
})

describe('the refusals', () => {
  it('refuses a run whose organization has not finalized accounting setup', async () => {
    h.settings['accounting.setupState'] = 'draft'

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]?.status).toBe('refused')
    expect(summary.skipped[0]?.reason).toMatch(/not finalized/)
    expect(h.postCalls).toEqual([])
  })

  it('refuses a run with no book time zone', async () => {
    h.settings['accounting.bookTimeZone'] = null

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.skipped[0]?.reason).toMatch(/book time zone/)
    expect(h.postCalls).toEqual([])
  })

  it('names setup before the time zone, because an unfinished setup has no zone', async () => {
    h.settings['accounting.setupState'] = 'draft'
    h.settings['accounting.bookTimeZone'] = null

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.skipped[0]?.reason).toMatch(/not finalized/)
  })

  // ⚠️ The preview still shows the backlog. A person whose time zone is unset
  // needs to see how much is waiting on the settings row they are being told to
  // fix.
  it('previews the plan alongside the refusal rather than hiding it', async () => {
    h.settings['accounting.bookTimeZone'] = null

    const preview = (await previewCreditMemoPosting(stubDb(), REQUEST))._unsafeUnwrap()

    expect(preview.refusal).toMatch(/book time zone/)
    expect(preview.plan.groups).toHaveLength(1)
    expect(preview.plan.footer.totalMinor).toBe(10_000)
  })

  it('reports no refusal on a healthy organization', async () => {
    const preview = (await previewCreditMemoPosting(stubDb(), REQUEST))._unsafeUnwrap()

    expect(preview.refusal).toBeNull()
    expect(preview.plan.groups).toHaveLength(1)
  })

  it('surfaces a failed memo read as an Err from the preview', async () => {
    h.memosError = new Error('the ledger is unreachable')

    const preview = await previewCreditMemoPosting(stubDb(), REQUEST)

    expect(preview.isErr()).toBe(true)
  })

  it('writes nothing at all when the preview would be empty', async () => {
    h.memos = []

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary).toEqual({ posted: [], skipped: [], failed: [], exclusions: [] })
    expect(h.postCalls).toEqual([])
  })
})

describe('the attempt counter', () => {
  it('claims the bare group key when nothing live holds it', async () => {
    h.livePostings = [[]]

    await runCreditMemoPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-01')
  })

  // 🛑 The memo issued late into an already-posted January.
  it('appends an attempt character when one live posting already holds the month', async () => {
    h.livePostings = [[{ id: 'gl_old' }]]

    await runCreditMemoPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-011')
  })

  // 🛑 §2.1 makes reverse-and-repost the ONLY correction path for a batched
  // memo, so the reversal - an ordinary `posted` entry at the same key - has to
  // count, or the repost collides with the reversed original's tuple.
  it('counts a reversal, so a reversed period re-posts under the next attempt', async () => {
    h.livePostings = [[{ id: 'gl_reversal' }]]

    await runCreditMemoPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-011')
  })

  it('counts per group, so two days do not share an attempt', async () => {
    h.memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-15' }),
    ]
    h.livePostings = [[{ id: 'gl_old' }], []]

    await runCreditMemoPosting(stubDb(), { ...REQUEST, grouping: 'day' })

    expect(h.postCalls.map((call) => call.periodKey)).toEqual(['2026-01-141', '2026-01-15'])
  })
})

describe('posting and stamping', () => {
  it('posts one entry per group and stamps every memo in it', async () => {
    h.memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', contactId: 'ct_2' }),
    ]

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([
      { groupKey: '2026-01', postingId: 'gl_1', docNumber: 'AUXX-CRM-202601', memos: 2 },
    ])
    expect(summary.failed).toEqual([])
    expect(h.stamps.map((stamp) => stamp.creditMemoId)).toEqual(['a', 'b'])
  })

  // 🛑 A SCALAR field write (§4.1), not a JSON cell: no lock, no envelope.
  it('stamps the declared credit_memo_gl_posting field with the posting id', async () => {
    await runCreditMemoPosting(stubDb(), REQUEST)

    expect(h.stamps[0]?.values).toEqual([{ fieldId: 'credit_memo_gl_posting', value: 'gl_1' }])
  })

  it('dates the entry on the latest issue date in the group', async () => {
    h.memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-02' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-29' }),
    ]

    await runCreditMemoPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.txnDate).toBe('2026-01-29')
  })

  it('attributes an actorless run to the organization system user', async () => {
    const summary = await runCreditMemoPosting(stubDb(), { ...REQUEST, actorUserId: null })

    expect(summary.posted).toHaveLength(1)
  })

  it('carries the exclusions into the summary', async () => {
    h.memos = [memo(), memo({ creditMemoId: 'b', number: 'CM-0002', status: 'draft' })]

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.exclusions).toEqual([
      {
        creditMemoId: 'b',
        number: 'CM-0002',
        issuedAt: '2026-01-14',
        reason: 'not-issued',
        detail: 'draft',
      },
    ])
  })
})

// 🛑 It is a success everywhere else in the poster. Here it means the key was
// claimed by an entry this run did not make.
describe('already_posted', () => {
  it('is a SKIP, never a success, and stamps nothing', async () => {
    h.post = { status: 'already_posted', docNumber: 'AUXX-CRM-202601' }

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]).toMatchObject({ groupKey: '2026-01', status: 'already_posted' })
    expect(summary.skipped[0]?.reason).toMatch(/already claimed/)
    expect(h.stamps).toEqual([])
  })

  it('skips a declined entry with the ledger reason, and stamps nothing', async () => {
    h.post = { status: 'period_locked', error: 'January is closed' }

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]?.reason).toBe('January is closed')
    expect(h.stamps).toEqual([])
  })

  it('skips an accepted entry that named no posting', async () => {
    h.post = { status: 'posted' }

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]?.reason).toMatch(/named no posting/)
    expect(h.stamps).toEqual([])
  })
})

// §4.4: a group can end posted-with-unstamped-members, and that is reported in
// BOTH `posted` and `failed`. Do not quietly "fix" it.
describe('never throws', () => {
  it('reports a group that posted but could not stamp in posted AND in failed', async () => {
    h.memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001' }),
      memo({ creditMemoId: 'b', number: 'CM-0002' }),
    ]
    h.stampThrowsFor = 'a'

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toHaveLength(1)
    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.reason).toMatch(/CM-0001/)
    expect(summary.failed[0]?.reason).toMatch(/must NOT be posted a second time/)
    // 🛑 One memo's lock contention must not lose the rest of the group's
    // stamps.
    expect(h.stamps.map((stamp) => stamp.creditMemoId)).toEqual(['b'])
  })

  it('keeps running after a group that threw', async () => {
    h.memos = [
      memo({ creditMemoId: 'a', number: 'CM-0001', issuedAt: '2026-01-14' }),
      memo({ creditMemoId: 'b', number: 'CM-0002', issuedAt: '2026-01-15' }),
    ]
    // An attempt beyond the keyspace: the builder refuses THIS group only.
    h.livePostings = [Array.from({ length: 99 }, (_, index) => ({ id: `gl_${index}` })), []]

    const summary = await runCreditMemoPosting(stubDb(), { ...REQUEST, grouping: 'day' })

    expect(summary.failed[0]?.groupKey).toBe('2026-01-14')
    expect(summary.posted.map((row) => row.groupKey)).toEqual(['2026-01-15'])
  })

  it('returns a summary rather than throwing when the read fails', async () => {
    h.memosError = new Error('the connection dropped')

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.failed[0]?.reason).toMatch(/connection dropped/)
  })
})

// §8: post fulfillments before credit memos. A WARNING, never a refusal - it
// nets out within the month, so refusing would be stronger than the problem.
describe('the ordering warning', () => {
  it('carries the count and still posts', async () => {
    h.unpostedShipments = 7

    const preview = (await previewCreditMemoPosting(stubDb(), REQUEST))._unsafeUnwrap()
    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(preview.plan.unpostedShipmentWarning).toEqual({ shipments: 7 })
    expect(preview.refusal).toBeNull()
    expect(summary.posted).toHaveLength(1)
  })

  it('is null when every shipment in the range has posted', async () => {
    const preview = (await previewCreditMemoPosting(stubDb(), REQUEST))._unsafeUnwrap()

    expect(preview.plan.unpostedShipmentWarning).toBeNull()
  })

  it('counts every month the half-open range covers, and no month past its end', async () => {
    await previewCreditMemoPosting(stubDb(), {
      ...REQUEST,
      range: { from: '2026-01-01', to: '2026-03-01' },
    })

    expect(h.countedMonths).toEqual(['2026-01', '2026-02'])
  })

  it('counts the month a part-month range ends in', async () => {
    await previewCreditMemoPosting(stubDb(), {
      ...REQUEST,
      range: { from: '2026-01-20', to: '2026-02-15' },
    })

    expect(h.countedMonths).toEqual(['2026-01', '2026-02'])
  })

  // ⚠️ A banner must never be able to take a run down.
  it('posts anyway when the shipment count cannot be read', async () => {
    h.unpostedShipmentsError = new Error('the order fields are not provisioned')

    const summary = await runCreditMemoPosting(stubDb(), REQUEST)

    expect(summary.posted).toHaveLength(1)
  })
})
