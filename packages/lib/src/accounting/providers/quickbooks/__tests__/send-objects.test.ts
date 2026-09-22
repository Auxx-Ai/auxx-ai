// packages/lib/src/accounting/providers/quickbooks/__tests__/send-objects.test.ts
//
// 93 D2/D3: a set of native objects in one batch query and one batch create, with
// every per-row verdict the single send would reach - the adopt, the echo, the
// 6140/6240 net and the transport class on an unanswered item.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOrganizationSetting = vi.fn()
vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: (...a: unknown[]) => getOrganizationSetting(...a),
}))

vi.mock('../../book-connections', () => ({
  readPinnedAccountingConnection: async () => ({
    connectionId: 'conn1',
    credentialId: 'cred1',
    companyId: 'realm1',
    appInstallationId: 'install1',
  }),
}))

const resolveQuickbooksContext = vi.fn()
vi.mock('../invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: (...a: unknown[]) => resolveQuickbooksContext(...a),
}))

const listChartAccounts = vi.fn()
vi.mock('../../../ledger/roles/role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

const getCachedProviderChart = vi.fn()
vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  getCachedProviderChart: (...a: unknown[]) => getCachedProviderChart(...a),
}))

// The stored-id reads behind the customer, vendor and item resolvers.
const readQuickbooksIdField = vi.fn()
vi.mock('../identity-field', () => ({
  findAppField: vi.fn(),
  readQuickbooksIdField: (...a: unknown[]) => readQuickbooksIdField(...a),
  writeQuickbooksIdField: vi.fn(),
}))
vi.mock('../upsert-customer', () => ({
  upsertQuickbooksCustomer: vi.fn(),
  readQuickbooksCustomerFields: vi.fn(),
}))

// A payment's dependency: its invoice's live batch, already sent.
const readLiveBatchMemberships = vi.fn()
vi.mock('../../../export/queue-reads', () => ({
  readLiveBatchMemberships: (...a: unknown[]) => readLiveBatchMemberships(...a),
}))
vi.mock('@auxx/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auxx/database')>()
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where']) chain[method] = () => chain
  chain.limit = async () => [
    {
      state: 'sent',
      objectType: 'invoice',
      providerObjectId: 'qbo-inv-9',
      payload: { docNumber: 'INV-9' },
    },
  ]
  return { ...actual, database: { select: () => chain } }
})

import { ProviderPostError } from '../../../ledger/types'
import { QuickbooksAccountingProvider } from '../quickbooks-accounting-provider'
import { BATCH_TOOL, batchItemIds, batchRequestId } from '../send-objects'

const OUR_CHART = [
  { id: 'acct_4000', code: '4000', name: 'Sales', accountType: 'revenue', isActive: true },
  { id: 'acct_1000', code: '1000', name: 'Bank', accountType: 'asset', isActive: true },
  { id: 'acct_1310', code: '1310', name: 'Inventory', accountType: 'asset', isActive: true },
  { id: 'acct_2000', code: '2000', name: 'AP', accountType: 'liability', isActive: true },
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
  {
    id: '10',
    name: 'Bank',
    fullyQualifiedName: 'Bank',
    number: '1000',
    accountType: 'Bank',
    classification: 'asset',
    active: true,
    parentId: null,
  },
  {
    id: '92',
    name: 'Inventory',
    fullyQualifiedName: 'Inventory',
    number: '1310',
    accountType: 'Other Current Asset',
    classification: 'asset',
    active: true,
    parentId: null,
  },
  {
    id: '60',
    name: 'AP',
    fullyQualifiedName: 'AP',
    number: '2000',
    accountType: 'Other Current Liability',
    classification: 'liability',
    active: true,
    parentId: null,
  },
]
const ACCOUNT_MAP = new Map([
  ['acct_4000', '40'],
  ['acct_1000', '10'],
  ['acct_1310', '92'],
  ['acct_2000', '60'],
])

const base = { v: 1, txnDate: '2026-09-01', privateNote: 'auxx:gl:x', currency: 'USD' }
const invoice = (docNumber: string, contact = 'contact_1') => ({
  objectType: 'invoice',
  idempotencyKey: `key-${docNumber}`,
  payload: {
    ...base,
    docNumber,
    totalMinor: 12345,
    customer: { type: 'customer', id: contact },
    storeId: null,
    lines: [{ glAccountId: 'acct_4000', accountCode: '4000', amountMinor: 12345, sortOrder: 0 }],
  },
})
const journal = (docNumber: string) => ({
  objectType: 'journal',
  idempotencyKey: `key-${docNumber}`,
  payload: {
    ...base,
    docNumber,
    totalMinor: 500,
    lines: [
      {
        glAccountId: 'acct_1310',
        accountCode: '1310',
        direction: 'debit',
        amountMinor: 500,
        sortOrder: 0,
      },
      {
        glAccountId: 'acct_2000',
        accountCode: '2000',
        direction: 'credit',
        amountMinor: 500,
        sortOrder: 1,
      },
    ],
  },
})
const payment = (docNumber: string) => ({
  objectType: 'payment',
  idempotencyKey: `key-${docNumber}`,
  payload: {
    ...base,
    docNumber,
    totalMinor: 12345,
    amountMinor: 12345,
    customer: { type: 'customer', id: 'contact_1' },
    appliesTo: { glPostingId: 'gp_inv' },
    depositTo: { glAccountId: 'acct_1000', accountCode: '1000' },
  },
})
const vendorCredit = (docNumber: string) => ({
  objectType: 'vendor_credit',
  idempotencyKey: `key-${docNumber}`,
  payload: {
    ...base,
    docNumber,
    totalMinor: 700,
    vendor: { type: 'vendor', id: 'company_1' },
    lines: [{ glAccountId: 'acct_2000', accountCode: '2000', amountMinor: 700 }],
  },
})

const CTX = { organizationId: 'org1', connectionId: 'conn1' }
const provider = new QuickbooksAccountingProvider()

type Item = {
  bId: string
  operation: string
  object: string
  docNumbers?: string[]
  input?: Record<string, unknown>
}
type Answer = (item: Item) => Record<string, unknown>

/** Every created object answers the single tool's shape; `existing` is what a query finds. */
function created(item: Item) {
  const docNumber = item.input?.docNumber as string | undefined
  if (item.object === 'journal')
    return {
      journalEntry: { journalEntryId: `je-${docNumber}`, docNumber, totalAmt: 5, syncToken: '0' },
    }
  if (item.object === 'payment') return { paymentId: 'pay-1', totalAmt: 123.45, syncToken: '0' }
  return { invoiceId: `id-${docNumber}`, docNumber, totalAmt: 123.45, syncToken: '0' }
}

function connect(
  options: {
    existing?: Record<string, Record<string, unknown>>
    onCreate?: (item: Item) => Record<string, unknown> | 'omit'
    createThrows?: Error
    batchDeployed?: boolean
  } = {}
) {
  const listField: Record<string, string> = { invoice: 'invoices', journal: 'journalEntries' }
  const answerQuery: Answer = (item) => {
    const result: Record<string, unknown> = {}
    for (const docNumber of item.docNumbers ?? []) {
      const hit = options.existing?.[`${item.object}:${docNumber}`]
      result[docNumber] = { [listField[item.object] as string]: hit ? [hit] : [] }
    }
    return { bId: item.bId, operation: 'query', object: item.object, ok: true, result }
  }
  const callTool = vi.fn(
    async (toolId: string, inputs: Record<string, unknown>): Promise<unknown> => {
      if (toolId === BATCH_TOOL) {
        const items = inputs.items as Item[]
        if (items[0]?.operation === 'query') return { items: items.map(answerQuery) }
        if (options.createThrows) throw options.createThrows
        return {
          items: items.flatMap((item) => {
            const custom = options.onCreate?.(item)
            if (custom === 'omit') return []
            return [
              custom ?? {
                bId: item.bId,
                operation: 'create',
                object: item.object,
                ok: true,
                result: created(item),
              },
            ]
          }),
        }
      }
      if (toolId === 'find_quickbooks_vendor_credit') return { vendorCredits: [] }
      if (toolId === 'create_quickbooks_vendor_credit')
        return { vendorCreditId: 'vc-1', docNumber: 'VC-1', totalAmt: 7, syncToken: '0' }
      return {}
    }
  )
  const schema = (id: string, fields: string[]) => ({
    id,
    inputsJsonSchema: { properties: Object.fromEntries(fields.map((f) => [f, {}])) },
  })
  resolveQuickbooksContext.mockResolvedValue({
    connected: true,
    context: {
      organizationId: 'org1',
      installationId: 'install1',
      connectionId: 'conn1',
      userId: 'user1',
      realmId: 'realm1',
      tools: [
        ...(options.batchDeployed === false ? [] : [schema(BATCH_TOOL, ['requestId', 'items'])]),
        schema('find_quickbooks_invoice', ['docNumber']),
        schema('create_quickbooks_invoice', ['customerId', 'lines']),
        schema('find_quickbooks_vendor_credit', ['docNumber']),
        schema('create_quickbooks_vendor_credit', ['vendorId', 'lines']),
      ],
      callTool,
      accountMap: async () => ACCOUNT_MAP,
    },
  })
  const batchCalls = () =>
    callTool.mock.calls
      .filter(([toolId]) => toolId === BATCH_TOOL)
      .map(([, inputs]) => inputs as { requestId?: string; items: Item[] })
  return { callTool, batchCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
  getOrganizationSetting.mockResolvedValue(true)
  listChartAccounts.mockResolvedValue(ok(OUR_CHART))
  getCachedProviderChart.mockResolvedValue({ companyId: 'realm1', accounts: PROVIDER_CHART })
  readLiveBatchMemberships.mockResolvedValue([{ batchId: 'inv_batch', glPostingId: 'gp_inv' }])
  readQuickbooksIdField.mockImplementation(
    async ({ appFieldKey }: { appFieldKey: string }) =>
      ({ qboCustomerId: 'qbo-cust-1', qboItemId: 'qbo-item-1', qboVendorId: 'qbo-vendor-1' })[
        appFieldKey
      ]
  )
})

const send = (inputs: ReturnType<typeof invoice>[]) => provider.sendObjects(CTX, inputs as never)

describe('one query, one create', () => {
  it('sends a mixed set in two batch calls, resolving each account and customer once', async () => {
    const { callTool, batchCalls } = connect()

    const results = (
      await send([invoice('INV-1'), invoice('INV-2'), journal('J-1'), payment('PAY-1')] as never)
    )._unsafeUnwrap()

    const [query, create] = batchCalls()
    expect(batchCalls()).toHaveLength(2)
    expect(query?.items.map((item) => [item.object, item.docNumbers])).toEqual([
      ['invoice', ['INV-1', 'INV-2']],
      ['journal', ['J-1']],
    ])
    expect(query?.requestId).toBeUndefined()
    expect(create?.items.map((item) => item.object)).toEqual([
      'invoice',
      'invoice',
      'journal',
      'payment',
    ])
    expect(create?.items.every((item) => !('requestId' in (item.input ?? {})))).toBe(true)
    expect(create?.items[3]?.input).toMatchObject({
      invoiceId: 'qbo-inv-9',
      depositToAccountId: '10',
    })
    expect(callTool.mock.calls.every(([toolId]) => toolId === BATCH_TOOL)).toBe(true)

    expect(results.map((r) => r._unsafeUnwrap().status)).toEqual(['sent', 'sent', 'sent', 'sent'])
    expect(results[0]?._unsafeUnwrap()).toMatchObject({
      externalId: 'id-INV-1',
      tenantId: 'realm1',
      echo: { docNumber: 'INV-1', totalMinor: 12345, remoteVersion: '0' },
    })
    expect(results[2]?._unsafeUnwrap()).toMatchObject({ externalId: 'je-J-1' })

    expect(listChartAccounts).toHaveBeenCalledTimes(1)
    expect(getCachedProviderChart).toHaveBeenCalledTimes(1)
    const customerReads = readQuickbooksIdField.mock.calls.filter(
      ([args]) => (args as { appFieldKey: string }).appFieldKey === 'qboCustomerId'
    )
    expect(customerReads).toHaveLength(1)
  })

  it('adopts a DocNumber the query finds, with its echo, and does not create it', async () => {
    const { batchCalls } = connect({
      existing: {
        'invoice:INV-1': { invoiceId: '77', docNumber: 'INV-1', totalAmt: 99, syncToken: '3' },
      },
    })

    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toEqual({
      status: 'already_exists',
      externalId: '77',
      remoteVersion: '3',
      providerId: 'quickbooks',
      tenantId: 'realm1',
      echo: { docNumber: 'INV-1', totalMinor: 9900, remoteVersion: '3' },
    })
    expect(batchCalls()[1]?.items.map((item) => item.input?.docNumber)).toEqual(['INV-2'])
  })

  it('makes no create call when the query finds every one', async () => {
    const { batchCalls } = connect({
      existing: {
        'invoice:INV-1': { invoiceId: '77', docNumber: 'INV-1', totalAmt: 123.45, syncToken: '3' },
      },
    })

    await send([invoice('INV-1')])

    expect(batchCalls()).toHaveLength(1)
  })

  it('answers a payment waiting on its invoice without sending it', async () => {
    readLiveBatchMemberships.mockResolvedValue([])
    const { batchCalls } = connect()

    const results = (await send([payment('PAY-1'), invoice('INV-1')] as never))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toMatchObject({ status: 'waiting' })
    expect(batchCalls()[1]?.items.map((item) => item.object)).toEqual(['invoice'])
  })
})

describe('per-item faults, classified as the single path classifies them', () => {
  const fault =
    (code: string, sdkCode = 'UPSTREAM_ERROR', message = 'Duplicate Document Number Error') =>
    (item: Item) =>
      item.input?.docNumber === 'INV-2'
        ? {
            bId: item.bId,
            operation: 'create',
            object: item.object,
            ok: false,
            error: {
              code: sdkCode,
              message,
              fault: { type: 'ValidationFault', code, message, detail: null, element: null },
            },
          }
        : undefined

  it('adopts on 6140 when the net query finds the object', async () => {
    let queries = 0
    const { callTool } = connect({ onCreate: fault('6140') as never })
    const inner = callTool.getMockImplementation()
    callTool.mockImplementation(async (toolId, inputs) => {
      const items = (inputs as { items?: Item[] }).items
      if (toolId === BATCH_TOOL && items?.[0]?.operation === 'query' && ++queries === 2)
        return {
          items: items.map((item) => ({
            bId: item.bId,
            operation: 'query',
            object: item.object,
            ok: true,
            result: {
              'INV-2': { invoices: [{ invoiceId: '88', docNumber: 'INV-2', syncToken: '1' }] },
            },
          })),
        }
      return inner?.(toolId, inputs)
    })

    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toMatchObject({ status: 'sent' })
    expect(results[1]?._unsafeUnwrap()).toMatchObject({
      status: 'already_exists',
      externalId: '88',
    })
    expect(queries).toBe(2)
  })

  it('refuses a 6140 the net cannot find as data, never transport', async () => {
    connect({ onCreate: fault('6140') as never })

    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    const error = results[1]?._unsafeUnwrapErr() as ProviderPostError
    expect(error).toBeInstanceOf(ProviderPostError)
    expect(error.failureClass).toBe('data')
    expect(error.faultCode).toBe('6140')
  })

  it('names a 2300 imbalance data', async () => {
    connect({ onCreate: fault('2300', 'UPSTREAM_ERROR', 'Transaction must balance') as never })

    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    expect((results[1]?._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('data')
  })

  it('classifies an expired connection as configuration, without the net', async () => {
    const { batchCalls } = connect({
      onCreate: ((item: Item) => ({
        bId: item.bId,
        operation: 'create',
        object: item.object,
        ok: false,
        error: { code: 'CONNECTION_EXPIRED', message: 'Reconnect QuickBooks', fault: null },
      })) as never,
    })

    const results = (await send([invoice('INV-1')]))._unsafeUnwrap()

    expect((results[0]?._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('configuration')
    expect(batchCalls()).toHaveLength(2)
  })

  it('treats a missing answer as transport, after the net finds nothing', async () => {
    const { batchCalls } = connect({
      onCreate: (item) => (item.input?.docNumber === 'INV-2' ? 'omit' : undefined) as never,
    })

    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toMatchObject({ status: 'sent' })
    expect((results[1]?._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
    // query, create, net query
    expect(batchCalls()).toHaveLength(3)
  })

  it('fails every row as transport when the whole create call throws, with one net query', async () => {
    const { batchCalls } = connect({
      createThrows: Object.assign(new Error('QuickBooks tool batch failed: rate limited'), {
        statusCode: 429,
      }),
    })

    const results = (
      await send([invoice('INV-1'), invoice('INV-2'), payment('PAY-1')] as never)
    )._unsafeUnwrap()

    for (const result of results)
      expect((result._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('transport')
    expect(batchCalls().filter((call) => call.items[0]?.operation === 'query')).toHaveLength(2)
  })
})

describe('what the batch cannot take', () => {
  it('sends a vendor credit through its own single tools', async () => {
    const { callTool, batchCalls } = connect()

    const results = (await send([vendorCredit('VC-1'), invoice('INV-1')] as never))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toMatchObject({ status: 'sent', externalId: 'vc-1' })
    expect(callTool).toHaveBeenCalledWith(
      'create_quickbooks_vendor_credit',
      expect.objectContaining({ requestId: 'key-VC-1' })
    )
    expect(batchCalls().flatMap((call) => call.items.map((item) => item.object))).toEqual([
      'invoice',
      'invoice',
    ])
  })

  it('falls back to the single tools when the installed app has no batch tool', async () => {
    const { callTool, batchCalls } = connect({ batchDeployed: false })
    callTool.mockImplementation(async (toolId) => {
      if (toolId === 'find_quickbooks_invoice') return { invoices: [] }
      if (toolId === 'create_quickbooks_invoice')
        return { invoiceId: '501', docNumber: 'INV-1', totalAmt: 123.45, syncToken: '0' }
      return {}
    })

    const results = (await send([invoice('INV-1')]))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap()).toMatchObject({ status: 'sent', externalId: '501' })
    expect(batchCalls()).toHaveLength(0)
  })

  it('refuses a malformed payload per row without failing the set', async () => {
    connect()
    const broken = { ...invoice('INV-X'), payload: { docNumber: 'INV-X' } }

    const results = (await send([broken, invoice('INV-1')] as never))._unsafeUnwrap()

    expect((results[0]?._unsafeUnwrapErr() as ProviderPostError).failureClass).toBe('data')
    expect(results[1]?._unsafeUnwrap()).toMatchObject({ status: 'sent' })
  })
})

describe('the gates, checked once per call', () => {
  it('answers disabled for every row when the switch is off', async () => {
    getOrganizationSetting.mockResolvedValue(false)
    const results = (await send([invoice('INV-1'), invoice('INV-2')]))._unsafeUnwrap()

    expect(results.map((r) => r._unsafeUnwrap().status)).toEqual(['disabled', 'disabled'])
    expect(getOrganizationSetting).toHaveBeenCalledTimes(1)
    expect(resolveQuickbooksContext).not.toHaveBeenCalled()
  })

  it('answers not_connected for every row', async () => {
    resolveQuickbooksContext.mockResolvedValue({ connected: false })
    const results = (await send([invoice('INV-1')]))._unsafeUnwrap()

    expect(results[0]?._unsafeUnwrap().status).toBe('not_connected')
  })
})

describe('deterministic batch ids', () => {
  it('derives the same bId per key and the same requestId per set, whatever the order', () => {
    const keys = ['key-a', 'key-b', 'key-c']
    const ids = batchItemIds(keys)
    const reversed = batchItemIds([...keys].reverse())

    expect(ids).toEqual([...reversed].reverse())
    expect(ids.every((id) => id.length <= 10)).toBe(true)
    expect(batchRequestId(keys)).toBe(batchRequestId([...keys].reverse()))
    expect(batchRequestId(keys)).toHaveLength(36)
    expect(batchRequestId(keys)).not.toBe(batchRequestId(['key-a', 'key-b']))
  })

  it('keeps bIds unique within a call', () => {
    const keys = Array.from({ length: 2000 }, (_, i) => `key-${i}`)
    expect(new Set(batchItemIds(keys)).size).toBe(keys.length)
  })

  it('puts the derived ids on the create call', async () => {
    const { batchCalls } = connect()

    await send([invoice('INV-1'), invoice('INV-2')])

    const create = batchCalls()[1]
    expect(create?.requestId).toBe(batchRequestId(['key-INV-1', 'key-INV-2']))
    expect(create?.items.map((item) => item.bId)).toEqual(batchItemIds(['key-INV-1', 'key-INV-2']))
  })
})
