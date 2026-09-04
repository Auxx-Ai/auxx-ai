// packages/lib/src/data-connectors/connectors/stripe-financial-connections.test.ts
//
// The bank-feed connector, driven with a FAKE Stripe client and no network - the same
// shape `fixture.ts` and `generic-rest.test.ts` prove the spine with.
//
// Everything asserted here is either a mapping decision the ledger depends on
// (`transacted_at` not `posted_at`, the signed amount, the credit/depository split) or a
// cursor decision the feed's correctness depends on (the composite watermark, holding
// the cursor across a slice). Both classes fail silently in production, which is why
// they are pinned rather than sampled.

import { describe, expect, it } from 'vitest'
import {
  createStripeFinancialConnectionsConnector,
  decodeRefreshWatermark,
  encodeRefreshWatermark,
  FC_ACCOUNTS_STREAM,
  FC_TRANSACTIONS_STREAM,
  type FcAccount,
  type FcTransaction,
  type FinancialConnectionsClient,
  toBankAccountType,
  toBankStatus,
  toTransactionFields,
} from './stripe-financial-connections'
import type { ConnectorFetchArgs, ConnectorYield } from './types'
import { isConnectorCheckpoint } from './types'

const ACCOUNT_ID = 'fca_test123'
const BANK_ACCOUNT_RECORD = 'def_bank_account:inst_1'
const CONNECTOR_ID = 'conn_1'

function account(over: Partial<FcAccount> = {}): FcAccount {
  return {
    id: ACCOUNT_ID,
    status: 'active',
    institution_name: 'StripeBank',
    display_name: 'Sample Checking Account',
    last4: '6789',
    category: 'cash',
    subcategory: 'checking',
    balance: { current: { usd: 6000 } },
    transaction_refresh: {
      id: 'fctxnref_A',
      status: 'succeeded',
      last_attempted_at: 1_700_000_000,
    },
    ...over,
  }
}

function txn(over: Partial<FcTransaction> = {}): FcTransaction {
  return {
    id: 'fctxn_1',
    account: ACCOUNT_ID,
    amount: -1000,
    currency: 'usd',
    description: 'ROCKET RIDES 01/31 XXXX4321',
    status: 'posted',
    status_transitions: { posted_at: 1_651_871_399, void_at: null },
    transacted_at: 1_651_784_999,
    transaction_refresh: 'fctxnref_A',
    ...over,
  }
}

/** A fake client that answers pages in order and records what it was asked. */
function fakeClient(
  pages: { data: FcTransaction[]; has_more?: boolean }[],
  accountOverride?: FcAccount
): FinancialConnectionsClient & { calls: unknown[] } {
  const calls: unknown[] = []
  let index = 0
  return {
    calls,
    accounts: {
      retrieve: async () => accountOverride ?? account(),
    },
    transactions: {
      list: async (params) => {
        calls.push(params)
        return pages[index++] ?? { data: [], has_more: false }
      },
    },
  }
}

function args(over: Partial<ConnectorFetchArgs> = {}): ConnectorFetchArgs {
  return {
    streamKey: FC_TRANSACTIONS_STREAM,
    mode: 'snapshot',
    state: {},
    credential: {
      id: 'cred',
      type: 'hosted-provision',
      value: '',
      metadata: { providerAccountId: ACCOUNT_ID },
    } as never,
    config: {
      filters: {
        financialConnections: {
          bankAccountRecordId: BANK_ACCOUNT_RECORD,
          connectorId: CONNECTOR_ID,
          bookTimeZone: 'America/New_York',
        },
      },
    },
    ...over,
  }
}

async function drain(iterable: AsyncIterable<ConnectorYield>): Promise<ConnectorYield[]> {
  const out: ConnectorYield[] = []
  for await (const y of iterable) out.push(y)
  return out
}

/** `out[i]`, refusing rather than answering `undefined` - every index here is asserted. */
function at(out: ConnectorYield[], index: number): ConnectorYield {
  const value = out[index]
  if (!value) throw new Error(`expected a yield at index ${index}, got ${out.length} in total`)
  return value
}

describe('field shaping', () => {
  it('uses transacted_at, not posted_at, and converts in the BOOK timezone', () => {
    // 🛑 The §9.5 trap, and it is the whole reason `bookTimeZone` is copied into the
    // connector's config. 1651784999 is 2022-05-05 21:09:59Z - already the 6th in UTC
    // terms for a late-evening New York transaction, and 2022-05-05 locally. Deriving
    // it in UTC posts the line to the wrong day and, across a month boundary, the wrong
    // PERIOD - invisible except at a close, and uncorrectable once the period is locked.
    const utc = toTransactionFields(txn(), {
      bankAccountRecordId: BANK_ACCOUNT_RECORD,
      bookTimeZone: 'UTC',
    })
    const ny = toTransactionFields(txn({ transacted_at: 1_651_798_800 }), {
      bankAccountRecordId: BANK_ACCOUNT_RECORD,
      bookTimeZone: 'America/New_York',
    })
    expect(utc.postedAt).toBe('2022-05-05')
    // 1651798800 is 2022-05-06 01:00:00Z = 2022-05-05 21:00 in New York.
    expect(ny.postedAt).toBe('2022-05-05')
  })

  it('keeps the amount SIGNED and in minor units', () => {
    // The one signed money column in the books. It mirrors the statement, and
    // reconciling is comparing the two; the split into a positive amount plus a
    // direction happens at the builder boundary, never here.
    const fields = toTransactionFields(txn({ amount: -1000 }), {
      bankAccountRecordId: BANK_ACCOUNT_RECORD,
      bookTimeZone: 'UTC',
    })
    expect(fields.amountMinor).toBe(-1000)
    expect(fields.source).toBe('feed')
  })

  it('normalises the description into a matchKey and keeps the raw one', () => {
    const fields = toTransactionFields(txn(), {
      bankAccountRecordId: BANK_ACCOUNT_RECORD,
      bookTimeZone: 'UTC',
    })
    expect(fields.description).toBe('ROCKET RIDES 01/31 XXXX4321')
    expect(fields.matchKey).toBe('rocket rides')
  })

  it('narrows the BANK status and defaults to posted', () => {
    expect(toBankStatus('pending')).toBe('pending')
    expect(toBankStatus('void')).toBe('void')
    expect(toBankStatus('posted')).toBe('posted')
    expect(toBankStatus(null)).toBe('posted')
    expect(toBankStatus('something_new')).toBe('posted')
  })

  it('asserts credit vs depository ONCE, from the account', () => {
    // 🛑 Never inferred per transaction. A card mapped as an asset produces a balance
    // sheet that still balances and is wrong by twice the card balance.
    expect(toBankAccountType(account())).toBe('depository')
    expect(toBankAccountType(account({ category: 'credit' }))).toBe('credit')
    expect(toBankAccountType(account({ category: 'other', subcategory: 'credit_card' }))).toBe(
      'credit'
    )
  })
})

describe('the accounts stream', () => {
  it('yields one record and a terminal checkpoint', async () => {
    const connector = createStripeFinancialConnectionsConnector(() => fakeClient([]))
    const result = await connector.fetch(args({ streamKey: FC_ACCOUNTS_STREAM }))
    const out = await drain(result.records)

    expect(out).toHaveLength(2)
    const record = at(out, 0)
    if (isConnectorCheckpoint(record)) throw new Error('expected a record first')
    expect(record.externalId).toBe(ACCOUNT_ID)
    expect(record.fields).toMatchObject({
      connectorId: CONNECTOR_ID,
      institution: 'StripeBank',
      last4: '6789',
      type: 'depository',
      currency: 'USD',
      status: 'connected',
    })
    // No cursor ⇒ exhausted.
    expect(out[1]).toEqual({ __checkpoint: true })
  })
})

describe('the transactions stream', () => {
  it('yields records and a terminal checkpoint carrying the consumed refresh', async () => {
    const client = fakeClient([{ data: [txn(), txn({ id: 'fctxn_2' })], has_more: false }])
    const connector = createStripeFinancialConnectionsConnector(() => client)
    const out = await drain((await connector.fetch(args())).records)

    expect(out).toHaveLength(3)
    const checkpoint = at(out, 2)
    if (!isConnectorCheckpoint(checkpoint)) throw new Error('expected a checkpoint')
    expect(checkpoint.cursor).toBeUndefined()
    expect(decodeRefreshWatermark(checkpoint.watermark)).toBe('fctxnref_A')
  })

  it('pages with starting_after and holds the refresh filter across the page-set', async () => {
    const client = fakeClient([
      { data: [txn({ id: 'fctxn_1' })], has_more: true },
      { data: [txn({ id: 'fctxn_2' })], has_more: false },
    ])
    const connector = createStripeFinancialConnectionsConnector(() => client)
    const out = await drain(
      (
        await connector.fetch(
          args({
            mode: 'incremental',
            state: { watermark: encodeRefreshWatermark('fctxnref_PREV', 1_699_000_000) },
          })
        )
      ).records
    )

    // record, checkpoint(cursor), record, checkpoint(terminal)
    expect(out).toHaveLength(4)
    const mid = at(out, 1)
    if (!isConnectorCheckpoint(mid)) throw new Error('expected a mid checkpoint')
    expect(mid.cursor).toBeDefined()

    expect(client.calls[0]).toMatchObject({ transaction_refresh: { after: 'fctxnref_PREV' } })
    expect(client.calls[1]).toMatchObject({
      starting_after: 'fctxn_1',
      transaction_refresh: { after: 'fctxnref_PREV' },
    })
  })

  it('omits the refresh filter on a BACKFILL so the first sync takes all 180 days', async () => {
    const client = fakeClient([{ data: [txn()], has_more: false }])
    const connector = createStripeFinancialConnectionsConnector(() => client)
    await drain(
      (
        await connector.fetch(
          args({
            mode: 'snapshot',
            state: { watermark: encodeRefreshWatermark('fctxnref_PREV', 1_699_000_000) },
          })
        )
      ).records
    )
    expect(client.calls[0]).not.toHaveProperty('transaction_refresh')
  })

  it('resumes mid-page-set from the cursor a previous slice left', async () => {
    const client = fakeClient([{ data: [txn({ id: 'fctxn_3' })], has_more: false }])
    const connector = createStripeFinancialConnectionsConnector(() => client)
    await drain(
      (
        await connector.fetch(
          args({
            state: {
              backfillCursor: {
                kind: 'token',
                value: JSON.stringify({ startingAfter: 'fctxn_2', refreshAfter: 'fctxnref_X' }),
              },
            },
          })
        )
      ).records
    )
    expect(client.calls[0]).toMatchObject({
      starting_after: 'fctxn_2',
      transaction_refresh: { after: 'fctxnref_X' },
    })
  })

  it('does not consume a refresh that has not succeeded', async () => {
    // ⚠️ Pinning a `pending` refresh would advance past rows Stripe has not finished
    // fetching, and nothing would ever ask for them again.
    const client = fakeClient(
      [{ data: [txn()], has_more: false }],
      account({ transaction_refresh: { id: 'fctxnref_B', status: 'pending' } })
    )
    const connector = createStripeFinancialConnectionsConnector(() => client)
    const out = await drain((await connector.fetch(args())).records)
    const terminal = at(out, out.length - 1)
    if (!isConnectorCheckpoint(terminal)) throw new Error('expected a checkpoint')
    expect(terminal.watermark).toBeUndefined()
  })

  it('tolerates a malformed cursor rather than failing the sync', async () => {
    const client = fakeClient([{ data: [], has_more: false }])
    const connector = createStripeFinancialConnectionsConnector(() => client)
    await drain(
      (await connector.fetch(args({ state: { backfillCursor: { kind: 'token', value: '{{' } } })))
        .records
    )
    expect(client.calls[0]).not.toHaveProperty('starting_after')
  })
})

describe('the inactive-account refusal', () => {
  it('refuses rather than reporting an empty sync, and says "Reconnect"', async () => {
    // 🛑 An inactive account is never read as "nothing to sync": subscribe and refresh
    // both refuse on it, so a silent success is a feed that has stopped and says so
    // nowhere. The word "Reconnect" is load-bearing - `classifyConnectorError` matches
    // it and routes the connector to `action-needed` with the non-dismissible banner
    // instead of a generic error with a Retry button that cannot work.
    const client = fakeClient([], account({ status: 'inactive' }))
    const connector = createStripeFinancialConnectionsConnector(() => client)
    await expect(connector.fetch(args())).rejects.toThrow(/Reconnect/i)
  })

  it('refuses a connector that was never fully provisioned', async () => {
    const connector = createStripeFinancialConnectionsConnector(() => fakeClient([]))
    await expect(connector.fetch(args({ config: {} }))).rejects.toThrow(/not fully provisioned/i)
  })
})

describe('the refresh watermark codec', () => {
  it('is monotonic under a LEXICAL compare, which is what the engine folds with', () => {
    // 🛑 The engine's `maxWatermark` compares two non-numeric strings lexically, and a
    // Stripe object id has a random suffix - so a bare refresh id is lexically smaller
    // than its predecessor about half the time and the fold would silently discard it,
    // pinning the feed to an old cursor for good.
    const older = encodeRefreshWatermark('fctxnref_ZZZZ', 1_700_000_000)
    const newer = encodeRefreshWatermark('fctxnref_AAAA', 1_700_000_001)
    expect(newer > older).toBe(true)
  })

  it('round-trips the id and answers null for anything malformed', () => {
    expect(decodeRefreshWatermark(encodeRefreshWatermark('fctxnref_X', 1))).toBe('fctxnref_X')
    expect(decodeRefreshWatermark(undefined)).toBeNull()
    expect(decodeRefreshWatermark('no-separator')).toBeNull()
    expect(decodeRefreshWatermark('000000000001:')).toBeNull()
  })
})
