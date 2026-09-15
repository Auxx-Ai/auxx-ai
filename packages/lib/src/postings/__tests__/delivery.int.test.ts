// packages/lib/src/postings/__tests__/delivery.int.test.ts
import { schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onCacheEvent: vi.fn(),
}))
vi.mock('../book-connections', () => ({ readPinnedAccountingConnection: vi.fn() }))
vi.mock('../../money/quickbooks/invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: vi.fn(),
}))
vi.mock('../../money/quickbooks/quickbooks-accounting-provider', () => ({
  prepareQuickbooksJournal: vi.fn(),
}))

import { resolveQuickbooksContext } from '../../money/quickbooks/invoke-quickbooks-tool'
import { prepareQuickbooksJournal } from '../../money/quickbooks/quickbooks-accounting-provider'
import { acceptEntryInTx, type PreparedEffectMember } from '../accept-entry'
import { readPinnedAccountingConnection } from '../book-connections'
import {
  deliverAccountingPosting,
  planAccountingDeliveryInTx,
  sweepAccountingDeliveries,
} from '../delivery'
import { captureFulfillmentWorkInTx } from '../effect-work'
import type { BuiltEntry, PostEntryInput } from '../types'
import { acceptedBasis, readyBasis } from './fixtures/accounting-effect-basis'

const db = () => getTestDb()
let organizationId: string
let userId: string
let definitionId: string
let clearingId: string
let revenueId: string

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  userId = (await createTestUser()).id
  const definitions = await db()
    .insert(schema.EntityDefinition)
    .values([
      {
        organizationId,
        apiSlug: 'fulfillments',
        singular: 'Fulfillment',
        plural: 'Fulfillments',
        entityType: 'fulfillment',
      },
      {
        organizationId,
        apiSlug: 'gl_accounts',
        singular: 'Account',
        plural: 'Accounts',
        entityType: 'gl_account',
      },
    ])
    .returning()
  definitionId = definitions[0]!.id
  const accountDefinitionId = definitions[1]!.id
  const fields = await db()
    .insert(schema.CustomField)
    .values([
      {
        organizationId,
        entityDefinitionId: accountDefinitionId,
        name: 'Code',
        type: 'TEXT',
        systemAttribute: 'gl_account_code',
        updatedAt: new Date(),
      },
      {
        organizationId,
        entityDefinitionId: accountDefinitionId,
        name: 'Type',
        type: 'SINGLE_SELECT',
        systemAttribute: 'gl_account_type',
        updatedAt: new Date(),
      },
    ])
    .returning()
  const accounts = await db()
    .insert(schema.EntityInstance)
    .values([
      { organizationId, entityDefinitionId: accountDefinitionId, updatedAt: new Date() },
      { organizationId, entityDefinitionId: accountDefinitionId, updatedAt: new Date() },
    ])
    .returning()
  clearingId = accounts[0]!.id
  revenueId = accounts[1]!.id
  await db()
    .insert(schema.FieldValue)
    .values(
      accounts.flatMap((account, i) => [
        {
          organizationId,
          entityId: account.id,
          entityDefinitionId: accountDefinitionId,
          fieldId: fields[0]!.id,
          valueText: i === 0 ? '1100' : '4000',
          sortKey: 'a0',
        },
        {
          organizationId,
          entityId: account.id,
          entityDefinitionId: accountDefinitionId,
          fieldId: fields[1]!.id,
          optionId: i === 0 ? 'asset' : 'revenue',
          sortKey: 'a0',
        },
      ])
    )
})

async function member(): Promise<PreparedEffectMember> {
  const [source] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: definitionId,
      updatedAt: new Date(),
    })
    .returning()
  const id = source!.id
  const { work } = await db().transaction((tx) =>
    captureFulfillmentWorkInTx(tx, {
      organizationId,
      fulfillmentInstanceId: id,
      eligibility: 'manual',
      basis: readyBasis(id),
    })
  )
  const basis = acceptedBasis(id)
  for (const line of basis.contribution)
    line.glAccountId = line.direction === 'debit' ? clearingId : revenueId
  for (const line of basis.accountResolution) {
    line.glAccountId = line.lineKey === 'clearing' ? clearingId : revenueId
    line.selectedBy = 'document'
  }
  return { workId: work.id, expectedBasisVersion: 1, acceptedBasis: basis }
}
type Member = Awaited<ReturnType<typeof member>>
type Input = Parameters<typeof acceptEntryInTx>[1]

function entry(members: Member[]): BuiltEntry {
  return {
    postingType: 'fulfillment',
    periodKey: '2026-09-14',
    txnDate: '2026-09-14',
    totalDebit: members.length * 100,
    totalCredit: members.length * 100,
    lines: members.flatMap((member, i) =>
      member.acceptedBasis.contribution.map((line, j) => ({
        glAccountId: line.glAccountId,
        direction: line.direction,
        amount: Number(line.amountMinor),
        sourceType: 'fulfillment',
        sourceId: member.acceptedBasis.calculation.fulfillmentInstanceId,
        sortOrder: i * 2 + j,
        dimensions: line.dimensions,
        ...(line.counterpartyType
          ? { counterpartyType: line.counterpartyType, counterpartyId: line.counterpartyId! }
          : {}),
      }))
    ),
  }
}
function input(members: Member[], overrides: Partial<Input> = {}): Input {
  return {
    organizationId,
    actorUserId: userId,
    members,
    entry: entry(members),
    deliveryIntent: { kind: 'not_required' },
    ...overrides,
  }
}
function dependencies(members: Member[]) {
  return {
    revalidateMemberInTx: vi.fn(async (_tx: Transaction, work: { id: string }) => {
      const found = members.find((member) => member.workId === work.id)
      if (!found) throw new Error('Missing fixture member')
      return found.acceptedBasis
    }),
  }
}
function accept(members: Member[], overrides: Partial<Input> = {}, deps = dependencies(members)) {
  return db().transaction((tx) => acceptEntryInTx(tx, input(members, overrides), deps))
}
async function connection(org = organizationId, state: 'active' | 'disconnected' = 'active') {
  const [book] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({
      organizationId: org,
      providerKey: 'quickbooks',
      externalCompanyId: `company-${org}`,
    })
    .returning()
  const [saved] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId: org,
      bookId: book!.id,
      epoch: 1,
      credentialBindingSnapshot: 'fixture-credential',
      state,
      exportFromDate: '2026-01-01',
      openingPolicy: { version: 1, mode: 'from_date' },
    })
    .returning()
  return saved!
}

let remote: Record<string, unknown>[]
let createCount: number
let timeoutAfterCreate: boolean
let timeoutBeforeCreate: boolean
const callTool = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  remote = []
  createCount = 0
  timeoutAfterCreate = false
  timeoutBeforeCreate = false
  vi.mocked(prepareQuickbooksJournal).mockImplementation(async (_ctx, input: PostEntryInput) => ({
    toolInput: {
      txnDate: input.txnDate,
      docNumber: input.docNumber,
      privateNote: `auxx:${input.glPostingId}`,
      requestId: input.idempotencyKey,
      currency: 'USD',
      lines: input.lines.map((l) => ({
        accountId: l.glAccountId,
        postingType: l.direction === 'debit' ? 'Debit' : 'Credit',
        amountMinor: l.amount,
      })),
    },
    mappingBasis: { fixture: true },
  }))
  callTool.mockImplementation(async (toolId: string, payload: Record<string, unknown>) => {
    if (toolId === 'find_quickbooks_journal_entry') return { journalEntries: remote }
    if (toolId !== 'create_quickbooks_journal_entry') throw new Error('Unexpected tool')
    createCount++
    if (timeoutBeforeCreate) throw new Error('Network timeout')
    const found = {
      ...payload,
      journalEntryId: 'remote-1',
      syncToken: '0',
      lines: (payload.lines as Array<Record<string, unknown>>).map((l) => ({
        ...l,
        entityType: null,
        entityId: null,
      })),
    }
    remote.push(found)
    if (timeoutAfterCreate) throw new Error('Response timeout')
    return { journalEntry: found }
  })
})
async function accepted(intent: 'automatic' | 'manual' = 'automatic') {
  const memberValue = await member()
  const destination = await connection()
  vi.mocked(readPinnedAccountingConnection).mockImplementation(async () => ({
    connectionId: destination.id,
    bookId: destination.bookId,
    credentialId: 'credential',
    companyId: `company-${organizationId}`,
    providerKey: 'quickbooks',
    appInstallationId: 'installation',
  }))
  vi.mocked(resolveQuickbooksContext).mockResolvedValue({
    connected: true,
    context: {
      organizationId,
      installationId: 'installation',
      connectionId: 'credential',
      realmId: `company-${organizationId}`,
      userId,
      serverBundleSha: 'frozen-bundle',
      tools: [
        {
          id: 'find_quickbooks_journal_entry',
          outputsJsonSchema: {
            properties: {
              journalEntries: {
                items: {
                  properties: Object.fromEntries(
                    [
                      'journalEntryId',
                      'docNumber',
                      'txnDate',
                      'currency',
                      'lines',
                      'privateNote',
                      'syncToken',
                    ].map((key) => [key, {}])
                  ),
                },
              },
            },
          },
        },
        {
          id: 'create_quickbooks_journal_entry',
          inputsJsonSchema: { properties: { requestId: {}, currency: {} } },
        },
      ] as never,
      callTool,
    },
  })
  const result = await accept([memberValue], {
    deliveryIntent: { kind: intent, connectionId: destination.id },
  })
  if (result.status !== 'accepted' || !result.glPostingId)
    throw new Error('Fixture acceptance failed')
  return { organizationId, glPostingId: result.glPostingId, destination }
}
describe('durable pinned journal delivery against PostgreSQL', () => {
  it('persists a customer dependency request before create and recovers its timeout without creating again', async () => {
    const fixture = await accepted()
    const contextResult = await vi.mocked(resolveQuickbooksContext).getMockImplementation()!({
      organizationId,
    })
    if (!contextResult.connected) throw new Error('Fixture')
    contextResult.context.tools!.push({
      id: 'create_quickbooks_customer',
      inputsJsonSchema: { properties: { requestId: {} } },
    } as never)
    const ordinaryPrepare = vi.mocked(prepareQuickbooksJournal).getMockImplementation()!
    vi.mocked(prepareQuickbooksJournal).mockImplementation(async (ctx, input) => {
      await ctx.callTool('create_quickbooks_customer', {
        displayName: 'Customer One',
        notes: 'auxx:contact:1',
        email: 'one@example.com',
      })
      return ordinaryPrepare(ctx, input)
    })
    const ordinaryCall = callTool.getMockImplementation()!
    let customer: Record<string, unknown> | null = null,
      customerCreates = 0
    callTool.mockImplementation(async (tool, payload) => {
      if (tool === 'create_quickbooks_customer') {
        customerCreates++
        const operations = await db().select().from(schema.AccountingDeliveryOperation)
        const dependency = operations.find((op) => op.objectType === 'Customer')!
        expect(dependency).toMatchObject({ payload, state: 'sending' })
        expect(dependency.firstSentAt).not.toBeNull()
        customer = { ...payload, customerId: 'customer-1', syncToken: '0' }
        throw new Error('Customer response timeout')
      }
      if (tool === 'find_quickbooks_customer') return { found: !!customer, customer }
      return ordinaryCall(tool, payload)
    })
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(createCount).toBe(0)
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({
      exportStatus: 'exported',
    })
    expect(customerCreates).toBe(1)
    expect(createCount).toBe(1)
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(2)
    const operations = await db().select().from(schema.AccountingDeliveryOperation)
    expect(operations.every((operation) => operation.state === 'succeeded')).toBe(true)
    expect(
      operations.find((operation) => operation.objectType === 'JournalEntry')!.dependencies
    ).toEqual([operations.find((operation) => operation.objectType === 'Customer')!.id])
  })

  it('plans unique complete effect coverage idempotently', async () => {
    const fixture = await accepted()
    await Promise.all([
      db().transaction((tx) => planAccountingDeliveryInTx(tx, fixture)),
      db().transaction((tx) => planAccountingDeliveryInTx(tx, fixture)),
    ])
    expect(await db().select().from(schema.AccountingDelivery)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingDeliveryCoverage)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingDeliveryOperation)).toHaveLength(1)
    expect(callTool).not.toHaveBeenCalled()
  })
  it('holds manual deliveries until explicitly released', async () => {
    const fixture = await accepted('manual')
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'pending' })
    expect(callTool).not.toHaveBeenCalled()
    expect(await deliverAccountingPosting(db(), { ...fixture, manual: true })).toMatchObject({
      exportStatus: 'exported',
    })
    expect(createCount).toBe(1)
  })
  it('saves payload before HTTP and stamps object, operation and projection together', async () => {
    const fixture = await accepted()
    const ordinary = callTool.getMockImplementation()!
    callTool.mockImplementation(async (tool, payload) => {
      if (tool === 'create_quickbooks_journal_entry') {
        const [op] = await db().select().from(schema.AccountingDeliveryOperation)
        expect(op).toMatchObject({ state: 'sending', payload })
        expect(op!.firstSentAt).not.toBeNull()
      }
      return ordinary(tool, payload)
    })
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({
      exportStatus: 'exported',
    })
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(1)
    expect((await db().select().from(schema.AccountingDelivery))[0]!.state).toBe('delivered')
    expect((await db().select().from(schema.GlPosting))[0]!.status).toBe('posted')
  })
  it('recovers timeout after actual success without a second create or mapping rebuild', async () => {
    const fixture = await accepted()
    timeoutAfterCreate = true
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({
      exportStatus: 'exported',
    })
    expect(createCount).toBe(1)
    expect(prepareQuickbooksJournal).toHaveBeenCalledTimes(1)
  })
  it('never treats an empty readback after a possible send as permission to create again', async () => {
    const fixture = await accepted()
    timeoutBeforeCreate = true
    await deliverAccountingPosting(db(), fixture)
    timeoutBeforeCreate = false
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(createCount).toBe(1)
    expect((await db().select().from(schema.AccountingDeliveryOperation))[0]!.state).toBe(
      'uncertain'
    )
  })
  it('refuses a document number hit with different amounts', async () => {
    const fixture = await accepted()
    timeoutAfterCreate = true
    await deliverAccountingPosting(db(), fixture)
    const lines = remote[0]!.lines as Array<Record<string, unknown>>
    lines[0]!.amountMinor = 999
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(0)
    expect(createCount).toBe(1)
  })
  it('blocks a disconnected or switched company without resolving a replacement', async () => {
    const fixture = await accepted()
    vi.mocked(readPinnedAccountingConnection).mockRejectedValue(
      new Error('Pinned company disconnected')
    )
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(resolveQuickbooksContext).not.toHaveBeenCalled()
    expect(createCount).toBe(0)
  })
  it('serializes concurrent exports on the durable operation lease', async () => {
    const fixture = await accepted()
    await Promise.all([
      deliverAccountingPosting(db(), fixture),
      deliverAccountingPosting(db(), fixture),
    ])
    expect(createCount).toBe(1)
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(1)
  })
  it('sweep discovers accepted postings with no plan after a process crash', async () => {
    await accepted()
    expect(await sweepAccountingDeliveries(db(), { organizationId, limit: 5 })).toMatchObject({
      examined: 1,
    })
    expect(createCount).toBe(1)
    expect(await sweepAccountingDeliveries(db(), { organizationId, limit: 5 })).toMatchObject({
      examined: 0,
    })
  })
  it('rolls back plan and exclusive coverage when its outer command fails', async () => {
    const fixture = await accepted()
    await expect(
      db().transaction(async (tx) => {
        await planAccountingDeliveryInTx(tx, fixture)
        throw new Error('outer failure')
      })
    ).rejects.toThrow('outer failure')
    expect(await db().select().from(schema.AccountingDelivery)).toHaveLength(0)
    expect(await db().select().from(schema.AccountingDeliveryCoverage)).toHaveLength(0)
    expect(callTool).not.toHaveBeenCalled()
  })
  it('cascades organization deletion through delivered history', async () => {
    const fixture = await accepted()
    await deliverAccountingPosting(db(), fixture)
    await db().delete(schema.Organization).where(eq(schema.Organization.id, organizationId))
    expect(await db().select().from(schema.AccountingDelivery)).toHaveLength(0)
    expect(await db().select().from(schema.ExternalAccountingObject)).toHaveLength(0)
  })
  it('refuses an installed tool without currency plumbing before any request', async () => {
    const fixture = await accepted()
    const resolved = await vi.mocked(resolveQuickbooksContext).getMockImplementation()!({
      organizationId,
    })
    if (!resolved.connected) throw new Error('Fixture')
    resolved.context.tools = []
    vi.mocked(resolveQuickbooksContext).mockResolvedValue(resolved)
    expect(await deliverAccountingPosting(db(), fixture)).toMatchObject({ exportStatus: 'failed' })
    expect(callTool).not.toHaveBeenCalled()
  })
})
