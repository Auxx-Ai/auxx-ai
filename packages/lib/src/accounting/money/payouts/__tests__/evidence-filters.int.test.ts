// packages/lib/src/accounting/money/payouts/__tests__/evidence-filters.int.test.ts
//
// The payout evidence list's server-side filters, against real SQL.
//
// 🛑 Deliberately a DB-backed test rather than a query stub. The unit config
// mocks `@auxx/database`, so `schema.MoneyTransfer.occurredOn` is `undefined`
// there and a stubbed `.where()` swallows its argument — a stub test would
// assert that a filter was *passed*, never that it *narrows*. The one thing
// worth proving here (an `instant` row with no `occurredOn` still falls inside
// a date range) only exists at the SQL layer.
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PayoutRecordEvidence } from '../../customer-money/record-contracts'
import { writeFinancialRecords } from '../../customer-money/record-storage'
import { listPayoutEvidence, listPayoutSourceAccounts } from '../evidence-reads'

const ALPHA = {
  providerKey: 'gateway_a',
  externalAccountId: 'merchant-1',
  environment: 'live' as const,
}
const BRAVO = {
  providerKey: 'gateway_b',
  externalAccountId: 'merchant-2',
  environment: 'live' as const,
}

let organizationId: string
let actorUserId: string
let payoutDefId: string

type Fixture = {
  id: string
  status: string
  sourceAccount: typeof ALPHA
  issuedOn?: string | null
  issuedAt?: string | null
}

function evidence(fixture: Fixture): PayoutRecordEvidence {
  return {
    version: 2 as const,
    externalId: fixture.id,
    sourceAccount: fixture.sourceAccount,
    acquisition: { id: `acquisition-${fixture.id}`, startedAt: '2026-05-01T00:00:00Z' },
    payout: {
      id: fixture.id,
      status: fixture.status,
      amount: '97.00',
      currency: 'USD',
      currencyExponent: 2,
      issuedAt: fixture.issuedAt ?? null,
      issuedOn: fixture.issuedOn ?? null,
      destinationExternalId: null,
      raw: {},
    },
    raw: {},
    rejectionReason: null,
    membership: {
      providerReady: true,
      complete: true,
      reason: null,
      page: {
        id: `page-${fixture.id}`,
        index: 0,
        requestCursor: null,
        nextCursor: null,
        terminal: true,
      },
      entries: [],
      rejections: [],
      rawRows: [],
    },
  }
}

async function seed(fixtures: Fixture[]) {
  await writeFinancialRecords(getTestDb(), {
    organizationId,
    actorUserId,
    records: fixtures.map((fixture) => ({
      entityType: 'payout' as const,
      entityDefinitionId: payoutDefId,
      evidence: evidence(fixture),
    })),
    provenance: { source: 'import', ref: 'fixture-import' },
  })
}

/** Every external id the list returns, so order-insensitive set assertions read plainly. */
async function externalIds(filters: Record<string, string> = {}) {
  const page = await listPayoutEvidence(getTestDb(), { organizationId, limit: 100, ...filters })
  return page.items.map((item) => item.externalId).sort()
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  actorUserId = (await createTestUser()).id
  const [definition] = await getTestDb()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      entityType: 'payout',
      apiSlug: 'payouts',
      singular: 'Payout',
      plural: 'Payouts',
      updatedAt: new Date(),
    })
    .returning()
  payoutDefId = definition!.id
  await seed([
    // A calendar-dated payout: `occurredOn` set, `occurredAt` null.
    { id: 'po_alpha_1', status: 'paid', sourceAccount: ALPHA, issuedOn: '2026-03-10' },
    // 🛑 The row this whole file exists for. `datePrecision = 'instant'` means
    // `occurredOn` is NULL, so a range on that column alone never sees it.
    {
      id: 'po_beta_2',
      status: 'in_transit',
      sourceAccount: ALPHA,
      issuedAt: '2026-03-20T08:00:00Z',
    },
    { id: 'po_gamma_3', status: 'paid', sourceAccount: BRAVO, issuedOn: '2026-04-05' },
    // No date at all — `datePrecision = 'unknown'`.
    { id: 'po_delta_4', status: 'paid', sourceAccount: BRAVO },
  ])
})

describe('payout evidence list filters', () => {
  it('returns every payout when no filter is set', async () => {
    expect(await externalIds()).toEqual(['po_alpha_1', 'po_beta_2', 'po_delta_4', 'po_gamma_3'])
  })

  it('matches an external id case-insensitively on a substring', async () => {
    expect(await externalIds({ search: 'BETA' })).toEqual(['po_beta_2'])
    expect(await externalIds({ search: 'po_' })).toHaveLength(4)
    expect(await externalIds({ search: 'no-such-payout' })).toEqual([])
  })

  it('treats a blank search as unset rather than as a filter that matches nothing', async () => {
    expect(await externalIds({ search: '   ' })).toHaveLength(4)
  })

  it('narrows to one source account', async () => {
    const [alpha] = await listPayoutSourceAccounts(getTestDb(), { organizationId })
    expect(await externalIds({ sourceAccountId: alpha!.id })).toEqual(['po_alpha_1', 'po_beta_2'])
  })

  it('narrows to one status exactly', async () => {
    expect(await externalIds({ status: 'in_transit' })).toEqual(['po_beta_2'])
    expect(await externalIds({ status: 'paid' })).toEqual([
      'po_alpha_1',
      'po_delta_4',
      'po_gamma_3',
    ])
  })

  it('finds a timestamp-only payout inside a date range, not just a date-only one', async () => {
    // `po_beta_2` has no `occurredOn` whatsoever. Without the COALESCE this is
    // an empty list, and the payout reads as missing rather than as filtered.
    expect(await externalIds({ from: '2026-03-15', to: '2026-03-25' })).toEqual(['po_beta_2'])
  })

  it('bounds a range inclusively on both ends', async () => {
    expect(await externalIds({ from: '2026-03-10', to: '2026-03-10' })).toEqual(['po_alpha_1'])
    expect(await externalIds({ from: '2026-03-20', to: '2026-03-20' })).toEqual(['po_beta_2'])
  })

  it('uses `from` and `to` independently', async () => {
    expect(await externalIds({ from: '2026-03-15' })).toEqual(['po_beta_2', 'po_gamma_3'])
    expect(await externalIds({ to: '2026-03-15' })).toEqual(['po_alpha_1'])
  })

  it('leaves an undated payout out of a dated range but in the unfiltered list', async () => {
    expect(await externalIds({ from: '2000-01-01', to: '2099-12-31' })).toEqual([
      'po_alpha_1',
      'po_beta_2',
      'po_gamma_3',
    ])
    expect(await externalIds()).toContain('po_delta_4')
  })

  it('composes filters as one conjunction', async () => {
    const [alpha] = await listPayoutSourceAccounts(getTestDb(), { organizationId })
    expect(await externalIds({ sourceAccountId: alpha!.id, status: 'paid' })).toEqual([
      'po_alpha_1',
    ])
    expect(
      await externalIds({ sourceAccountId: alpha!.id, from: '2026-03-15', to: '2026-03-25' })
    ).toEqual(['po_beta_2'])
    expect(await externalIds({ search: 'gamma', status: 'in_transit' })).toEqual([])
  })

  it('keeps paging in date order while filters are applied', async () => {
    const first = await listPayoutEvidence(getTestDb(), {
      organizationId,
      limit: 1,
      status: 'paid',
    })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]!.externalId).toBe('po_gamma_3')
    expect(first.nextCursor).toBe(`2026-04-05|${first.items[0]!.id}`)
    const second = await listPayoutEvidence(getTestDb(), {
      organizationId,
      limit: 1,
      status: 'paid',
      cursor: first.nextCursor!,
    })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]!.externalId).toBe('po_alpha_1')
    expect(second.items[0]!.status).toBe('paid')
  })

  it('rejects a cursor that does not carry a day', async () => {
    const first = await listPayoutEvidence(getTestDb(), { organizationId, limit: 1 })
    await expect(
      listPayoutEvidence(getTestDb(), { organizationId, limit: 1, cursor: first.items[0]!.id })
    ).rejects.toThrow('Invalid payout cursor')
  })

  it('does not leak another organization’s payouts through a filter', async () => {
    const other = (await createTestOrganization()).id
    expect(
      (await listPayoutEvidence(getTestDb(), { organizationId: other, limit: 100, status: 'paid' }))
        .items
    ).toEqual([])
  })
})

describe('payout evidence list order', () => {
  /** 🛑 Order-SENSITIVE, unlike `externalIds()` above, which sorts. */
  async function orderedIds(filters: Record<string, string> = {}) {
    const page = await listPayoutEvidence(getTestDb(), { organizationId, limit: 100, ...filters })
    return page.items.map((item) => item.externalId)
  }

  it('puts the newest payout first and sinks the undated one to the bottom', async () => {
    // `po_beta_2` is `instant` precision and `po_alpha_1` is `date` precision,
    // so this also proves both kinds sort on one comparable day.
    expect(await orderedIds()).toEqual(['po_gamma_3', 'po_beta_2', 'po_alpha_1', 'po_delta_4'])
  })

  it('holds the order across every page of a paged read', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listPayoutEvidence(getTestDb(), {
        organizationId,
        limit: 1,
        cursor: cursor ?? undefined,
      })
      seen.push(...page.items.map((item) => item.externalId))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual(['po_gamma_3', 'po_beta_2', 'po_alpha_1', 'po_delta_4'])
  })

  it('breaks a same-day tie on the id rather than returning a row twice', async () => {
    await seed([
      { id: 'po_eta_7', status: 'paid', sourceAccount: ALPHA, issuedOn: '2026-07-01' },
      { id: 'po_theta_8', status: 'paid', sourceAccount: ALPHA, issuedOn: '2026-07-01' },
    ])
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await listPayoutEvidence(getTestDb(), {
        organizationId,
        limit: 1,
        cursor: cursor ?? undefined,
      })
      seen.push(...page.items.map((item) => item.externalId))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen.slice(0, 2).sort()).toEqual(['po_eta_7', 'po_theta_8'])
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(6)
  })

  it('keeps the order under a filter', async () => {
    expect(await orderedIds({ status: 'paid' })).toEqual(['po_gamma_3', 'po_alpha_1', 'po_delta_4'])
  })
})

describe('payout source account options', () => {
  it('offers only accounts with a payout behind them, sorted by provider', async () => {
    // Connected but never synced: it has no `MoneyTransfer`, so offering it
    // would give the operator a filter that always answers with nothing.
    await getTestDb().insert(schema.FinancialSourceAccount).values({
      organizationId,
      providerKey: 'gateway_aa_unsynced',
      externalAccountId: 'merchant-3',
      environment: 'live',
    })
    expect(await listPayoutSourceAccounts(getTestDb(), { organizationId })).toEqual([
      expect.objectContaining(ALPHA),
      expect.objectContaining(BRAVO),
    ])
  })

  it('returns each account once however many payouts it has', async () => {
    await seed([
      { id: 'po_epsilon_5', status: 'paid', sourceAccount: ALPHA, issuedOn: '2026-06-01' },
      { id: 'po_zeta_6', status: 'paid', sourceAccount: ALPHA, issuedOn: '2026-06-02' },
    ])
    const accounts = await listPayoutSourceAccounts(getTestDb(), { organizationId })
    expect(accounts).toHaveLength(2)
  })

  it('does not offer another organization’s accounts', async () => {
    const other = (await createTestOrganization()).id
    expect(await listPayoutSourceAccounts(getTestDb(), { organizationId: other })).toEqual([])
  })
})
