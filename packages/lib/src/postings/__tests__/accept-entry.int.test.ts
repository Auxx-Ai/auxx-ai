// packages/lib/src/postings/__tests__/accept-entry.int.test.ts
import { schema, type Transaction } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cache', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onCacheEvent: vi.fn(),
}))
vi.mock('../provider', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveAccountingProvider: vi.fn(() => {
    throw new Error('Provider access during acceptance')
  }),
}))

import { acceptEntryInTx, type PreparedEffectMember } from '../accept-entry'
import { withAccountingCommitLock } from '../accounting-commit-lock'
import * as docNumbers from '../doc-number'
import { correctionAccountingEffectKey } from '../effect-basis'
import type {
  AcceptedCustomerReceiptEffectBasisV1,
  CustomerReceiptWorkBasisInput,
} from '../effect-types'
import {
  appendFulfillmentWorkBasisInTx,
  captureCustomerReceiptWorkInTx,
  captureFulfillmentWorkInTx,
} from '../effect-work'
import { resolveAccountingProvider } from '../provider'
import { reverseEntry } from '../reverse-entry'
import { setLockedThrough } from '../set-locked-through'
import type { BuiltEntry } from '../types'
import { acceptedBasis, readyBasis, SOURCE_HASH } from './fixtures/accounting-effect-basis'

afterEach(() => vi.restoreAllMocks())

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
  vi.mocked(resolveAccountingProvider).mockClear()
})

async function member(effectiveDate = '2026-09-14'): Promise<PreparedEffectMember> {
  const [source] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: definitionId,
      updatedAt: new Date(),
    })
    .returning()
  const id = source!.id
  const sourceBasis = readyBasis(id)
  sourceBasis.effectiveDate = effectiveDate
  sourceBasis.calculation.shippedOn = effectiveDate
  const { work } = await db().transaction((tx) =>
    captureFulfillmentWorkInTx(tx, {
      organizationId,
      fulfillmentInstanceId: id,
      eligibility: 'manual',
      basis: sourceBasis,
    })
  )
  const basis = acceptedBasis(id)
  basis.effectiveDate = effectiveDate
  basis.calculation = sourceBasis.calculation
  for (const line of basis.contribution)
    line.glAccountId = line.direction === 'debit' ? clearingId : revenueId
  for (const line of basis.accountResolution) {
    line.glAccountId = line.lineKey === 'clearing' ? clearingId : revenueId
    line.selectedBy = 'document'
  }
  return { workId: work.id, expectedBasisVersion: 1, acceptedBasis: basis }
}

async function receiptMember(
  effectiveDate = '2026-09-15'
): Promise<PreparedEffectMember<AcceptedCustomerReceiptEffectBasisV1>> {
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: `accept-test-receipt-${Date.now()}-${Math.random()}`,
      kind: 'acceptance_test',
      payloadHash: SOURCE_HASH,
      actorSnapshot: { kind: 'test' },
    })
    .returning()
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: 'customer_receipt',
      amountMinor: 120n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'instant',
      occurredAt: new Date(`${effectiveDate}T10:00:00.000Z`),
      recordedByCommandId: command!.id,
    })
    .returning()
  const calculation = {
    version: 1 as const,
    moneyTransactionId: money!.id,
    orderInstanceId: 'order',
    sourceObjectId: null,
    sourceExternalId: 'gid://shopify/OrderTransaction/test',
    sourceRevision: 'revision1',
    sourceHash: SOURCE_HASH,
    historyHash: 'b'.repeat(64),
    occurredAt: `${effectiveDate}T10:00:00.000Z`,
    effectiveDate,
    currency: 'USD' as const,
    currencyExponent: 2 as const,
    amountMinor: '120',
    orderSubtotalMinor: '100',
    orderTaxMinor: '10',
    orderShippingMinor: '10',
    orderTotalMinor: '120',
    receiptAmountMinor: '120',
    receivableMinor: '0',
    depositMinor: '110',
    taxMinor: '10',
    allocation: { amountMinor: '120', depositMinor: '110', receivableMinor: '0', taxMinor: '10' },
    paymentRouteId: 'route-test',
    sourceStoreId: 'store-test',
    processorAccountId: 'processor-test',
    route: {
      paymentRouteId: 'route-test',
      processorAccountId: 'processor-test',
      glAccountId: clearingId,
      reason: 'acceptance test route',
    },
    applications: [
      {
        applicationId: 'application-test',
        orderInstanceId: 'order',
        amountMinor: '120',
        effectiveDate,
      },
    ],
    taxComponents: [
      {
        componentKey: 'sales-tax',
        amountMinor: '10',
        jurisdiction: 'US-CA',
        collector: 'merchant' as const,
        remitter: 'merchant' as const,
        withholdingEvidenceId: null,
      },
    ],
  }
  const workBasis: CustomerReceiptWorkBasisInput = {
    version: 1,
    status: 'ready',
    moneyTransactionId: money!.id,
    sourceHash: SOURCE_HASH,
    effectiveDate,
    calculation,
  }
  const { work } = await db().transaction((tx) =>
    captureCustomerReceiptWorkInTx(tx, {
      organizationId,
      moneyTransactionId: money!.id,
      eligibility: 'manual',
      basis: workBasis,
    })
  )
  const acceptedBasis: AcceptedCustomerReceiptEffectBasisV1 = {
    version: 1,
    sourceBasisVersion: 1,
    sourceHash: SOURCE_HASH,
    policyKey: 'shopify_receipt_v1',
    policyVersion: 1,
    effectiveDate,
    bookTimeZone: 'UTC',
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'order', entityInstanceId: 'order' },
      { resourceKind: 'money_transaction', entityInstanceId: money!.id },
    ],
    calculation,
    accountResolution: [
      {
        lineKey: 'clearing',
        glAccountId: clearingId,
        accountRole: null,
        selectedBy: 'document',
        configurationHash: SOURCE_HASH,
      },
      {
        lineKey: 'deposit',
        glAccountId: revenueId,
        accountRole: null,
        selectedBy: 'document',
        configurationHash: SOURCE_HASH,
      },
      {
        lineKey: 'tax',
        glAccountId: revenueId,
        accountRole: null,
        selectedBy: 'document',
        configurationHash: SOURCE_HASH,
      },
    ],
    contribution: [
      {
        lineKey: 'clearing',
        glAccountId: clearingId,
        direction: 'debit',
        amountMinor: '120',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {},
      },
      {
        lineKey: 'deposit',
        glAccountId: revenueId,
        direction: 'credit',
        amountMinor: '110',
        counterpartyType: 'customer',
        counterpartyId: 'customer',
        dimensions: {},
      },
      {
        lineKey: 'tax',
        glAccountId: revenueId,
        direction: 'credit',
        amountMinor: '10',
        counterpartyType: null,
        counterpartyId: null,
        dimensions: {},
      },
    ],
  }
  return { workId: work.id, expectedBasisVersion: 1, acceptedBasis }
}
async function correction(
  original: PreparedEffectMember,
  originalEffectId: string,
  commandKey: string,
  expectedCorrectionHeadId: string | null
) {
  const basis = structuredClone(original.acceptedBasis)
  for (const line of basis.contribution)
    line.direction = line.direction === 'debit' ? 'credit' : 'debit'
  const [work] = await db()
    .insert(schema.AccountingWork)
    .values({
      organizationId,
      entityInstanceId: basis.calculation.fulfillmentInstanceId,
      effectKind: 'fulfillment_accounting',
      effectKey: correctionAccountingEffectKey(originalEffectId, commandKey, 'replace'),
      operation: 'correction',
      correctsEffectId: originalEffectId,
      componentKey: 'replace',
      basisVersion: 1,
      state: 'pending',
      eligibility: 'manual',
    })
    .returning()
  await db()
    .insert(schema.AccountingWorkBasis)
    .values({
      organizationId,
      workId: work!.id,
      version: 1,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis: readyBasis(basis.calculation.fulfillmentInstanceId),
    })
  return {
    workId: work!.id,
    expectedBasisVersion: 1,
    acceptedBasis: basis,
    expectedCorrectionHeadId,
  }
}
type Member = Awaited<ReturnType<typeof member>>
type ReceiptMember = Awaited<ReturnType<typeof receiptMember>>
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

function receiptEntry(
  members: Array<PreparedEffectMember<AcceptedCustomerReceiptEffectBasisV1>>
): BuiltEntry {
  return {
    postingType: 'payment',
    periodKey: '2026-09-15',
    txnDate: '2026-09-15',
    totalDebit: members.length * 120,
    totalCredit: members.length * 120,
    lines: members.flatMap((member, i) =>
      member.acceptedBasis.contribution.map((line, j) => ({
        glAccountId: line.glAccountId,
        direction: line.direction,
        amount: Number(line.amountMinor),
        sourceType: 'customer_receipt',
        sourceId: member.acceptedBasis.calculation.moneyTransactionId,
        sortOrder: i * 3 + j,
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
function receiptInput(members: ReceiptMember[], overrides: Partial<Input> = {}): Input {
  return {
    organizationId,
    actorUserId: userId,
    members,
    entry: receiptEntry(members),
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
function receiptDependencies(members: ReceiptMember[]) {
  return {
    revalidateMemberInTx: vi.fn(async (_tx: Transaction, work: { id: string }) => {
      const found = members.find((member) => member.workId === work.id)
      if (!found) throw new Error('Missing receipt fixture member')
      return found.acceptedBasis
    }),
  }
}
function acceptReceipts(
  members: ReceiptMember[],
  overrides: Partial<Input> = {},
  deps = receiptDependencies(members)
) {
  return db().transaction((tx) => acceptEntryInTx(tx, receiptInput(members, overrides), deps))
}
async function assertNoAcceptance() {
  expect(await db().select().from(schema.GlPosting)).toHaveLength(0)
  expect(await db().select().from(schema.GlPostingLine)).toHaveLength(0)
  expect(await db().select().from(schema.AccountingEffect)).toHaveLength(0)
  const work = await db().select().from(schema.AccountingWork)
  expect(work.every((row) => row.state !== 'accepted')).toBe(true)
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

describe('atomic accounting acceptance against PostgreSQL', () => {
  it('accepts a customer receipt through the payment posting owner', async () => {
    const receipt = await receiptMember()
    expect(await acceptReceipts([receipt])).toMatchObject({ status: 'accepted', existing: false })
    const [journal] = await db().select().from(schema.GlPosting)
    expect(journal).toMatchObject({
      postingType: 'payment',
      txnDate: '2026-09-15',
      totalMinor: 120,
    })
    const [work] = await db().select().from(schema.AccountingWork)
    expect(work).toMatchObject({
      effectKind: 'customer_receipt',
      moneyTransactionId: receipt.acceptedBasis.calculation.moneyTransactionId,
      entityInstanceId: null,
      state: 'accepted',
    })
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })

  it('refuses monthly regrouping for daily receipt effects', async () => {
    const receipts = [await receiptMember('2026-09-14'), await receiptMember('2026-09-15')]
    await expect(acceptReceipts(receipts)).rejects.toThrow('Daily accounting effects')
    await assertNoAcceptance()
  })

  it('refuses monthly regrouping for payment-date fulfillment effects', async () => {
    const shipments = [await member('2026-09-14'), await member('2026-09-15')]
    for (const shipment of shipments) {
      shipment.acceptedBasis.policyKey = 'shopify_payment_date_v1'
      shipment.acceptedBasis.calculation.recognitionHistoryHash = SOURCE_HASH
      shipment.acceptedBasis.calculation.recognitionAllocation = {
        amountMinor: '100',
        depositDebitMinor: '100',
        receivableDebitMinor: '0',
        newlyRecognizedTaxMinor: '0',
        historyHash: SOURCE_HASH,
      }
    }
    await expect(
      accept(shipments, { entry: { ...entry(shipments), txnDate: '2026-09-15' } })
    ).rejects.toThrow('Daily accounting effects')
    await assertNoAcceptance()
  })

  it('refuses a fulfillment owner under the payment posting type', async () => {
    const fulfillment = await member()
    await expect(
      accept([fulfillment], {
        entry: { ...entry([fulfillment]), postingType: 'payment' },
      })
    ).rejects.toThrow('posting type does not match')
    await assertNoAcceptance()
  })

  it('groups different fulfillment dates in one month using the latest date while retaining each effect date', async () => {
    const members = [await member('2026-09-03'), await member('2026-09-14')]
    expect(await accept(members)).toMatchObject({ status: 'accepted' })
    expect((await db().select().from(schema.GlPosting))[0]!.txnDate).toBe('2026-09-14')
    expect(
      (await db().select().from(schema.AccountingEffect))
        .map((effect) => effect.effectiveDate)
        .sort()
    ).toEqual(['2026-09-03', '2026-09-14'])
  })
  it('refuses a monthly journal dated later than its latest member', async () => {
    const members = [await member('2026-09-03'), await member('2026-09-14')]
    await expect(
      accept(members, { entry: { ...entry(members), txnDate: '2026-09-15' } })
    ).rejects.toThrow('latest member date')
    await assertNoAcceptance()
  })
  it('refuses a journal spanning two accounting months', async () => {
    const members = [await member('2026-08-31'), await member('2026-09-14')]
    await expect(accept(members)).rejects.toThrow('one accounting month')
    await assertNoAcceptance()
  })
  it('checks the external opening boundary for every grouped effect, not only the journal date', async () => {
    const members = [await member('2026-09-09'), await member('2026-09-14')]
    const destination = await connection()
    await db()
      .update(schema.ExternalBookConnection)
      .set({ exportFromDate: '2026-09-10' })
      .where(eq(schema.ExternalBookConnection.id, destination.id))
    await expect(
      accept(members, { deliveryIntent: { kind: 'automatic', connectionId: destination.id } })
    ).rejects.toThrow('opening boundary')
    await assertNoAcceptance()
  })
  it('accepts a monthly group whose first source date equals the export boundary', async () => {
    const members = [await member('2026-09-10'), await member('2026-09-14')]
    const destination = await connection()
    await db()
      .update(schema.ExternalBookConnection)
      .set({ exportFromDate: '2026-09-10' })
      .where(eq(schema.ExternalBookConnection.id, destination.id))
    expect(
      await accept(members, { deliveryIntent: { kind: 'automatic', connectionId: destination.id } })
    ).toMatchObject({ status: 'accepted' })
  })

  it('commits the journal, contributions, effects, work and pinned intent together without provider work', async () => {
    const members = [await member(), await member()]
    const destination = await connection()
    const result = await accept(members, {
      deliveryIntent: { kind: 'automatic', connectionId: destination.id },
    })
    expect(result).toMatchObject({ status: 'accepted', existing: false })
    const [journal] = await db().select().from(schema.GlPosting)
    expect(journal).toMatchObject({
      totalMinor: 200,
      txnDate: '2026-09-14',
      deliveryIntent: 'automatic',
      intendedBookConnectionId: destination.id,
    })
    expect(journal!.periodKey).toMatch(/^fg_[a-f0-9]+$/)
    expect(journal!.postedAt).not.toBeNull()
    const effects = await db().select().from(schema.AccountingEffect)
    expect(effects).toHaveLength(2)
    expect(effects.every((effect) => effect.glPostingId === journal!.id)).toBe(true)
    expect(new Set(effects.map((effect) => effect.workId))).toEqual(
      new Set(members.map((member) => member.workId))
    )
    const lines = await db().select().from(schema.GlPostingLine)
    expect(
      lines
        .filter((line) => line.direction === 'debit')
        .reduce((sum, line) => sum + line.amountMinor, 0)
    ).toBe(200)
    expect(
      (await db().select().from(schema.AccountingWork)).every((row) => row.state === 'accepted')
    ).toBe(true)
    expect(resolveAccountingProvider).not.toHaveBeenCalled()
  })

  it.each([
    'lines',
    'effects',
    'work',
  ] as const)('rolls back header and all prior writes when %s fails', async (stage) => {
    const members = [await member()]
    const constraints = {
      lines: {
        add: sql`alter table "GlPostingLine" add constraint acceptance_test_fault check ("amountMinor" <> 100)`,
        drop: sql`alter table "GlPostingLine" drop constraint acceptance_test_fault`,
      },
      effects: {
        add: sql`alter table "AccountingEffect" add constraint acceptance_test_fault check (currency <> 'USD')`,
        drop: sql`alter table "AccountingEffect" drop constraint acceptance_test_fault`,
      },
      work: {
        add: sql`alter table "AccountingWork" add constraint acceptance_test_fault check (state <> 'accepted')`,
        drop: sql`alter table "AccountingWork" drop constraint acceptance_test_fault`,
      },
    }
    await db().execute(constraints[stage].add)
    try {
      await expect(accept(members)).rejects.toThrow()
      await assertNoAcceptance()
    } finally {
      await db().execute(constraints[stage].drop)
    }
    expect(await accept(members)).toMatchObject({ status: 'accepted', existing: false })
  })

  it('rolls back a complete acceptance when the caller fails before outer commit', async () => {
    const members = [await member()]
    await expect(
      db().transaction(async (tx) => {
        expect(await acceptEntryInTx(tx, input(members), dependencies(members))).toMatchObject({
          status: 'accepted',
        })
        expect(await db().select().from(schema.GlPosting)).toHaveLength(0)
        expect(resolveAccountingProvider).not.toHaveBeenCalled()
        throw new Error('outer command failed')
      })
    ).rejects.toThrow('outer command failed')
    await assertNoAcceptance()
    expect(await accept(members)).toMatchObject({ status: 'accepted', existing: false })
  })

  it('converges concurrent identical groups on the same saved acceptance', async () => {
    const members = [await member(), await member()]
    const results = await Promise.all([accept(members), accept([...members].reverse())])
    expect(results.map((result) => result.status)).toEqual(['accepted', 'accepted'])
    expect(results.map((result) => result.status === 'accepted' && result.existing).sort()).toEqual(
      [false, true]
    )
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(2)
  })

  it('replans overlapping concurrent groups before inserting and accepts only the remaining member', async () => {
    const first = await member(),
      shared = await member(),
      last = await member()
    const results = await Promise.all([accept([first, shared]), accept([shared, last])])
    const replan = results.find((result) => result.status === 'replan')
    expect(results.filter((result) => result.status === 'accepted')).toHaveLength(1)
    expect(replan).toBeDefined()
    if (!replan || replan.status !== 'replan') throw new Error('Expected replan')
    expect(replan.acceptedWorkIds).toEqual([shared.workId])
    expect(replan.remainingWorkIds).toHaveLength(1)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    const remaining = [first, last].filter((member) =>
      replan.remainingWorkIds.includes(member.workId)
    )
    expect(await accept(remaining)).toMatchObject({ status: 'accepted', existing: false })
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(3)
    const journals = await db().select().from(schema.GlPosting)
    expect(journals.map((row) => row.totalMinor).sort((a, b) => a - b)).toEqual([100, 200])
  })

  it('returns frozen acceptance after the period closes and account/connection configuration changes', async () => {
    const members = [await member()]
    const destination = await connection()
    const deliveryIntent = { kind: 'automatic' as const, connectionId: destination.id }
    const initial = await accept(members, { deliveryIntent })
    await setLockedThrough(db(), { organizationId, actorUserId: userId, periodKey: '2026-09' })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, revenueId))
    await db()
      .update(schema.ExternalBookConnection)
      .set({ state: 'disconnected' })
      .where(eq(schema.ExternalBookConnection.id, destination.id))
    const deps = dependencies(members)
    deps.revalidateMemberInTx.mockRejectedValue(
      new Error('Current settings must not replace accepted basis')
    )
    const repeated = await accept(members, { deliveryIntent }, deps)
    expect(repeated).toMatchObject({ status: 'accepted', existing: true })
    if (initial.status !== 'accepted' || repeated.status !== 'accepted')
      throw new Error('Expected accepted')
    expect(repeated.glPostingId).toBe(initial.glPostingId)
    expect(repeated.deliveryIntent).toEqual(deliveryIntent)
    expect(repeated.postings).toEqual([{ glPostingId: initial.glPostingId, deliveryIntent }])
    expect(deps.revalidateMemberInTx).not.toHaveBeenCalled()
    expect((await db().select().from(schema.GlPosting))[0]!.intendedBookConnectionId).toBe(
      destination.id
    )
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })

  it('returns exact existing effects across separate journals without creating a regrouped journal', async () => {
    const first = await member()
    const second = await member()
    const left = await accept([first])
    const right = await accept([second])
    const deps = dependencies([first, second])
    const repeated = await accept([first, second], {}, deps)
    expect(repeated).toMatchObject({ status: 'accepted', existing: true })
    if (left.status !== 'accepted' || right.status !== 'accepted' || repeated.status !== 'accepted')
      throw new Error('Expected accepted')
    expect(new Set(repeated.glPostingIds)).toEqual(
      new Set([...left.glPostingIds, ...right.glPostingIds])
    )
    expect(repeated.glPostingId).toBeUndefined()
    expect(deps.revalidateMemberInTx).not.toHaveBeenCalled()
    expect(await db().select().from(schema.GlPosting)).toHaveLength(2)
  })

  it('refuses a truncated membership-key collision with a different full membership hash', async () => {
    const first = await member()
    const second = await member()
    vi.spyOn(docNumbers, 'fulfillmentGroupPeriodKey').mockReturnValue('fg_123456789')
    await accept([first])
    await expect(accept([second])).rejects.toThrow()
    const effects = await db().select().from(schema.AccountingEffect)
    expect(effects.map((effect) => effect.workId)).toEqual([first.workId])
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
  })

  it('refuses a document-number collision without adopting another groups journal', async () => {
    const first = await member()
    const second = await member()
    await accept([first])
    const [journal] = await db().select().from(schema.GlPosting)
    vi.spyOn(docNumbers, 'buildDocNumber').mockReturnValue(journal!.docNumber)
    await expect(accept([second])).rejects.toThrow()
    expect(
      (await db().select().from(schema.AccountingEffect)).map((effect) => effect.workId)
    ).toEqual([first.workId])
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
  })

  it('preserves original membership and serializes competing correction heads', async () => {
    const original = await member()
    const accepted = await accept([original])
    if (accepted.status !== 'accepted') throw new Error('Expected original acceptance')
    const effectId = accepted.effectIds[0]!
    const left = await correction(original, effectId, 'correction-left', null)
    const right = await correction(original, effectId, 'correction-right', null)
    const outcomes = await Promise.allSettled([accept([left]), accept([right])])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    const winner = outcomes[0]!.status === 'fulfilled' ? left : right
    const saved = outcomes.find((outcome) => outcome.status === 'fulfilled')
    if (!saved || saved.status !== 'fulfilled' || saved.value.status !== 'accepted')
      throw new Error('Expected correction acceptance')
    const next = await correction(original, effectId, 'correction-next', saved.value.effectIds[0]!)
    await accept([next])
    expect(await accept([winner])).toMatchObject({ status: 'accepted', existing: true })
    expect(await accept([original])).toMatchObject({
      status: 'accepted',
      existing: true,
      glPostingId: accepted.glPostingId,
    })
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(3)
    const originals = await db()
      .select()
      .from(schema.AccountingWork)
      .where(eq(schema.AccountingWork.id, original.workId))
    expect(originals[0]!.state).toBe('accepted')
    expect(originals[0]!.basisVersion).toBe(1)
    const journals = await db().select().from(schema.GlPosting)
    expect(journals.every((row) => row.status === 'posted')).toBe(true)
  })

  it('refuses an ordinary reversal of effect-backed journals and retains the original claim', async () => {
    const original = await member()
    const accepted = await accept([original])
    if (accepted.status !== 'accepted' || !accepted.glPostingId)
      throw new Error('Expected original acceptance')
    const refused = await reverseEntry(db(), {
      organizationId,
      actorUserId: userId,
      glPostingId: accepted.glPostingId,
      lock: { lockedThroughMonth: null },
    })
    expect(refused.status).toBe('error')
    expect(refused.error).toContain('correction')
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
    expect(await accept([original])).toMatchObject({
      status: 'accepted',
      existing: true,
      glPostingId: accepted.glPostingId,
    })
  })

  it('rejects a different requested accepted basis for the same accepted work', async () => {
    const members = [await member()]
    await accept(members)
    members[0]!.acceptedBasis.bookTimeZone = 'America/Los_Angeles'
    await expect(accept(members)).rejects.toThrow()
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
  })

  it('rejects a changed source or configuration observed during locked revalidation', async () => {
    const members = [await member()]
    const deps = dependencies(members)
    const changed = structuredClone(members[0]!.acceptedBasis)
    changed.accountResolution[0]!.configurationHash = 'b'.repeat(64)
    deps.revalidateMemberInTx.mockResolvedValue(changed)
    await expect(accept(members, {}, deps)).rejects.toThrow()
    await assertNoAcceptance()
  })

  it('rejects a selected basis version advanced after preview', async () => {
    const members = [await member()]
    const changed = readyBasis(members[0]!.acceptedBasis.calculation.fulfillmentInstanceId)
    changed.calculation.sourceRevision = 'revision2'
    changed.sourceHash = 'b'.repeat(64)
    changed.calculation.sourceHash = changed.sourceHash
    await db().transaction((tx) =>
      appendFulfillmentWorkBasisInTx(tx, {
        organizationId,
        workId: members[0]!.workId,
        expectedBasisVersion: 1,
        basis: changed,
      })
    )
    await expect(accept(members)).rejects.toThrow()
    await assertNoAcceptance()
  })

  it.each([
    'incomplete',
    'malformed',
    'missing',
    'excluded',
  ] as const)('refuses %s work without partial acceptance', async (kind) => {
    const members = [await member()]
    const selected = members[0]!
    if (kind === 'incomplete') {
      await db()
        .update(schema.AccountingWorkBasis)
        .set({
          basis: {
            version: 1,
            status: 'incomplete',
            fulfillmentInstanceId: selected.acceptedBasis.calculation.fulfillmentInstanceId,
            sourceHash: SOURCE_HASH,
            effectiveDate: null,
            missingDependencies: ['order'],
            observed: {},
          },
          effectiveDate: null,
        })
        .where(eq(schema.AccountingWorkBasis.workId, selected.workId))
    } else if (kind === 'malformed') {
      await db()
        .update(schema.AccountingWorkBasis)
        .set({
          basis: {
            ...readyBasis(selected.acceptedBasis.calculation.fulfillmentInstanceId),
            calculation: {},
          },
        })
        .where(eq(schema.AccountingWorkBasis.workId, selected.workId))
    } else if (kind === 'missing') {
      await db()
        .delete(schema.AccountingWorkBasis)
        .where(eq(schema.AccountingWorkBasis.workId, selected.workId))
    } else {
      await db()
        .update(schema.AccountingWork)
        .set({ eligibility: 'excluded' })
        .where(eq(schema.AccountingWork.id, selected.workId))
    }
    await expect(accept(members)).rejects.toThrow()
    await assertNoAcceptance()
  })

  it.each([
    'amount',
    'dimension',
    'account',
    'member',
  ] as const)('rejects aggregate %s drift from the exact contributions', async (kind) => {
    const members = [await member(), await member()]
    const built = entry(members)
    if (kind === 'amount') {
      built.lines[0]!.amount += 1
      built.lines[1]!.amount += 1
      built.totalDebit += 1
      built.totalCredit += 1
    } else if (kind === 'dimension') built.lines[0]!.dimensions = { channel: 'different' }
    else if (kind === 'account') built.lines[0]!.glAccountId = revenueId
    else {
      built.lines.splice(2)
      built.totalDebit = 100
      built.totalCredit = 100
    }
    await expect(accept(members, { entry: built })).rejects.toThrow()
    await assertNoAcceptance()
  })

  it('rejects work and pinned delivery belonging to a different organization', async () => {
    const members = [await member()]
    const other = (await createTestOrganization()).id
    await expect(accept(members, { organizationId: other })).rejects.toThrow()
    const foreign = await connection(other)
    await expect(
      accept(members, { deliveryIntent: { kind: 'automatic', connectionId: foreign.id } })
    ).rejects.toThrow()
    await assertNoAcceptance()
  })

  it('refuses an archived account even when the proposed contribution is balanced', async () => {
    const members = [await member()]
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, revenueId))
    await expect(accept(members)).rejects.toThrow()
    await assertNoAcceptance()
  })

  it('commits acceptance before a concurrent close waiting on its organization lock', async () => {
    const members = [await member()]
    const deps = dependencies(members)
    let holderPid = 0
    let release!: () => void
    let entered!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const validating = new Promise<void>((resolve) => {
      entered = resolve
    })
    deps.revalidateMemberInTx.mockImplementation(async (tx) => {
      holderPid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid)
      entered()
      await hold
      return members[0]!.acceptedBasis
    })
    const accepting = accept(members, {}, deps)
    await validating
    const closer = setLockedThrough(db(), {
      organizationId,
      actorUserId: userId,
      periodKey: '2026-09',
    })
    try {
      await vi.waitFor(
        async () => {
          const pending = await db().execute(
            sql`select count(*)::int as count from pg_locks waiter where waiter.locktype = 'advisory' and not waiter.granted and ${holderPid} = any(pg_blocking_pids(waiter.pid))`
          )
          expect(Number(pending.rows[0]?.count)).toBeGreaterThan(0)
        },
        { timeout: 3000 }
      )
    } finally {
      release()
    }
    expect(await accepting).toMatchObject({ status: 'accepted', existing: false })
    await closer
    expect(await db().select().from(schema.GlPosting)).toHaveLength(1)
    expect(await db().select().from(schema.AccountingEffect)).toHaveLength(1)
  })

  it('waits for the period-close transaction, then refuses the newly closed date', async () => {
    const members = [await member()]
    let holderPid = 0
    let release!: () => void, acquired!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const closer = db().transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      holderPid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid)
      await tx.insert(schema.OrganizationSetting).values({
        organizationId,
        key: 'ledger.lockedThroughMonth',
        value: '2026-09',
        updatedAt: new Date(),
      })
      acquired()
      await hold
    })
    await locked
    const accepting = accept(members)
    const refusal = expect(accepting).rejects.toThrow()
    try {
      await vi.waitFor(
        async () => {
          const pending = await db().execute(
            sql`select count(*)::int as count from pg_locks waiter where waiter.locktype = 'advisory' and not waiter.granted and ${holderPid} = any(pg_blocking_pids(waiter.pid))`
          )
          expect(Number(pending.rows[0]?.count)).toBeGreaterThan(0)
        },
        { timeout: 3000 }
      )
    } finally {
      release()
    }
    await closer
    await refusal
    await assertNoAcceptance()
  })
})
