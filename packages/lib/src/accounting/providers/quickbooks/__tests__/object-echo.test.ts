// packages/lib/src/accounting/providers/quickbooks/__tests__/object-echo.test.ts
//
// 93 A2 + A3 on a native object: the create's (or the pre-find's) own answer
// rides back as the echo, and one send reads the account map and our chart once.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChartAccounts = vi.fn()
vi.mock('../../../ledger/roles/role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

const getCachedProviderChart = vi.fn()
vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  getCachedProviderChart: (...a: unknown[]) => getCachedProviderChart(...a),
}))

vi.mock('../objects/customers', () => ({ resolveCustomer: async () => 'qbo-cust-1' }))
vi.mock('../objects/items', () => ({
  resolveItemsForAccounts: async (_tool: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, 'qbo-item-1'])),
}))

import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { send } from '../objects/invoice'

const OUR_CHART = [
  { id: 'acct_4000', code: '4000', name: 'Sales', accountType: 'revenue', isActive: true },
]
const PROVIDER_CHART = [
  {
    id: '40',
    name: 'Sales',
    fullyQualifiedName: 'Sales',
    number: '4000',
    accountType: 'Income',
    classification: 'revenue',
    active: true,
    parentId: null,
  },
]

const PAYLOAD = {
  v: 1,
  txnDate: '2026-09-01',
  docNumber: 'INV-1001',
  privateNote: 'auxx:gl:invoice:1',
  currency: 'USD',
  totalMinor: 12345,
  customer: { type: 'customer', id: 'contact_1' },
  storeId: null,
  lines: [{ glAccountId: 'acct_4000', accountCode: '4000', amountMinor: 12345, sortOrder: 0 }],
}

/** The tool contract `requireToolInputs` reads, for the find and the create. */
function schemaFor(id: string, fields: string[]) {
  return {
    id,
    inputsJsonSchema: { properties: Object.fromEntries(fields.map((f) => [f, {}])) },
  }
}

function toolContext(handlers: Record<string, (inputs: unknown) => unknown>) {
  const callTool = vi.fn(async (toolId: string, inputs: unknown) => handlers[toolId]?.(inputs))
  const accountMap = vi.fn(async () => new Map([['acct_4000', '40']]))
  const tool = {
    organizationId: 'org1',
    installationId: 'install1',
    connectionId: 'conn1',
    userId: 'user1',
    realmId: 'realm1',
    tools: [
      schemaFor('find_quickbooks_invoice', ['docNumber']),
      schemaFor('create_quickbooks_invoice', ['customerId', 'lines']),
    ],
    callTool,
    accountMap,
  } as unknown as QuickbooksToolContext
  return { tool, callTool, accountMap }
}

function sendInvoice(tool: QuickbooksToolContext) {
  return send(
    tool,
    { organizationId: 'org1', connectionId: 'conn1' },
    { objectType: 'invoice', payload: PAYLOAD, idempotencyKey: 'key-1' }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listChartAccounts.mockResolvedValue(ok(OUR_CHART))
  getCachedProviderChart.mockResolvedValue({ companyId: 'realm1', accounts: PROVIDER_CHART })
})

describe('invoice send', () => {
  it("echoes the create's docNumber, total in minor units and sync token", async () => {
    const { tool } = toolContext({
      find_quickbooks_invoice: () => ({ invoices: [] }),
      create_quickbooks_invoice: () => ({
        invoiceId: '501',
        docNumber: 'INV-1001',
        totalAmt: 123.45,
        syncToken: '0',
      }),
    })

    const result = (await sendInvoice(tool))._unsafeUnwrap()

    expect(result).toMatchObject({ status: 'sent', externalId: '501', remoteVersion: '0' })
    expect(result.echo).toEqual({ docNumber: 'INV-1001', totalMinor: 12345, remoteVersion: '0' })
  })

  it("echoes the pre-create find's answer when it adopts an existing invoice", async () => {
    const { tool, callTool } = toolContext({
      find_quickbooks_invoice: () => ({
        invoices: [{ invoiceId: '77', docNumber: 'INV-1001', totalAmt: 99, syncToken: '3' }],
      }),
    })

    const result = (await sendInvoice(tool))._unsafeUnwrap()

    expect(result).toMatchObject({ status: 'already_exists', externalId: '77' })
    // A different total than we froze: `send.ts` refuses it exactly as a read-back would.
    expect(result.echo).toEqual({ docNumber: 'INV-1001', totalMinor: 9900, remoteVersion: '3' })
    expect(callTool).not.toHaveBeenCalledWith('create_quickbooks_invoice', expect.anything())
  })

  it('carries no echo when the create answers nothing to compare', async () => {
    const { tool } = toolContext({
      find_quickbooks_invoice: () => ({ invoices: [] }),
      create_quickbooks_invoice: () => ({ invoiceId: '501' }),
    })

    const result = (await sendInvoice(tool))._unsafeUnwrap()

    expect(result.status).toBe('sent')
    expect(result.echo).toBeUndefined()
  })

  it('reads the account map and our chart once per send', async () => {
    const { tool, accountMap } = toolContext({
      find_quickbooks_invoice: () => ({ invoices: [] }),
      create_quickbooks_invoice: () => ({ invoiceId: '501', totalAmt: 123.45 }),
    })

    await sendInvoice(tool)

    expect(accountMap).toHaveBeenCalledTimes(1)
    expect(listChartAccounts).toHaveBeenCalledTimes(1)
  })
})
