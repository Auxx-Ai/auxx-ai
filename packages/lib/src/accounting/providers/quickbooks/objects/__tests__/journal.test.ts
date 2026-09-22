// packages/lib/src/accounting/providers/quickbooks/objects/__tests__/journal.test.ts
//
// The journal's counterparty resolution for a line with no counterparty: a
// summary batch's receivable rides the store's placeholder customer (91 §8.14);
// a transaction-mode journal still refuses it.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolvePlaceholderCustomer: vi.fn(),
  resolveMappedAccounts: vi.fn(),
  readQuickbooksIdField: vi.fn(),
}))

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/database')>()),
  database: { tag: 'db' },
}))
vi.mock('../customers', () => ({ resolvePlaceholderCustomer: h.resolvePlaceholderCustomer }))
vi.mock('../shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared')>()),
  resolveMappedAccounts: h.resolveMappedAccounts,
}))
vi.mock('../../identity-field', () => ({ readQuickbooksIdField: h.readQuickbooksIdField }))
vi.mock('../../upsert-customer', () => ({
  readQuickbooksCustomerFields: vi.fn(),
  upsertQuickbooksCustomer: vi.fn(),
}))
vi.mock('../../../../../resources/crud', () => ({ UnifiedCrudHandler: class {} }))

import { type ExportJournalPayload, exportJournalSchema } from '../../../../export/payloads/journal'
import type { ProviderPostError } from '../../../../ledger/types'
import type { QuickbooksToolContext } from '../../invoke-quickbooks-tool'
import { batchObject } from '../journal'

const TOOL = {
  organizationId: 'org_1',
  installationId: 'inst_1',
  connectionId: 'conn_1',
  userId: 'user_1',
  callTool: vi.fn(),
  accountMap: async () => new Map(),
} as unknown as QuickbooksToolContext
const CTX = { organizationId: 'org_1', connectionId: 'conn_1' }

function journal(over: Partial<ExportJournalPayload> = {}): ExportJournalPayload {
  return {
    v: 1,
    txnDate: '2026-09-14',
    docNumber: 'SUM-abc123',
    privateNote: 'auxx:sum:receipt:2026-09-14',
    currency: 'USD',
    totalMinor: 5000,
    lines: [
      {
        glAccountId: 'gl_clearing',
        accountCode: '1150',
        direction: 'debit',
        amountMinor: 5000,
        sortOrder: 0,
      },
      {
        glAccountId: 'gl_ar',
        accountCode: '1100',
        direction: 'credit',
        amountMinor: 5000,
        sortOrder: 1,
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveMappedAccounts.mockResolvedValue(
    ok({
      accounts: new Map([
        ['gl_clearing', { id: '35', fullyQualifiedName: 'Shopify Clearing' }],
        ['gl_ar', { id: '50', fullyQualifiedName: 'Accounts Receivable (A/R)' }],
      ]),
      chart: [
        { id: 'gl_clearing', code: '1150', name: 'Shopify Clearing', accountType: 'asset' },
        {
          id: 'gl_ar',
          code: '1100',
          name: 'Accounts Receivable',
          accountType: 'asset',
          subtype: 'accounts_receivable',
        },
      ],
    })
  )
  h.resolvePlaceholderCustomer.mockResolvedValue('qbo_placeholder_7')
})

describe('a receivable line with no counterparty', () => {
  it('rides the store placeholder customer on a summary batch', async () => {
    const built = await batchObject.build(TOOL, CTX, journal({ summary: { storeId: 'store_1' } }))

    const create = (built._unsafeUnwrap() as { create: { lines: Array<Record<string, unknown>> } })
      .create
    expect(h.resolvePlaceholderCustomer).toHaveBeenCalledWith({ tag: 'db' }, TOOL, 'store_1')
    expect(create.lines.find((l) => l.accountId === '50')?.entity).toEqual({
      type: 'Customer',
      id: 'qbo_placeholder_7',
    })
    // Only the receivable carries a name; the clearing line stays bare.
    expect(create.lines.find((l) => l.accountId === '35')?.entity).toBeUndefined()
  })

  it("carries the placeholder's own refusal when the summary names no store", async () => {
    h.resolvePlaceholderCustomer.mockRejectedValue(new Error('This document names no store'))

    const built = await batchObject.build(TOOL, CTX, journal({ summary: { storeId: null } }))

    const error = built._unsafeUnwrapErr() as ProviderPostError
    expect(error.failureClass).toBe('configuration')
    expect(error.message).toContain('This document names no store')
  })

  it('sends an unnetted summary - A/R on both sides - as balanced lines, each on the placeholder', async () => {
    h.resolveMappedAccounts.mockResolvedValue(
      ok({
        accounts: new Map([
          ['gl_clearing', { id: '35', fullyQualifiedName: 'Shopify Clearing' }],
          ['gl_ar', { id: '50', fullyQualifiedName: 'Accounts Receivable (A/R)' }],
          ['gl_rev', { id: '79', fullyQualifiedName: 'Sales' }],
        ]),
        chart: [
          { id: 'gl_clearing', code: '1150', name: 'Shopify Clearing', accountType: 'asset' },
          {
            id: 'gl_ar',
            code: '1100',
            name: 'Accounts Receivable',
            accountType: 'asset',
            subtype: 'accounts_receivable',
          },
          { id: 'gl_rev', code: '4000', name: 'Sales', accountType: 'income' },
        ],
      })
    )
    const payload = exportJournalSchema.parse(
      journal({
        totalMinor: 1400,
        lines: [
          {
            glAccountId: 'gl_ar',
            accountCode: '1100',
            direction: 'debit',
            amountMinor: 1000,
            sortOrder: 0,
          },
          {
            glAccountId: 'gl_rev',
            accountCode: '4000',
            direction: 'credit',
            amountMinor: 1000,
            sortOrder: 1,
          },
          {
            glAccountId: 'gl_clearing',
            accountCode: '1150',
            direction: 'debit',
            amountMinor: 400,
            sortOrder: 2,
          },
          {
            glAccountId: 'gl_ar',
            accountCode: '1100',
            direction: 'credit',
            amountMinor: 400,
            sortOrder: 3,
          },
        ],
        summary: { storeId: 'store_1' },
      })
    )

    const built = await batchObject.build(TOOL, CTX, payload)

    const create = (built._unsafeUnwrap() as { create: { lines: Array<Record<string, unknown>> } })
      .create
    const receivable = create.lines.filter((l) => l.accountId === '50')
    expect(receivable.map((l) => l.postingType)).toEqual(['Debit', 'Credit'])
    expect(receivable.every((l) => (l.entity as { id: string }).id === 'qbo_placeholder_7')).toBe(
      true
    )
    expect(h.resolvePlaceholderCustomer).toHaveBeenCalledTimes(1)
  })

  it('still refuses outside a summary batch', async () => {
    const built = await batchObject.build(TOOL, CTX, journal())

    const error = built._unsafeUnwrapErr() as ProviderPostError
    expect(error.message).toContain('carries no contact')
    expect(h.resolvePlaceholderCustomer).not.toHaveBeenCalled()
  })
})
