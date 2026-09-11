// packages/lib/src/money/quickbooks/__tests__/quickbooks-accounting-provider.test.ts
//
// The idempotency ladder is the whole point of this adapter - a double-posted
// journal entry silently misstates the financial statements, with no invoice or
// payment to reconcile against. Layer 1 now lives on the `GlPosting` unique
// index and belongs to the core, so what is exercised here is layers 2, 3 and 4,
// the duplicate-document-number net under the create, and the retry
// classification the core routes on.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationSetting = vi.fn()
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: (...a: unknown[]) => getOrganizationSetting(...a),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

// The `G19` account map replaced AcctNum matching, so resolution now reads two
// things this file has no database for: OUR chart, and the confirmed
// `gl_account -> QuickBooks account` map. Both are stubbed; the QuickBooks chart
// itself still comes through the real `callTool` below, because how this adapter
// reads a provider chart is exactly what these tests are for.
const listChartAccounts = vi.fn()
vi.mock('../../../postings/role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

const readQuickbooksAccountMap = vi.fn()
vi.mock('../account-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../account-map')>()),
  readQuickbooksAccountMap: (...a: unknown[]) => readQuickbooksAccountMap(...a),
}))

// The counterparty seam (brief 13 §1). Mocked the same way `upsert-customer.test.ts`
// mocks it - `resolveCounterparties` never touches a real `UnifiedCrudHandler` method,
// it only threads one through to this call.
const readQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
}))

import type { PostEntryInput, ResolvedPostingLine } from '../../../postings/types'
import { ProviderPostError } from '../../../postings/types'
import {
  createQuickbooksAccountingProvider,
  QUICKBOOKS_PROVIDER_ID,
  QuickbooksAccountingProvider,
} from '../quickbooks-accounting-provider'

const ORG_ID = 'org1'
const GL_POSTING_ID = 'glpost1'
const DOC_NUMBER = 'AUXX-FUL-20260818'
/** What the core wrote to `GlPosting.requestId` at claim time. No run salt. */
const IDEMPOTENCY_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

/** The QuickBooks company's chart, in `list_quickbooks_accounts`' own shape. */
const CHART = [
  {
    id: '92',
    name: 'Inventory',
    fullyQualifiedName: 'Inventory',
    acctNum: '1310',
    accountType: 'Other Current Asset',
    classification: 'Asset',
    active: true,
  },
  {
    id: '79',
    name: 'GRNI',
    fullyQualifiedName: 'GRNI',
    acctNum: '2160',
    accountType: 'Other Current Liability',
    classification: 'Liability',
    active: true,
  },
  {
    id: '11',
    name: 'Retired',
    fullyQualifiedName: 'Retired',
    acctNum: '9999',
    accountType: 'Other Current Asset',
    classification: 'Asset',
    active: false,
  },
  {
    id: '50',
    name: 'Accounts Receivable (A/R)',
    fullyQualifiedName: 'Accounts Receivable (A/R)',
    acctNum: '1100',
    accountType: 'Accounts Receivable',
    classification: 'Asset',
    active: true,
  },
  {
    id: '60',
    name: 'Accounts Payable (A/P)',
    fullyQualifiedName: 'Accounts Payable (A/P)',
    acctNum: '2000',
    accountType: 'Accounts Payable',
    classification: 'Liability',
    active: true,
  },
]

/** The org's OWN chart - what a posting line's `accountCode` names. */
// Ids match what `baseInput`'s lines carry (`glAccountId`) - task 15's
// identity is what `resolveMappedAccounts` now keys on, not the code.
const OUR_CHART = [
  { id: 'acct_1310', code: '1310', name: 'Inventory', accountType: 'asset', isActive: true },
  { id: 'acct_2160', code: '2160', name: 'GRNI', accountType: 'liability', isActive: true },
  { id: 'acct_5090', code: '5090', name: 'PPV', accountType: 'expense', isActive: true },
  { id: 'acct_9999', code: '9999', name: 'Retired', accountType: 'asset', isActive: true },
  {
    id: 'acct_1100',
    code: '1100',
    name: 'Accounts Receivable',
    accountType: 'asset',
    subtype: 'accounts_receivable',
    isActive: true,
  },
  {
    id: 'acct_2000',
    code: '2000',
    name: 'Accounts Payable',
    accountType: 'liability',
    subtype: 'accounts_payable',
    isActive: true,
  },
]

/**
 * The confirmed map. `5090` is deliberately absent - it is the unmapped account
 * every "fails closed" test below leans on, and under `G19` unmapped is the
 * ONLY reason a code fails to resolve. There is no matching left to miss.
 */
const ACCOUNT_MAP = new Map([
  ['acct_1310', '92'],
  ['acct_2160', '79'],
  ['acct_9999', '11'],
  ['acct_1100', '50'],
  ['acct_2000', '60'],
])

function baseInput(over: Partial<PostEntryInput> = {}): PostEntryInput {
  return {
    organizationId: ORG_ID,
    glPostingId: GL_POSTING_ID,
    revision: 0,
    postingType: 'fulfillment',
    periodKey: '2026-08-18',
    txnDate: '2026-08-18',
    docNumber: DOC_NUMBER,
    idempotencyKey: IDEMPOTENCY_KEY,
    lines: [
      {
        glAccountId: 'acct_1310',
        accountCode: '1310',
        direction: 'debit',
        amount: 124999,
        sourceType: 'stock_movement',
        sourceId: 'mv1',
        sortOrder: 0,
      },
      {
        glAccountId: 'acct_2160',
        accountCode: '2160',
        direction: 'credit',
        amount: 124999,
        sourceType: 'stock_movement',
        sourceId: 'mv1',
        sortOrder: 1,
      },
    ],
    ...over,
  }
}

/**
 * Wire a `callTool` that answers the chart fetch, then defers to `handlers` for
 * the find/create pair. Everything unhandled returns an empty result set, which
 * is the "QuickBooks does not hold this entry" answer.
 */
function connect(handlers: Record<string, (inputs: any) => unknown> = {}) {
  const callTool = vi.fn(async (toolId: string, inputs: any) => {
    if (toolId === 'list_quickbooks_accounts') return { accounts: CHART }
    const handler = handlers[toolId]
    if (handler) return handler(inputs)
    if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
    return {}
  })
  resolveQuickbooksContext.mockResolvedValue({
    connected: true,
    context: {
      organizationId: ORG_ID,
      installationId: 'install1',
      connectionId: 'conn1',
      userId: 'user1',
      callTool,
    },
  })
  listChartAccounts.mockResolvedValue(ok(OUR_CHART))
  readQuickbooksAccountMap.mockResolvedValue(new Map(ACCOUNT_MAP))
  return callTool
}

function createCallOf(callTool: ReturnType<typeof vi.fn>) {
  return callTool.mock.calls.find(([toolId]) => toolId === 'create_quickbooks_journal_entry')?.[1]
}

const provider = new QuickbooksAccountingProvider()

beforeEach(() => {
  vi.clearAllMocks()
  getOrganizationSetting.mockResolvedValue(true)
  // Default: nothing synced. Tests that need a resolved counterparty override this.
  readQuickbooksIdField.mockResolvedValue(undefined)
})

describe('the exported surface', () => {
  it('registers under a stable id the app layer can name', () => {
    expect(QUICKBOOKS_PROVIDER_ID).toBe('quickbooks')
    expect(provider.id).toBe(QUICKBOOKS_PROVIDER_ID)
  })

  it('the factory builds an AccountingProvider without registering it', () => {
    const built = createQuickbooksAccountingProvider()
    expect(built.id).toBe(QUICKBOOKS_PROVIDER_ID)
    expect(typeof built.postEntry).toBe('function')
    expect(typeof built.resolveAccount).toBe('function')
  })
})

describe('gates - nothing pushed, and neither is an error', () => {
  it('reports disabled - not not_connected - when the org switch is off', async () => {
    // The two have different remedies: `disabled` is a switch somebody can flip,
    // `not_connected` is a missing integration. Merging them makes the fix
    // unguessable from the record.
    getOrganizationSetting.mockResolvedValue(false)
    const result = await provider.postEntry(baseInput())

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      status: 'disabled',
      externalId: '',
      providerId: 'quickbooks',
    })
    expect(resolveQuickbooksContext).not.toHaveBeenCalled()
  })

  it('stays internal when QuickBooks is not connected', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })
    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'not_connected', externalId: '' })
  })
})

describe('layer 2 - heal rather than re-post', () => {
  // The failure this exists for: a previous run posted and then crashed before
  // the id was recorded. Posting again would duplicate the entry.
  it('returns healed from a DocNumber hit and does NOT post', async () => {
    const callTool = connect({
      find_quickbooks_journal_entry: () => ({ journalEntries: [{ journalEntryId: '184' }] }),
    })

    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toEqual({
      status: 'healed',
      externalId: '184',
      providerId: 'quickbooks',
    })
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_journal_entry', expect.anything())
  })

  it('queries by the docNumber the core minted, not one of its own', async () => {
    const callTool = connect()
    await provider.postEntry(baseInput({ docNumber: 'AUXX-REV-202607-R1' }))

    expect(callTool).toHaveBeenCalledWith('find_quickbooks_journal_entry', {
      docNumber: 'AUXX-REV-202607-R1',
    })
  })
})

describe('the happy path', () => {
  it('posts and reports the provider id', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toEqual({
      status: 'posted',
      externalId: '201',
      providerId: 'quickbooks',
    })
    expect(callTool).toHaveBeenCalledWith(
      'create_quickbooks_journal_entry',
      expect.objectContaining({ docNumber: DOC_NUMBER, txnDate: '2026-08-18' })
    )
  })

  it('layer 3 - passes the idempotency key through VERBATIM as requestid', async () => {
    // A key derived here instead would differ between runs, and Intuit's
    // idempotency would never fire on the one case it exists for.
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput())

    expect(createCallOf(callTool)).toMatchObject({ requestId: IDEMPOTENCY_KEY })
  })

  it('layer 4 - stamps the forensic PrivateNote', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput())

    expect(createCallOf(callTool)?.privateNote).toBe(
      `auxx:gl:fulfillment:2026-08-18:${GL_POSTING_ID}`
    )
  })

  it('appends an entry memo after the stamp, never in front of it', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput({ memo: 'August fulfillment summary' }))

    expect(createCallOf(callTool)?.privateNote).toBe(
      `auxx:gl:fulfillment:2026-08-18:${GL_POSTING_ID} August fulfillment summary`
    )
  })

  it('resolves codes to QuickBooks account ids, in minor units and sort order', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput())

    expect(createCallOf(callTool)?.lines).toEqual([
      {
        amountMinor: 124999,
        postingType: 'Debit',
        accountId: '92',
        accountName: 'Inventory',
      },
      {
        amountMinor: 124999,
        postingType: 'Credit',
        accountId: '79',
        accountName: 'GRNI',
      },
    ])
  })

  it('fetches the chart once per entry, not once per line', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput())

    const chartCalls = callTool.mock.calls.filter(([id]) => id === 'list_quickbooks_accounts')
    expect(chartCalls).toHaveLength(1)
  })

  // Task 15 §2.3: a replay (`retry-export.ts`) hands `postEntry` the ORIGINAL
  // `ResolvedPostingLine`s straight off `GlPostingLine`, whose `accountCode`
  // is the FROZEN snapshot from when it posted - '1310' here, even though the
  // account was renumbered to '1150' in our own chart since. Resolution goes
  // by `glAccountId`, which the renumber never touched, so the replay resolves
  // and exports rather than refusing with "no account has the code 1310".
  it('resolves a replayed line by id, even though its frozen code no longer matches the chart', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })
    // `connect()` stubs `listChartAccounts` to `OUR_CHART` - override it with
    // the renumbered chart AFTER `connect()`, same id, different code.
    listChartAccounts.mockResolvedValue(
      ok([
        { id: 'acct_1310', code: '1150', name: 'Inventory', accountType: 'asset', isActive: true },
        OUR_CHART[1],
        OUR_CHART[2],
        OUR_CHART[3],
      ])
    )

    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'posted', externalId: '201' })
    expect(createCallOf(callTool)?.lines).toContainEqual({
      amountMinor: 124999,
      postingType: 'Debit',
      accountId: '92',
      accountName: 'Inventory',
    })
  })
})

// ── The counterparty (brief 13 §1) ──────────────────────────────────────────
//
// `resolveCounterparties` reads `subtype` off OUR chart, so only `acct_1100`
// (accounts_receivable) and `acct_2000` (accounts_payable) ever need one -
// every other line in this file, including the happy-path fixtures above,
// carries no counterparty and must stay unaffected.

/** A balanced two-line entry: one A/R or A/P leg, one plain offsetting leg. */
function counterpartyInput(
  over: Partial<PostEntryInput>,
  receivableLine: ResolvedPostingLine
): PostEntryInput {
  return baseInput({
    lines: [
      receivableLine,
      {
        glAccountId: 'acct_2160',
        accountCode: '2160',
        direction: receivableLine.direction === 'debit' ? 'credit' : 'debit',
        amount: receivableLine.amount,
        sourceType: receivableLine.sourceType,
        sourceId: receivableLine.sourceId,
        sortOrder: 1,
      },
    ],
    ...over,
  })
}

describe('the counterparty (brief 13 §1)', () => {
  it('an A/R line with a synced contact exports with entity: Customer', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '301' } }),
    })
    readQuickbooksIdField.mockResolvedValue('qbo_cust_1')

    const input = counterpartyInput(
      {},
      {
        glAccountId: 'acct_1100',
        accountCode: '1100',
        direction: 'debit',
        amount: 50_000,
        sourceType: 'invoice',
        sourceId: 'inv_1',
        sortOrder: 0,
        counterpartyType: 'customer',
        counterpartyId: 'contact_1',
      }
    )

    const result = await provider.postEntry(input)

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'posted', externalId: '301' })
    expect(readQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({ appFieldKey: 'qboCustomerId', recordId: 'contact:contact_1' })
    )
    expect(createCallOf(callTool)?.lines).toContainEqual(
      expect.objectContaining({
        accountId: '50',
        entity: { type: 'Customer', id: 'qbo_cust_1' },
      })
    )
  })

  it('an A/R line with an unsynced contact refuses with the sentence and configuration', async () => {
    connect()
    readQuickbooksIdField.mockResolvedValue(undefined)

    const input = counterpartyInput(
      {},
      {
        glAccountId: 'acct_1100',
        accountCode: '1100',
        direction: 'debit',
        amount: 50_000,
        sourceType: 'invoice',
        sourceId: 'inv_1',
        sortOrder: 0,
        counterpartyType: 'customer',
        counterpartyId: 'contact_1',
      }
    )

    const result = await provider.postEntry(input)
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('configuration')
    expect(error.message).toContain(DOC_NUMBER)
    expect(error.message).toContain('1100 Accounts Receivable')
    expect(error.message).toContain('has not been synced to QuickBooks yet')
  })

  it('an A/R line with NO counterparty at all refuses', async () => {
    connect()

    const input = counterpartyInput(
      {},
      {
        glAccountId: 'acct_1100',
        accountCode: '1100',
        direction: 'debit',
        amount: 50_000,
        sourceType: 'invoice',
        sourceId: 'inv_1',
        sortOrder: 0,
      }
    )

    const result = await provider.postEntry(input)
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('configuration')
    expect(error.message).toContain('1100 Accounts Receivable')
    expect(error.message).toContain('carries no contact')
    expect(readQuickbooksIdField).not.toHaveBeenCalled()
  })

  it('a revenue line with no counterparty is fine - only a receivable or payable subtype needs one', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '302' } }),
    })

    // The ordinary happy-path fixture: neither `acct_1310` nor `acct_2160`
    // carries a receivable or payable subtype.
    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'posted', externalId: '302' })
    expect(readQuickbooksIdField).not.toHaveBeenCalled()
    expect(
      createCallOf(callTool)?.lines.every((l: { entity?: unknown }) => l.entity === undefined)
    ).toBe(true)
  })

  it('a vendor line with no qboVendorId field provisioned refuses', async () => {
    connect()
    // The app has not provisioned `qboVendorId` yet (brief 13 DECIDED, unit
    // 1) - `readQuickbooksIdField` returns undefined for the FIELD, which
    // reads identically to "this vendor is unsynced".
    readQuickbooksIdField.mockResolvedValue(undefined)

    const input = counterpartyInput(
      {},
      {
        glAccountId: 'acct_2000',
        accountCode: '2000',
        direction: 'credit',
        amount: 50_000,
        sourceType: 'vendor_bill',
        sourceId: 'vb_1',
        sortOrder: 0,
        counterpartyType: 'vendor',
        counterpartyId: 'company_1',
      }
    )

    const result = await provider.postEntry(input)
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('configuration')
    expect(readQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({ appFieldKey: 'qboVendorId', recordId: 'company:company_1' })
    )
    expect(error.message).toContain('2000 Accounts Payable')
    expect(error.message).toContain('has not been synced to QuickBooks yet')
  })
})

describe('the duplicate-document-number net', () => {
  it('fault 6140 adopts the existing id and reports already_posted', async () => {
    let found = false
    const callTool = connect({
      find_quickbooks_journal_entry: () =>
        found ? { journalEntries: [{ journalEntryId: '312' }] } : { journalEntries: [] },
      create_quickbooks_journal_entry: () => {
        // Layer 2 saw nothing; the entry appeared between the query and the POST.
        found = true
        throw Object.assign(new Error('Duplicate Document Number Error'), {
          quickbooksFault: { code: '6140' },
        })
      },
    })

    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toEqual({
      status: 'already_posted',
      externalId: '312',
      providerId: 'quickbooks',
    })
    const creates = callTool.mock.calls.filter(([id]) => id === 'create_quickbooks_journal_entry')
    expect(creates).toHaveLength(1)
  })

  it('never reaches for allowduplicatedocnum', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => ({ journalEntry: { journalEntryId: '201' } }),
    })

    await provider.postEntry(baseInput())

    expect(JSON.stringify(callTool.mock.calls)).not.toContain('allowduplicatedocnum')
  })

  it('a duplicate fault with nothing behind it is data, never retried', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('Duplicate Document Number Error'), {
          quickbooksFault: { code: '6140' },
        })
      },
    })

    const result = await provider.postEntry(baseInput())
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('data')
    expect(error.retryable).toBe(false)
  })

  it('adopts an id when the POST landed but the response never came back', async () => {
    let posted = false
    connect({
      find_quickbooks_journal_entry: () =>
        posted ? { journalEntries: [{ journalEntryId: '404' }] } : { journalEntries: [] },
      create_quickbooks_journal_entry: () => {
        posted = true
        throw Object.assign(new Error('socket hang up'), { statusCode: 504 })
      },
    })

    const result = await provider.postEntry(baseInput())

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'already_posted', externalId: '404' })
  })
})

describe('failure classification', () => {
  it('never throws - every failure is a Result', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw new Error('boom')
      },
    })

    await expect(provider.postEntry(baseInput())).resolves.toBeDefined()
  })

  it('fault 2300 (imbalance) is data and is not retryable', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('debits and credits do not balance'), {
          quickbooksFault: { code: '2300' },
        })
      },
    })

    const result = await provider.postEntry(baseInput())
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error).toBeInstanceOf(ProviderPostError)
    expect(error.failureClass).toBe('data')
    expect(error.retryable).toBe(false)
    expect(error.faultCode).toBe('2300')
    expect(error.providerId).toBe('quickbooks')
  })

  it('a rate limit is transport and IS retryable', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('Rate limited by the provider; retry in ~30s.'), {
          statusCode: 429,
          code: 'RATE_LIMIT',
        })
      },
    })

    const result = await provider.postEntry(baseInput())
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('transport')
    expect(error.retryable).toBe(true)
  })

  it('classifies a rate limit from the message alone, since the code is lost at the Lambda boundary', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw new Error(
          'QuickBooks tool create_quickbooks_journal_entry failed: Rate limited by the provider; retry in ~30s.'
        )
      },
    })

    const result = await provider.postEntry(baseInput())

    expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
  })

  it('a 5xx is transport', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('QuickBooks error 503'), { statusCode: 503 })
      },
    })

    const result = await provider.postEntry(baseInput())

    expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
  })

  it('an expired connection is configuration and is not retried', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('organization connection expired or revoked.'), {
          statusCode: 401,
          code: 'CONNECTION_EXPIRED',
        })
      },
    })

    const result = await provider.postEntry(baseInput())
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('configuration')
    expect(error.retryable).toBe(false)
  })

  it('does not re-query after a configuration failure - it could not succeed either', async () => {
    const callTool = connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('connection expired'), { statusCode: 401 })
      },
    })

    await provider.postEntry(baseInput())

    const finds = callTool.mock.calls.filter(([id]) => id === 'find_quickbooks_journal_entry')
    expect(finds).toHaveLength(1)
  })

  it('the Lambda transport 500 is NOT read as a provider 5xx', async () => {
    // `invoke-lambda-executor.ts` re-derives a status only for its six known
    // codes and otherwise falls back to the transport status, which is ALWAYS
    // 500 on a throw. So `EXECUTION_ERROR` carries 500 too, and reading that as
    // a 5xx would make every unclassified failure retryable.
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('QuickBooks tool failed: Lambda execution failed'), {
          statusCode: 500,
          code: 'EXECUTION_ERROR',
        })
      },
    })

    const result = await provider.postEntry(baseInput())
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('data')
    expect(error.retryable).toBe(false)
  })

  it('a genuine provider 5xx still arrives as UPSTREAM_ERROR/502 and is transport', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw Object.assign(new Error('QuickBooks error 503'), {
          statusCode: 502,
          code: 'UPSTREAM_ERROR',
        })
      },
    })

    const result = await provider.postEntry(baseInput())

    expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
  })

  it('still classifies from the message when a bare error carries no code or status', async () => {
    // `callTool`'s `runtime_error` / `validation_error` paths throw bare Errors.
    connect({
      create_quickbooks_journal_entry: () => {
        throw new Error(
          'QuickBooks tool create_quickbooks_journal_entry runtime error: request timed out'
        )
      },
    })

    const result = await provider.postEntry(baseInput())

    expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
  })

  it('an unknown failure defaults to data, because retrying a landed write is the dangerous direction', async () => {
    connect({
      create_quickbooks_journal_entry: () => {
        throw new Error('something nobody has classified')
      },
    })

    const result = await provider.postEntry(baseInput())

    expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('data')
  })

  it('errors rather than claiming success when no id comes back', async () => {
    connect({ create_quickbooks_journal_entry: () => ({ journalEntry: {} }) })

    const result = await provider.postEntry(baseInput())

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('no journal entry id')
  })
})

describe('resolveAccount - the only place a code becomes a provider id', () => {
  it('resolves a code through the confirmed account map', async () => {
    connect()
    const result = await provider.resolveAccount(ORG_ID, '1310')
    expect(result._unsafeUnwrap()).toBe('92')
  })

  it('fails closed and names the code when nothing is mapped to it', async () => {
    connect()
    const result = await provider.resolveAccount(ORG_ID, '5090')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('5090')
    expect(result._unsafeUnwrapErr().message).toContain('not mapped')
  })

  it('refuses a mapping whose target has been deactivated', async () => {
    // 9999 IS mapped, to account 11, which is inactive. `G19` requires every
    // resolution to revalidate active status, and the remedy differs from
    // "unmapped" - so the message has to say which of the two it is.
    connect()
    const result = await provider.resolveAccount(ORG_ID, '9999')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('9999')
  })

  it('refuses a mapping whose target has vanished from the provider chart', async () => {
    connect()
    readQuickbooksAccountMap.mockResolvedValue(new Map([['acct_1310', 'deleted-99']]))

    const result = await provider.resolveAccount(ORG_ID, '1310')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('no longer exists')
  })

  it('refuses a mapping that has drifted into the wrong statement section', async () => {
    // The one failure no downstream reader can catch: an entry posted to a
    // revenue account instead of an asset one still BALANCES.
    connect()
    readQuickbooksAccountMap.mockResolvedValue(new Map([['acct_1310', '79']]))

    const result = await provider.resolveAccount(ORG_ID, '1310')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('liability')
  })

  it('does NOT fall back to matching account numbers', async () => {
    // The behaviour this replaced. `1310` appears in both charts with the same
    // number, and that must no longer be enough on its own - `G19` has no
    // fallback, because a renumber in QuickBooks would otherwise move where a
    // role posts with nothing to notice it.
    connect()
    readQuickbooksAccountMap.mockResolvedValue(new Map())

    const result = await provider.resolveAccount(ORG_ID, '1310')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('not mapped')
  })

  it('an unresolvable line code fails the post as configuration, before anything is sent', async () => {
    const callTool = connect()

    const result = await provider.postEntry(
      baseInput({
        lines: [
          {
            glAccountId: 'acct_1310',
            accountCode: '1310',
            direction: 'debit',
            amount: 100,
            sourceType: 'vendor_bill',
            sourceId: 'b1',
            sortOrder: 0,
          },
          {
            glAccountId: 'acct_5090',
            accountCode: '5090',
            direction: 'credit',
            amount: 100,
            sourceType: 'vendor_bill',
            sourceId: 'b1',
            sortOrder: 1,
          },
        ],
      })
    )
    const error = result._unsafeUnwrapErr() as ProviderPostError

    expect(error.failureClass).toBe('configuration')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('5090')
    expect(error.message).toContain('not mapped')
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_journal_entry', expect.anything())
    expect(callTool).not.toHaveBeenCalledWith('find_quickbooks_journal_entry', expect.anything())
  })
})

describe('createProviderAccount - the seam run backwards', () => {
  /** What `create_quickbooks_account` came back with, in the tool's own shape. */
  const CREATED = {
    id: '104',
    name: 'Card Clearing',
    fullyQualifiedName: 'Card Clearing',
    acctNum: '1200',
    accountType: 'Other Current Asset',
    accountSubType: 'OtherCurrentAssets',
    classification: 'Asset',
    active: true,
  }

  function connectCreate(over: Record<string, unknown> = {}) {
    return connect({
      create_quickbooks_account: () => ({
        account: CREATED,
        outcome: 'created',
        acctNumDropped: false,
        ...over,
      }),
    })
  }

  function createCall(callTool: ReturnType<typeof vi.fn>) {
    return callTool.mock.calls.find(([toolId]) => toolId === 'create_quickbooks_account')?.[1]
  }

  const input = {
    orgId: ORG_ID,
    glAccountId: 'acct_1200',
    name: 'Card Clearing',
    code: '1200',
    classification: 'asset' as const,
    subtype: null,
  }

  it('sends BOTH type columns, never a bare AccountType', () => {
    // 🛑 The one thing this method must not get wrong. QuickBooks accepts a type
    // alone and then files the account under a subtype of its own choosing -
    // probed 2026-09-10, an `Other Current Asset` came back as
    // `EmployeeCashAdvances` - and the subtype is what their reports group by.
    const callTool = connectCreate()
    return provider.createProviderAccount(input).then(() => {
      expect(createCall(callTool)).toMatchObject({
        name: 'Card Clearing',
        acctNum: '1200',
        accountType: 'Other Current Asset',
        accountSubType: 'OtherCurrentAssets',
      })
    })
  })

  it('translates OUR subtype into the provider type pair', async () => {
    const callTool = connectCreate()
    await provider.createProviderAccount({
      ...input,
      classification: 'liability',
      subtype: 'accounts_payable',
    })
    expect(createCall(callTool)).toMatchObject({
      accountType: 'Accounts Payable',
      accountSubType: 'AccountsPayable',
    })
  })

  it('omits acctNum entirely for an uncoded account rather than sending an empty one', async () => {
    const callTool = connectCreate()
    await provider.createProviderAccount({ ...input, code: null })
    expect(createCall(callTool)).not.toHaveProperty('acctNum')
  })

  it('returns the account in the same shape the chart read speaks', async () => {
    connectCreate()
    const result = await provider.createProviderAccount(input)
    expect(result._unsafeUnwrap().account).toEqual({
      id: '104',
      name: 'Card Clearing',
      fullyQualifiedName: 'Card Clearing',
      number: '1200',
      accountType: 'Other Current Asset',
      classification: 'asset',
      active: true,
    })
    expect(result._unsafeUnwrap().outcome).toBe('created')
    expect(result._unsafeUnwrap().numberDropped).toBe(false)
  })

  it('carries the tool `existing` / `acctNumDropped` answers through unchanged', async () => {
    connectCreate({
      account: { ...CREATED, acctNum: null },
      outcome: 'existing',
      acctNumDropped: true,
    })
    const result = await provider.createProviderAccount(input)
    expect(result._unsafeUnwrap().outcome).toBe('existing')
    expect(result._unsafeUnwrap().numberDropped).toBe(true)
    expect(result._unsafeUnwrap().account.number).toBeNull()
  })

  it('refuses an account whose classification it cannot read, rather than defaulting it', async () => {
    connectCreate({ account: { ...CREATED, classification: 'Nonsense' } })
    const result = await provider.createProviderAccount(input)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('unreadable classification')
  })

  it("turns the tool's refusal into an error naming the account", async () => {
    connect({
      create_quickbooks_account: () => {
        throw new Error('The name supplied already exists.')
      },
    })
    const result = await provider.createProviderAccount(input)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Card Clearing')
    expect(result._unsafeUnwrapErr().message).toContain('already exists')
  })

  it('refuses with nothing connected instead of reporting a silent success', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })
    const result = await provider.createProviderAccount(input)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('not connected')
  })
})
