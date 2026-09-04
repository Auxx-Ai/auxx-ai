// packages/lib/src/banking/feed/__tests__/reaper.test.ts
//
// The billing reaper (open question **S4**).
//
// 🛑 Both directions of this are expensive and neither is visible. Release one account
// too many and a customer has to re-authenticate at their bank to get their feed back;
// release too few and a churned org is billed 30c per institution per month forever,
// until somebody reads an invoice. So the SELECTION and the WAITING PERIOD are pinned
// here, and the Stripe call itself is a double.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectAccountAtStripe = vi.fn(async () => true)

vi.mock('../fc-client', () => ({
  disconnectAccountAtStripe,
  FC_PROVIDER_KEY: 'stripeFinancialConnections',
}))

const {
  clearFeedDisconnectedAt,
  FEED_DISCONNECTED_AT_KEY,
  findReapableBankFeeds,
  REAP_AFTER_DAYS,
  reapBankFeedAccount,
  reapDisconnectedBankFeeds,
  stampFeedDisconnectedAt,
} = await import('../reaper')

/**
 * The SQL a drizzle fragment actually renders to, so a predicate can be asserted.
 *
 * ⚠️ Rendered OUTSIDE a query builder, so column references come back blank and
 * every value is a bound parameter. That is enough - what these tests pin is the
 * SHAPE of the predicate (which arms carry a cutoff) and the VALUES bound into
 * it, not the identifiers.
 */
function render(fragment: unknown): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment as never)
  return { sql: query.sql, params: query.params }
}

const NOW = new Date('2026-09-04T00:00:00.000Z')

interface Row {
  connectorId: string
  organizationId: string
  credentialId: string
  providerAccountId: string | null
  /** Null when the LEFT JOIN found no organization row: a HARD-deleted org. */
  organizationRowId: string | null
  organizationDisabledAt: Date | null
  connectorUpdatedAt: Date
  status: string
}

/**
 * A db double that returns the rows given.
 *
 * ⚠️ The WHERE clause is real SQL and is not evaluated here - this pins the mapping and
 * the sweep's behaviour, not the predicate. The predicate's own arithmetic is asserted
 * through {@link REAP_AFTER_DAYS} below, which is the number a reviewer has to agree
 * with.
 */
function fakeDb(rows: Row[]) {
  const updates: Record<string, unknown>[] = []
  const predicates: unknown[] = []
  return {
    updates,
    predicates,
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            where: async (predicate: unknown) => {
              predicates.push(predicate)
              return rows
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values)
        },
      }),
    }),
  } as never
}

/** The captured selection predicate, rendered. */
function selection(db: unknown): { sql: string; params: unknown[] } {
  return render((db as { predicates: unknown[] }).predicates[0])
}

function row(over: Partial<Row> = {}): Row {
  return {
    connectorId: 'conn_1',
    organizationId: 'org_1',
    credentialId: 'cred_1',
    providerAccountId: 'fca_1',
    organizationRowId: 'org_1',
    organizationDisabledAt: null,
    connectorUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    status: 'disconnected',
    ...over,
  }
}

beforeEach(() => {
  disconnectAccountAtStripe.mockClear()
  disconnectAccountAtStripe.mockResolvedValue(true)
})

describe('the waiting period', () => {
  it('is fourteen days, and the number is the whole judgement', () => {
    // Long enough that anybody who meant to reconnect has - a `disconnected` connector
    // is very often one somebody is about to repair, and releasing it at Stripe makes
    // the repair impossible without a fresh bank authentication. Short enough that a
    // churned customer costs at most one more billing cycle.
    expect(REAP_AFTER_DAYS).toBe(14)
  })
})

describe('findReapableBankFeeds', () => {
  it('drops a row whose credential lost its provider account id', async () => {
    // Nothing to disconnect, and calling Stripe with an empty id would 400 on every run.
    const candidates = await findReapableBankFeeds(fakeDb([row({ providerAccountId: null })]), NOW)
    expect(candidates).toEqual([])
  })

  it('labels a stale disconnected feed and a gone organization differently', async () => {
    const candidates = await findReapableBankFeeds(
      fakeDb([
        row({ connectorId: 'conn_stale' }),
        row({
          connectorId: 'conn_orphan',
          status: 'live',
          organizationDisabledAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ]),
      NOW
    )
    expect(candidates.map((c) => [c.connectorId, c.reason])).toEqual([
      ['conn_stale', 'disconnected'],
      ['conn_orphan', 'organization-gone'],
    ])
  })

  it('calls a HARD-DELETED org gone even when its connector was already disconnected', async () => {
    // The label used to key on the connector's status, so the one case where it
    // matters most - nobody is coming back to reconnect this - read as an
    // ordinary stale feed.
    const candidates = await findReapableBankFeeds(
      fakeDb([
        row({ connectorId: 'conn_deleted', organizationRowId: null, status: 'disconnected' }),
      ]),
      NOW
    )
    expect(candidates[0]?.reason).toBe('organization-gone')
  })

  describe('the selection predicate', () => {
    const CUTOFF = new Date(NOW.getTime() - REAP_AFTER_DAYS * 86_400_000).toISOString()

    it('🛑 gives a SUSPENDED organization the same fourteen days, not an instant reap', async () => {
      // `disabledAt` is admin suspension - a billing dispute, an abuse review,
      // an offboarding somebody may reverse tomorrow. Reaping on it with no
      // grace disconnects every Financial Connections account at Stripe that
      // night, and every bank then needs a fresh authentication at the bank.
      //
      // The cutoff appearing TWICE is the assertion: once on the stale-feed arm,
      // once on the suspended-org arm.
      const db = fakeDb([])
      await findReapableBankFeeds(db, NOW)
      const { params } = selection(db)
      expect(params.filter((value) => value === CUTOFF)).toHaveLength(2)
    })

    it('reaps a HARD-DELETED organization with no waiting period', async () => {
      const db = fakeDb([])
      await findReapableBankFeeds(db, NOW)
      // The missing-row arm stands alone: it is the last one and no cutoff is
      // anded onto it, because there is nobody left to reconnect.
      expect(selection(db).sql).toMatch(/OR\s+IS NULL\s*\)\s*\)/)
    })

    it('🛑 keys the disconnected clock on the state key, never on updatedAt alone', async () => {
      // `updatedAt` carries `$onUpdate`, and the webhook stamps
      // `lastWebhookEventAt` on every delivery - including every redelivery of
      // the disconnect event itself - so a dead connection would push its own
      // cutoff forward and bill indefinitely.
      const db = fakeDb([])
      await findReapableBankFeeds(db, NOW)
      const { sql, params } = selection(db)
      expect(sql).toContain('coalesce(')
      expect(params).toContain(FEED_DISCONNECTED_AT_KEY)
    })
  })
})

describe('the disconnected clock', () => {
  it('🛑 is write-once: a redelivered disconnect event may not push the cutoff forward', async () => {
    const db = fakeDb([])
    await stampFeedDisconnectedAt(db, 'conn_1', NOW)
    const written = render(
      (db as unknown as { updates: Record<string, unknown>[] }).updates[0]?.state
    )
    // `coalesce(existing, now)` - the value already there wins.
    expect(written.sql).toContain('coalesce(')
    expect(written.sql).toContain('jsonb_build_object')
    expect(written.params).toContain(NOW.toISOString())
  })

  it('is cleared on a reconnect, so the next death starts a fresh fourteen days', async () => {
    const db = fakeDb([])
    await clearFeedDisconnectedAt(db, 'conn_1')
    const written = render(
      (db as unknown as { updates: Record<string, unknown>[] }).updates[0]?.state
    )
    expect(written.sql).toContain(' - ')
    expect(written.params).toContain(FEED_DISCONNECTED_AT_KEY)
  })
})

describe('reapBankFeedAccount', () => {
  it('releases at Stripe and records why, keeping every row', async () => {
    // 🛑 Not one connector, bank account or transaction is deleted. Releasing the
    // account stops the bill; the rows behind it are source documents of postings.
    const db = fakeDb([])
    const released = await reapBankFeedAccount(db, {
      connectorId: 'conn_1',
      providerAccountId: 'fca_1',
    })
    expect(released).toBe(true)
    expect(disconnectAccountAtStripe).toHaveBeenCalledWith('fca_1')
    const update = (db as unknown as { updates: Record<string, unknown>[] }).updates[0]
    expect(update?.status).toBe('disconnected')
    expect(String(update?.error)).toMatch(/Reconnect/i)
    // ...and the reaper's own clock is stamped alongside it.
    expect((db as unknown as { updates: Record<string, unknown>[] }).updates[1]).toHaveProperty(
      'state'
    )
  })

  it('writes nothing when Stripe refused the release', async () => {
    // The next run retries. Claiming we released an account we did not would take it
    // out of the sweep's sight while it kept billing.
    disconnectAccountAtStripe.mockResolvedValue(false)
    const db = fakeDb([])
    expect(
      await reapBankFeedAccount(db, { connectorId: 'conn_1', providerAccountId: 'fca_1' })
    ).toBe(false)
    expect((db as unknown as { updates: unknown[] }).updates).toHaveLength(0)
  })
})

describe('reapDisconnectedBankFeeds', () => {
  it('counts what it released and what it could not', async () => {
    disconnectAccountAtStripe.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const stats = await reapDisconnectedBankFeeds(
      fakeDb([row({ connectorId: 'a' }), row({ connectorId: 'b', providerAccountId: 'fca_2' })]),
      NOW
    )
    expect(stats).toEqual({ candidates: 2, disconnected: 1, failed: 1 })
  })

  it('keeps going when one account throws', async () => {
    // One dead account must not stop the sweep reaching the next org's billable one.
    disconnectAccountAtStripe.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true)
    const stats = await reapDisconnectedBankFeeds(
      fakeDb([row({ connectorId: 'a' }), row({ connectorId: 'b', providerAccountId: 'fca_2' })]),
      NOW
    )
    expect(stats.disconnected).toBe(1)
    expect(stats.failed).toBe(1)
  })

  it('does nothing at all when there is nothing to reap', async () => {
    const stats = await reapDisconnectedBankFeeds(fakeDb([]), NOW)
    expect(stats).toEqual({ candidates: 0, disconnected: 0, failed: 0 })
    expect(disconnectAccountAtStripe).not.toHaveBeenCalled()
  })
})
