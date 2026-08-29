// packages/lib/src/money/quickbooks/__tests__/quickbooks-accounting-provider.test.ts
//
// The idempotency ladder is the whole point of this adapter - a double-posted
// journal entry silently misstates the financial statements, with no invoice or
// payment to reconcile against. Layer 1 now lives on the `GlPosting` unique
// index and belongs to the core, so what is exercised here is layers 2, 3 and 4,
// the duplicate-document-number net under the create, and the retry
// classification the core routes on.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationSetting = vi.fn()
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: (...a: unknown[]) => getOrganizationSetting(...a),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

import type { PostEntryInput } from '../../../postings/types'
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

const CHART = [
  { id: '92', name: 'Inventory', fullyQualifiedName: 'Inventory', acctNum: '1310', active: true },
  { id: '79', name: 'GRNI', fullyQualifiedName: 'GRNI', acctNum: '2160', active: true },
  { id: '11', name: 'Retired', fullyQualifiedName: 'Retired', acctNum: '9999', active: false },
]

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
        accountCode: '1310',
        direction: 'debit',
        amount: 124999,
        sourceType: 'stock_movement',
        sourceId: 'mv1',
        sortOrder: 0,
      },
      {
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
  return callTool
}

function createCallOf(callTool: ReturnType<typeof vi.fn>) {
  return callTool.mock.calls.find(([toolId]) => toolId === 'create_quickbooks_journal_entry')?.[1]
}

const provider = new QuickbooksAccountingProvider()

beforeEach(() => {
  vi.clearAllMocks()
  getOrganizationSetting.mockResolvedValue(true)
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
  it('resolves an account code by AcctNum', async () => {
    connect()
    const result = await provider.resolveAccount(ORG_ID, '1310')
    expect(result._unsafeUnwrap()).toBe('92')
  })

  it('fails closed and names the code when nothing matches', async () => {
    connect()
    const result = await provider.resolveAccount(ORG_ID, '5090')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('5090')
  })

  it('ignores inactive accounts rather than posting to one', async () => {
    connect()
    const result = await provider.resolveAccount(ORG_ID, '9999')
    expect(result.isErr()).toBe(true)
  })

  it('refuses ambiguity instead of taking the first hit', async () => {
    resolveQuickbooksContext.mockResolvedValue({
      connected: true,
      context: {
        organizationId: ORG_ID,
        installationId: 'i',
        connectionId: 'c',
        userId: 'u',
        callTool: vi.fn(async () => ({
          accounts: [
            { id: '1', name: 'A', fullyQualifiedName: 'A', acctNum: '1310', active: true },
            { id: '2', name: 'B', fullyQualifiedName: 'B', acctNum: '1310', active: true },
          ],
        })),
      },
    })

    const result = await provider.resolveAccount(ORG_ID, '1310')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('matches 2 QuickBooks accounts')
  })

  it('an unresolvable line code fails the post as configuration, before anything is sent', async () => {
    const callTool = connect()

    const result = await provider.postEntry(
      baseInput({
        lines: [
          {
            accountCode: '1310',
            direction: 'debit',
            amount: 100,
            sourceType: 'vendor_bill',
            sourceId: 'b1',
            sortOrder: 0,
          },
          {
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
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_journal_entry', expect.anything())
    expect(callTool).not.toHaveBeenCalledWith('find_quickbooks_journal_entry', expect.anything())
  })
})
