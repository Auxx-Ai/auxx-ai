// packages/lib/src/money/quickbooks/__tests__/post-journal-entry.test.ts
//
// The four idempotency layers are the whole point of this module — a
// double-posted journal entry silently misstates the financial statements, with
// no invoice or payment to reconcile against. Each layer gets its own test, plus
// the failure mode that motivates layer 2 (posted-then-crashed-before-write-back).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const readQuickbooksIdField = vi.fn()
const writeQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: (...a: unknown[]) => writeQuickbooksIdField(...a),
}))

const getOrganizationSetting = vi.fn()
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: (...a: unknown[]) => getOrganizationSetting(...a),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

vi.mock('../../../resources/crud', () => ({
  UnifiedCrudHandler: class {},
}))

import { buildDocNumber, buildRequestId, postJournalEntry } from '../post-journal-entry'

const ORG_ID = 'org1'
const GL_POSTING_ID = 'glpost1'

const LINES = [
  { amountMinor: 124999, postingType: 'Debit' as const, accountId: '92' },
  { amountMinor: 124999, postingType: 'Credit' as const, accountId: '79' },
]

function baseInput(over: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    glPostingInstanceId: GL_POSTING_ID,
    postingType: 'fulfillment' as const,
    periodKey: '2026-08-18',
    lines: LINES,
    txnDate: '2026-08-18',
    ...over,
  }
}

function connect(callTool = vi.fn()) {
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

beforeEach(() => {
  vi.clearAllMocks()
  getOrganizationSetting.mockResolvedValue(true)
  readQuickbooksIdField.mockResolvedValue(undefined)
})

describe('buildDocNumber', () => {
  it('is deterministic for the same posting identity', () => {
    expect(buildDocNumber('fulfillment', '2026-08-18')).toBe('AUXX-FUL-20260818')
    expect(buildDocNumber('fulfillment', '2026-08-18')).toBe('AUXX-FUL-20260818')
  })

  it('fits QuickBooks 21-character DocNumber limit for every posting type', () => {
    const types = [
      'fulfillment',
      'payout',
      'build',
      'month_end_deferral',
      'month_end_reversal',
      'month_end_inventory',
    ] as const
    for (const type of types) {
      expect(buildDocNumber(type, '2026-08-18').length).toBeLessThanOrEqual(21)
      expect(buildDocNumber(type, '2026-08').length).toBeLessThanOrEqual(21)
    }
  })

  it('distinguishes posting types in the same period', () => {
    expect(buildDocNumber('payout', '2026-08-18')).not.toBe(
      buildDocNumber('fulfillment', '2026-08-18')
    )
  })
})

describe('buildRequestId', () => {
  it('is deterministic — a random key would guarantee nothing on retry', () => {
    const args = {
      organizationId: ORG_ID,
      postingType: 'fulfillment' as const,
      periodKey: '2026-08-18',
      glPostingInstanceId: GL_POSTING_ID,
    }
    expect(buildRequestId(args)).toBe(buildRequestId(args))
  })

  it('fits the 50-character QuickBooks limit', () => {
    expect(
      buildRequestId({
        organizationId: ORG_ID,
        postingType: 'month_end_inventory',
        periodKey: '2026-08',
        glPostingInstanceId: GL_POSTING_ID,
      }).length
    ).toBeLessThanOrEqual(50)
  })

  it('differs when the posting row is re-created, so a corrected entry is a new request', () => {
    const a = buildRequestId({
      organizationId: ORG_ID,
      postingType: 'fulfillment',
      periodKey: '2026-08-18',
      glPostingInstanceId: 'glpost1',
    })
    const b = buildRequestId({
      organizationId: ORG_ID,
      postingType: 'fulfillment',
      periodKey: '2026-08-18',
      glPostingInstanceId: 'glpost2',
    })
    expect(a).not.toBe(b)
  })
})

describe('postJournalEntry — gates', () => {
  it('is disabled unless the setting is on', async () => {
    getOrganizationSetting.mockResolvedValue(false)
    const result = await postJournalEntry(baseInput())
    expect(result.status).toBe('disabled')
    expect(resolveQuickbooksContext).not.toHaveBeenCalled()
  })

  it('reports not_connected without posting', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })
    const result = await postJournalEntry(baseInput())
    expect(result.status).toBe('not_connected')
  })
})

describe('postJournalEntry — layer 1, the id map', () => {
  it('does not post when an id is already stored', async () => {
    readQuickbooksIdField.mockResolvedValue('qbo-je-77')
    const callTool = connect()

    const result = await postJournalEntry(baseInput())

    expect(result).toMatchObject({ status: 'already_posted', qboJournalEntryId: 'qbo-je-77' })
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe('postJournalEntry — layer 2, heal rather than re-post', () => {
  // The failure this exists for: a previous run posted and then crashed before
  // writing the id back. Posting again would duplicate the entry.
  it('heals the id map from a DocNumber hit instead of posting again', async () => {
    const callTool = connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') {
          return { journalEntries: [{ journalEntryId: '184' }] }
        }
        throw new Error('should not have been called')
      })
    )

    const result = await postJournalEntry(baseInput())

    expect(result).toMatchObject({ status: 'healed', qboJournalEntryId: '184' })
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_journal_entry', expect.anything())
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '184', appFieldKey: 'qboJournalEntryId' })
    )
  })
})

describe('postJournalEntry — the happy path', () => {
  it('posts, then writes the id back', async () => {
    const callTool = connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
        return { journalEntry: { journalEntryId: '201' } }
      })
    )

    const result = await postJournalEntry(baseInput())

    expect(result).toMatchObject({
      status: 'posted',
      qboJournalEntryId: '201',
      docNumber: 'AUXX-FUL-20260818',
    })
    expect(writeQuickbooksIdField).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '201',
        entityType: 'gl_posting',
        entityInstanceId: GL_POSTING_ID,
      })
    )
  })

  it('sends a deterministic requestid and the forensic PrivateNote stamp', async () => {
    const callTool = connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
        return { journalEntry: { journalEntryId: '201' } }
      })
    )

    await postJournalEntry(baseInput())

    const createCall = callTool.mock.calls.find(
      ([toolId]) => toolId === 'create_quickbooks_journal_entry'
    )
    expect(createCall?.[1]).toMatchObject({
      docNumber: 'AUXX-FUL-20260818',
      privateNote: `auxx:gl:fulfillment:2026-08-18:${GL_POSTING_ID}`,
      txnDate: '2026-08-18',
      requestId: buildRequestId({
        organizationId: ORG_ID,
        postingType: 'fulfillment',
        periodKey: '2026-08-18',
        glPostingInstanceId: GL_POSTING_ID,
      }),
    })
  })

  it('passes lines through in minor units — conversion belongs to the app', async () => {
    const callTool = connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
        return { journalEntry: { journalEntryId: '201' } }
      })
    )

    await postJournalEntry(baseInput())

    const createCall = callTool.mock.calls.find(
      ([toolId]) => toolId === 'create_quickbooks_journal_entry'
    )
    expect((createCall?.[1] as { lines: typeof LINES }).lines[0]!.amountMinor).toBe(124999)
  })
})

describe('postJournalEntry — failures', () => {
  it('never throws, and keeps the QuickBooks fault code', async () => {
    const fault = Object.assign(new Error('debits and credits do not balance'), {
      quickbooksFault: { code: '2300' },
    })
    connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
        throw fault
      })
    )

    const result = await postJournalEntry(baseInput())

    // 2300 will never succeed on retry; a 5xx would. Keeping the code is what
    // lets the caller tell those apart.
    expect(result).toMatchObject({ status: 'error', faultCode: '2300' })
    expect(result.error).toContain('balance')
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })

  it('errors rather than claiming success when no id comes back', async () => {
    connect(
      vi.fn(async (toolId: string) => {
        if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: [] }
        return { journalEntry: {} }
      })
    )

    const result = await postJournalEntry(baseInput())

    expect(result.status).toBe('error')
    expect(writeQuickbooksIdField).not.toHaveBeenCalled()
  })
})
