// packages/lib/src/accounting/money/customer-money/__tests__/ingest.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { accountingBasisHash } from '../../../ledger/builders/basis-hash'
import { listMovementAccountingCandidates } from '../../blocked-movements'
import type { customerMoneyObservationSchema } from '../contracts'
import {
  linkImportedRefundsToMemo,
  materializeImportedMoneyInTx,
  sweepImportedCustomerMoney,
} from '../ingest'
import { listOrderMoneyTransactions } from '../reads'
import { reconcileOrderPaymentEvidence, stageOrderPaymentEvidenceInTx } from '../record-evidence'
import { repointGuestReceiptsForOrders } from '../repoint-guest-party'
import { requeueAcceptancesForOrders } from '../source-writes'

const db = () => getTestDb()
let organizationId: string
let orderId: string
let accountId: string
let partyId: string
let contactDefId: string
let contactFieldId: string
const sample: z.infer<typeof customerMoneyObservationSchema> = {
  version: 2,
  raw: {},
  id: 'capture1',
  kind: 'receipt',
  status: 'confirmed',
  amount: '60.00',
  currency: 'USD',
  processedAt: '2026-09-01T01:30:00Z',
  gateway: 'stripe',
  settlementCurrency: 'USD',
  parentTransactionId: null,
  creditMemoExternalId: null,
  paymentId: null,
  test: false,
}
async function stageFixture(input: {
  organizationId: string
  credentialId: string
  appInstallationId: string
  connectorId: string
  runId: string
  orderExternalId: string
  envelope: { version: number; complete: boolean; transactions: unknown[] }
}) {
  const credential = await db().query.Credential.findFirst({
    where: eq(schema.Credential.id, input.credentialId),
  })
  await db().transaction((tx) =>
    stageOrderPaymentEvidenceInTx(tx, {
      organizationId,
      orderInstanceId: orderId,
      provenance: {
        source: 'connector',
        connectorId: input.connectorId,
        credentialId: input.credentialId,
        appInstallationId: input.appInstallationId,
        credentialMetadataHash: accountingBasisHash(credential?.metadata),
      },
      evidence: {
        version: 2,
        sourceAccount: {
          providerKey: 'shopify',
          externalAccountId: 'fixture.myshopify.com',
          environment: 'live',
        },
        orderExternalId: input.orderExternalId,
        sourceUpdatedAt: null,
        complete: input.envelope.complete,
        transactions: input.envelope.transactions,
      },
    })
  )
  if (input.runId === 'reconnect')
    await reconcileOrderPaymentEvidence(db(), { organizationId, orderInstanceIds: [orderId] })
}
beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: 'orders',
      singular: 'Order',
      plural: 'Orders',
      entityType: 'order',
    })
    .returning()
  const [partyDef] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: 'contacts',
      singular: 'Contact',
      plural: 'Contacts',
      entityType: 'contact',
    })
    .returning()
  const [party] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: partyDef!.id, updatedAt: new Date() })
    .returning()
  const [order] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning()
  orderId = order!.id
  partyId = party!.id
  contactDefId = partyDef!.id
  for (const [attribute, value] of [
    ['order_total', 10000],
    ['order_currency', 'USD'],
    ['order_contact', party!.id],
  ] as const) {
    const [field] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId,
        entityDefinitionId: def!.id,
        name: attribute,
        systemAttribute: attribute,
        type:
          attribute === 'order_total'
            ? 'NUMBER'
            : attribute === 'order_contact'
              ? 'RELATIONSHIP'
              : 'TEXT',
        updatedAt: new Date(),
      })
      .returning()
    if (attribute === 'order_contact') contactFieldId = field!.id
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId,
        entityDefinitionId: def!.id,
        entityId: orderId,
        fieldId: field!.id,
        ...(attribute === 'order_total'
          ? { valueNumber: value as number }
          : attribute === 'order_contact'
            ? { relatedEntityId: value as string }
            : { valueText: value as string }),
      })
  }
  await db().insert(schema.OrganizationSetting).values({
    organizationId,
    key: 'accounting.bookTimeZone',
    value: 'America/Los_Angeles',
    updatedAt: new Date(),
  })
  const [account] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: 'shopify',
      externalAccountId: 'fixture.myshopify.com',
      environment: 'live',
    })
    .returning()
  accountId = account!.id
})
async function staged(patch: Partial<typeof sample> = {}, withOrder = true) {
  const payload = { ...sample, ...patch }
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId: accountId,
      objectType: 'order_transaction',
      externalId: payload.id,
      componentKey: '',
    })
    .returning()
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: accountingBasisHash(payload),
      observedAt: new Date(),
      payload,
      reportingInstallationSnapshot: { connectorId: 'fixture' },
    })
    .returning()
  const [acceptance] = await db()
    .insert(schema.FinancialSourceAcceptance)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      observationId: observation!.id,
      state: 'pending',
      orderExternalId: 'order1',
      orderInstanceId: withOrder ? orderId : null,
    })
    .returning()
  return acceptance!
}
/** A second contact, and the org's guest customer when `asGuest`. */
async function contact(asGuest = false) {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: contactDefId, updatedAt: new Date() })
    .returning()
  if (asGuest)
    await db().insert(schema.OrganizationSetting).values({
      organizationId,
      key: 'accounting.guestContactId',
      value: row!.id,
      updatedAt: new Date(),
    })
  return row!.id
}
const setOrderContact = (contactId: string) =>
  db()
    .update(schema.FieldValue)
    .set({ relatedEntityId: contactId })
    .where(
      and(eq(schema.FieldValue.entityId, orderId), eq(schema.FieldValue.fieldId, contactFieldId))
    )
const theMoney = async () => (await db().select().from(schema.MoneyTransaction))[0]!
async function accept(id: string) {
  await db().transaction((tx) => materializeImportedMoneyInTx(tx, organizationId, id))
}
const readAcceptanceRow = (id: string) =>
  db().query.FinancialSourceAcceptance.findFirst({
    where: eq(schema.FinancialSourceAcceptance.id, id),
  })
/** The acceptance's `evidence` work item - where its reason and schedule live now (91 §4.6). */
const readWorkItem = (acceptanceId: string) =>
  db().query.AccountingWorkItem.findFirst({
    where: and(
      eq(schema.AccountingWorkItem.sourceKind, 'financial_source_acceptance'),
      eq(schema.AccountingWorkItem.sourceId, acceptanceId)
    ),
  })
/** One `credit_memo` record owed to `partyId`, with its own definition. */
async function creditMemo(partyId: string, apiSlug: string, memoOrderId?: string) {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug,
      singular: 'Credit',
      plural: 'Credits',
      entityType: 'credit_memo',
    })
    .returning()
  const [credit] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning()
  const values: Array<readonly [string, number | string]> = [
    ['credit_memo_total', 1000],
    ['credit_memo_contact', partyId],
    ...(memoOrderId ? [['credit_memo_order', memoOrderId] as const] : []),
  ]
  for (const [attribute, value] of values) {
    const [field] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId,
        entityDefinitionId: def!.id,
        name: attribute,
        systemAttribute: attribute,
        type: attribute === 'credit_memo_total' ? 'NUMBER' : 'RELATIONSHIP',
        updatedAt: new Date(),
      })
      .returning()
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId,
        entityDefinitionId: def!.id,
        entityId: credit!.id,
        fieldId: field!.id,
        ...(typeof value === 'number' ? { valueNumber: value } : { relatedEntityId: value }),
      })
  }
  return { id: credit!.id, entityDefinitionId: def!.id }
}
/** A refund of `capture1` whose observation names neither credential nor connector. */
async function credentiallessRefund() {
  const refund = await staged({
    id: 'refund1',
    kind: 'refund',
    amount: '10.00',
    parentTransactionId: 'capture1',
    creditMemoExternalId: 'refund_document',
  })
  await db()
    .update(schema.FinancialSourceObservation)
    .set({ reportingInstallationSnapshot: {} })
    .where(eq(schema.FinancialSourceObservation.id, refund.observationId))
  return refund
}
async function connectionId(name: string) {
  const [credential] = await db()
    .insert(schema.Credential)
    .values({ organizationId, name, encryptedSecrets: 'fixture', updatedAt: new Date() })
    .returning()
  return credential!.id
}
describe('customer money source acceptance against PostgreSQL', () => {
  it('multiple captures and duplicate retries create exactly two movements/applications', async () => {
    const a = await staged()
    const b = await staged({ id: 'capture2', amount: '40.00' })
    await Promise.all([accept(a.id), accept(a.id)])
    await accept(b.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(2)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(2)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(0)
    const apps = await db().select().from(schema.MoneyApplication)
    expect(apps.every((a) => a.effectiveDate === '2026-08-31')).toBe(true)
  })
  it('retains confirmed money when order is unresolved then applies after repair', async () => {
    const a = await staged({}, false)
    await accept(a.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(1)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(0)
    await db()
      .update(schema.FinancialSourceAcceptance)
      .set({ orderInstanceId: orderId })
      .where(eq(schema.FinancialSourceAcceptance.id, a.id))
    await accept(a.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(1)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(1)
    expect(await readWorkItem(a.id)).toBeUndefined()
  })
  // The guest is a stand-in: a synced order arrives on the guest and is repointed by the
  // connector's relationship pass, after its receipts were ingested.
  it('takes the customer the order names once the guest stand-in is replaced', async () => {
    const guestId = await contact(true)
    await setOrderContact(guestId)
    const a = await staged()
    await accept(a.id)
    expect((await theMoney()).partyInstanceId).toBe(guestId)
    await setOrderContact(partyId)
    await accept(a.id)
    expect((await theMoney()).partyInstanceId).toBe(partyId)
    expect(await readWorkItem(a.id)).toBeUndefined()
  })
  it('still parks a receipt whose order now names a different real customer', async () => {
    const a = await staged()
    await accept(a.id)
    await setOrderContact(await contact())
    await accept(a.id)
    expect(await readWorkItem(a.id)).toMatchObject({ reasonCode: 'CUSTOMER_CHANGED' })
    expect((await theMoney()).partyInstanceId).toBe(partyId)
  })
  it('repoints an accepted guest receipt when the order-contact wake fires', async () => {
    const guestId = await contact(true)
    await setOrderContact(guestId)
    const a = await staged()
    await accept(a.id)
    await setOrderContact(partyId)
    expect(await repointGuestReceiptsForOrders(db(), organizationId, [orderId])).toBe(1)
    expect((await theMoney()).partyInstanceId).toBe(partyId)
    expect(await repointGuestReceiptsForOrders(db(), organizationId, [orderId])).toBe(0)
  })
  // 91 §8.6: post now, link later. The receipt stands on its own facts; its order is a pending link.
  it('accepts an orderless receipt on its own facts and records the pending order link', async () => {
    const a = await staged({}, false)
    await accept(a.id)
    const [money] = await db().select().from(schema.MoneyTransaction)
    expect(money).toMatchObject({
      purpose: 'customer_receipt',
      amountMinor: 6000n,
      partyInstanceId: null,
    })
    expect(await readAcceptanceRow(a.id)).toMatchObject({
      state: 'accepted',
      moneyTransactionId: money!.id,
      orderInstanceId: null,
    })
    expect(await readWorkItem(a.id)).toMatchObject({
      stage: 'evidence',
      reasonCode: 'ORDER_NOT_FOUND',
      externalRef: 'order1',
    })
    // Accepted, the posting sweep offers it; nothing waits on the order.
    const window = { cutoffPeriod: null, bookTimeZone: 'UTC' }
    expect(await listMovementAccountingCandidates(db(), organizationId, 10, window)).toMatchObject([
      { id: money!.id },
    ])
  })
  it('stages malformed money without creating a movement and shows it beside the order', async () => {
    const a = await staged({ amount: '1e3' })
    await accept(a.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(0)
    expect((await listOrderMoneyTransactions(db(), organizationId, orderId))[0]?.status).toBe(
      'rejected'
    )
  })
  it('does not turn test transactions into operational receipts', async () => {
    const a = await staged({ test: true })
    await accept(a.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(0)
  })
  it('preserves an excess capture as blocked actual money without over-applying', async () => {
    const a = await staged({ amount: '101.00' })
    await accept(a.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(1)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(0)
  })
  it('missing book timezone blocks application without replacing occurrence precision', async () => {
    await db().delete(schema.OrganizationSetting)
    const a = await staged()
    await accept(a.id)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(0)
    const money = await db().select().from(schema.MoneyTransaction)
    expect(money[0]?.occurredAt?.toISOString()).toBe(sample.processedAt!.replace('Z', '.000Z'))
  })
  it('organization deletion cascades through the full source/movement/application graph', async () => {
    const other = await createTestOrganization()
    const a = await staged()
    await accept(a.id)
    await db().delete(schema.Organization).where(eq(schema.Organization.id, organizationId))
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(0)
    expect(await db().select().from(schema.FinancialSourceObservation)).toHaveLength(0)
    expect(
      await db().query.Organization.findFirst({ where: eq(schema.Organization.id, other.id) })
    ).toBeTruthy()
  })
  it('verified second source cannot duplicate the same movement application', async () => {
    const first = await staged()
    await accept(first.id)
    const [money] = await db().select().from(schema.MoneyTransaction)
    const [command] = await db().select().from(schema.MoneyCommand)
    const second = await staged({ id: 'other_capture_evidence' })
    await db().insert(schema.MoneySourceLink).values({
      organizationId,
      sourceObjectId: second.sourceObjectId,
      moneyTransactionId: money!.id,
      verifiedByCommandId: command!.id,
    })
    await accept(second.id)
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(1)
    expect(await db().select().from(schema.MoneyApplication)).toHaveLength(1)
    expect(await listOrderMoneyTransactions(db(), organizationId, orderId)).toHaveLength(1)
  })
  it('shrinking a fetched snapshot cannot erase durable pending coverage', async () => {
    const [developer] = await db()
      .insert(schema.DeveloperAccount)
      .values({ slug: 'fixture', title: 'Fixture' })
      .returning()
    const [app] = await db()
      .insert(schema.App)
      .values({ developerAccountId: developer!.id, slug: 'shopify', title: 'Shopify' })
      .returning()
    const [installation] = await db()
      .insert(schema.AppInstallation)
      .values({ organizationId, appId: app!.id, installationType: 'production' })
      .returning()
    const [credential] = await db()
      .insert(schema.Credential)
      .values({
        organizationId,
        kind: 'app',
        appId: app!.id,
        appInstallationId: installation!.id,
        name: 'Shopify',
        encryptedSecrets: 'fixture',
        metadata: { connectionVariables: { shop: 'fixture' } },
        updatedAt: new Date(),
      })
      .returning()
    const input = {
      organizationId,
      credentialId: credential!.id,
      appInstallationId: installation!.id,
      connectorId: 'fixture',
      runId: 'run1',
      orderExternalId: 'order2',
    }
    await stageFixture({
      ...input,
      envelope: { version: 1, complete: true, transactions: [sample] },
    })
    await stageFixture({
      ...input,
      envelope: { version: 1, complete: true, transactions: [] },
    })
    const [coverage] = await db().select().from(schema.FinancialSourceCoverage)
    expect(coverage!.fetchedCount).toBe(1)
    expect(coverage!.pendingCount).toBe(1)
    expect(coverage!.complete).toBe(false)
  })
  it('settles a refund whose observation has no credential from the memo identity alone', async () => {
    const capture = await staged()
    await accept(capture.id)
    const [receipt] = await db().select().from(schema.MoneyTransaction)
    const credit = await creditMemo(receipt!.partyInstanceId!, 'credits')
    await db().insert(schema.RecordIdentity).values({
      organizationId,
      entityInstanceId: credit.id,
      entityDefinitionId: credit.entityDefinitionId,
      source: 'shopify',
      externalId: 'refund_document',
      appFieldKey: 'refundId',
    })
    const refund = await credentiallessRefund()
    await accept(refund.id)
    expect(await db().select().from(schema.MoneyRefundSettlement)).toMatchObject([
      { disposition: 'customer_credit', customerCreditMemoInstanceId: credit.id },
    ])
    expect(
      await db().query.FinancialSourceAcceptance.findFirst({
        where: eq(schema.FinancialSourceAcceptance.id, refund.id),
      })
    ).toMatchObject({ state: 'accepted' })
    expect(await readWorkItem(refund.id)).toBeUndefined()
  })
  // 91 D4: the memo is a link, never a precondition - the refund is accepted and posts.
  it('accepts a refund whose memo identity is held on two connections, unlinked', async () => {
    const capture = await staged()
    await accept(capture.id)
    const [receipt] = await db().select().from(schema.MoneyTransaction)
    for (const [index, apiSlug] of ['credits-a', 'credits-b'].entries()) {
      const credit = await creditMemo(receipt!.partyInstanceId!, apiSlug)
      await db()
        .insert(schema.RecordIdentity)
        .values({
          organizationId,
          entityInstanceId: credit.id,
          entityDefinitionId: credit.entityDefinitionId,
          source: 'shopify',
          externalId: 'refund_document',
          appFieldKey: 'refundId',
          connectionId: await connectionId(`Shopify ${index}`),
        })
    }
    const refund = await credentiallessRefund()
    await accept(refund.id)
    expect(await db().select().from(schema.MoneyRefundSettlement)).toHaveLength(0)
    expect(
      await db().query.FinancialSourceAcceptance.findFirst({
        where: eq(schema.FinancialSourceAcceptance.id, refund.id),
      })
    ).toMatchObject({ state: 'accepted' })
    expect(await readWorkItem(refund.id)).toBeUndefined()
  })
  it('links a refund that arrived before its memo once the memo arrives', async () => {
    const capture = await staged()
    await accept(capture.id)
    const [receipt] = await db().select().from(schema.MoneyTransaction)
    const refund = await credentiallessRefund()
    await accept(refund.id)
    expect(await readAcceptanceRow(refund.id)).toMatchObject({ state: 'accepted' })
    expect(await db().select().from(schema.MoneyRefundSettlement)).toHaveLength(0)

    const credit = await creditMemo(receipt!.partyInstanceId!, 'credits', orderId)
    await db().insert(schema.RecordIdentity).values({
      organizationId,
      entityInstanceId: credit.id,
      entityDefinitionId: credit.entityDefinitionId,
      source: 'shopify',
      externalId: 'refund_document',
      appFieldKey: 'refundId',
    })
    expect(await linkImportedRefundsToMemo(db(), organizationId, credit.id)).toBe(1)
    expect(await db().select().from(schema.MoneyRefundSettlement)).toMatchObject([
      {
        disposition: 'customer_credit',
        customerCreditMemoInstanceId: credit.id,
        originalTransactionId: receipt!.id,
        amountMinor: 1000n,
      },
    ])
    // Linked once: a second pass finds nothing left to link.
    expect(await linkImportedRefundsToMemo(db(), organizationId, credit.id)).toBe(0)
  })
  it('settles a partial refund once and survives a reconnect with the same store identity', async () => {
    const capture = await staged()
    await accept(capture.id)
    const [receipt] = await db().select().from(schema.MoneyTransaction)
    const [developer] = await db()
      .insert(schema.DeveloperAccount)
      .values({ slug: 'refund-fixture', title: 'Fixture' })
      .returning()
    const [app] = await db()
      .insert(schema.App)
      .values({ developerAccountId: developer!.id, slug: 'shopify', title: 'Shopify' })
      .returning()
    const [installation] = await db()
      .insert(schema.AppInstallation)
      .values({ organizationId, appId: app!.id, installationType: 'production' })
      .returning()
    const [credential] = await db()
      .insert(schema.Credential)
      .values({
        organizationId,
        kind: 'app',
        appId: app!.id,
        appInstallationId: installation!.id,
        name: 'Shopify',
        encryptedSecrets: 'fixture',
        metadata: { connectionVariables: { shop: 'fixture' } },
        updatedAt: new Date(),
      })
      .returning()
    const [connector] = await db()
      .insert(schema.DataConnector)
      .values({
        id: 'fixture',
        organizationId,
        type: 'app:shopify',
        name: 'Shopify',
        credentialId: credential!.id,
        appInstallationId: installation!.id,
      })
      .returning()
    const [def] = await db()
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        apiSlug: 'credits',
        singular: 'Credit',
        plural: 'Credits',
        entityType: 'credit_memo',
      })
      .returning()
    const [credit] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId: def!.id, updatedAt: new Date() })
      .returning()
    for (const [attribute, value] of [
      ['credit_memo_total', 1000],
      ['credit_memo_contact', receipt!.partyInstanceId!],
    ] as const) {
      const [field] = await db()
        .insert(schema.CustomField)
        .values({
          organizationId,
          entityDefinitionId: def!.id,
          name: attribute,
          systemAttribute: attribute,
          type:
            attribute === 'credit_memo_total'
              ? 'NUMBER'
              : attribute === 'credit_memo_contact'
                ? 'RELATIONSHIP'
                : 'TEXT',
          updatedAt: new Date(),
        })
        .returning()
      await db()
        .insert(schema.FieldValue)
        .values({
          organizationId,
          entityDefinitionId: def!.id,
          entityId: credit!.id,
          fieldId: field!.id,
          ...(attribute === 'credit_memo_total'
            ? { valueNumber: value as number }
            : attribute === 'credit_memo_contact'
              ? { relatedEntityId: value as string }
              : { valueText: value as string }),
        })
    }
    const [stream] = await db()
      .insert(schema.DataConnectorStream)
      .values({ organizationId, dataConnectorId: connector!.id, streamKey: 'order' })
      .returning()
    const [mapping] = await db()
      .insert(schema.DataConnectorMapping)
      .values({
        organizationId,
        dataConnectorStreamId: stream!.id,
        targetMode: 'contributing',
        entityDefinitionId: def!.id,
      })
      .returning()
    await db().insert(schema.DataConnectorItem).values({
      organizationId,
      dataConnectorId: connector!.id,
      mappingId: mapping!.id,
      externalId: 'refund_document',
      entityDefinitionId: def!.id,
      entityInstanceId: credit!.id,
    })
    const refund = await staged({
      id: 'refund1',
      kind: 'refund',
      amount: '10.00',
      parentTransactionId: 'capture1',
      creditMemoExternalId: 'refund_document',
    })
    await db()
      .update(schema.FinancialSourceObservation)
      .set({
        reportingInstallationSnapshot: {
          connectorId: connector!.id,
          credentialId: credential!.id,
          credentialMetadataHash: accountingBasisHash(credential!.metadata),
        },
      })
      .where(eq(schema.FinancialSourceObservation.id, refund.observationId))
    await accept(refund.id)
    await accept(refund.id)
    expect(await db().select().from(schema.MoneyRefundSettlement)).toHaveLength(1)
    const refundMoney = await db().query.MoneyTransaction.findFirst({
      where: eq(schema.MoneyTransaction.purpose, 'customer_refund'),
    })
    expect(refundMoney!.amountMinor).toBe(1000n)
    // Its rail comes from its own gateway handle at post time, never off the receipt (91 D4).
    expect(refundMoney!.paymentGatewayId).toBeNull()
    const [replacement] = await db()
      .insert(schema.Credential)
      .values({
        organizationId,
        kind: 'app',
        appId: app!.id,
        appInstallationId: installation!.id,
        name: 'Shopify reconnect',
        encryptedSecrets: 'fixture2',
        metadata: { connectionVariables: { shop: 'fixture' } },
        updatedAt: new Date(),
      })
      .returning()
    await db()
      .update(schema.DataConnector)
      .set({ credentialId: replacement!.id })
      .where(eq(schema.DataConnector.id, connector!.id))
    const payload = {
      ...sample,
      id: 'refund1',
      kind: 'refund',
      amount: '10.00',
      parentTransactionId: 'capture1',
      creditMemoExternalId: 'refund_document',
    }
    await stageFixture({
      organizationId,
      credentialId: replacement!.id,
      appInstallationId: installation!.id,
      connectorId: connector!.id,
      runId: 'reconnect',
      orderExternalId: 'order1',
      envelope: { version: 1, complete: false, transactions: [payload] },
    })
    expect(await db().select().from(schema.MoneyTransaction)).toHaveLength(2)
    expect(await db().select().from(schema.MoneyRefundSettlement)).toHaveLength(1)
    expect(await db().select().from(schema.GlPosting)).toHaveLength(0)
  })
})

describe('ordinary order evidence staging and shared events', () => {
  it('stages without creating money, then reconciles without a connector and keeps replay idempotent', async () => {
    const { stageOrderPaymentEvidenceInTx, reconcileOrderPaymentEvidence } = await import(
      '../record-evidence'
    )
    const evidence = {
      version: 2,
      sourceAccount: {
        providerKey: 'shopify',
        externalAccountId: 'fixture.myshopify.com',
        environment: 'live',
      },
      orderExternalId: 'order-fixture',
      sourceUpdatedAt: '2026-09-01T00:00:00Z',
      complete: true,
      transactions: [{ ...sample, version: 2, kind: 'receipt', status: 'confirmed', raw: sample }],
    }
    await db().transaction((tx) =>
      stageOrderPaymentEvidenceInTx(tx, {
        organizationId,
        orderInstanceId: orderId,
        evidence,
        provenance: { source: 'import' },
      })
    )
    expect(
      await db().query.MoneyTransaction.findMany({
        where: eq(schema.MoneyTransaction.organizationId, organizationId),
      })
    ).toHaveLength(0)
    await reconcileOrderPaymentEvidence(db(), {
      organizationId,
      orderInstanceIds: [orderId, orderId],
    })
    const first = await db().query.MoneyTransaction.findMany({
      where: eq(schema.MoneyTransaction.organizationId, organizationId),
    })
    expect(first).toHaveLength(1)
    expect(first[0]!.amountMinor).toBe(6000n)
    await db().transaction((tx) =>
      stageOrderPaymentEvidenceInTx(tx, {
        organizationId,
        orderInstanceId: orderId,
        evidence,
        provenance: { source: 'api' },
      })
    )
    await reconcileOrderPaymentEvidence(db(), { organizationId, orderInstanceIds: [orderId] })
    expect(
      await db().query.MoneyTransaction.findMany({
        where: eq(schema.MoneyTransaction.organizationId, organizationId),
      })
    ).toEqual(first)
    const coverage = await db().query.FinancialSourceCoverage.findFirst({
      where: eq(schema.FinancialSourceCoverage.organizationId, organizationId),
    })
    expect(coverage).toMatchObject({
      streamKey: 'order_transactions',
      complete: true,
      acceptedCount: 1,
    })
  })
  // 79 §4.2/§4.5 on work items: the code decides the schedule, the order wake makes
  // it due, and the posting sweep leaves a blocked acceptance's movement alone.
  it('parks a refusal as a coded work item, and the order wake makes it due', async () => {
    const a = await staged({ amount: '101.00' })
    await accept(a.id)
    expect(await readAcceptanceRow(a.id)).toMatchObject({ state: 'blocked' })
    const parked = await readWorkItem(a.id)
    expect(parked).toMatchObject({ reasonCode: 'RECEIPT_EXCEEDS_ORDER', attempts: 1 })
    expect(parked!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
    expect(await sweepImportedCustomerMoney(db(), organizationId)).toEqual({
      examined: 0,
      failed: 0,
    })

    await requeueAcceptancesForOrders(db(), organizationId, [orderId])
    expect((await readWorkItem(a.id))!.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now())
    expect(await sweepImportedCustomerMoney(db(), organizationId)).toEqual({
      examined: 1,
      failed: 0,
    })
    expect(await readWorkItem(a.id)).toMatchObject({
      reasonCode: 'RECEIPT_EXCEEDS_ORDER',
      attempts: 2,
    })
  })
  it('keeps the posting sweep off a movement whose acceptance is blocked', async () => {
    const a = await staged({ amount: '101.00' })
    await accept(a.id)
    const [money] = await db().select().from(schema.MoneyTransaction)
    const window = { cutoffPeriod: null, bookTimeZone: 'UTC' }
    expect(await listMovementAccountingCandidates(db(), organizationId, 10, window)).toEqual([])
    // Accepted, it is a candidate again.
    await db()
      .update(schema.FinancialSourceAcceptance)
      .set({ state: 'accepted' })
      .where(eq(schema.FinancialSourceAcceptance.id, a.id))
    expect(await listMovementAccountingCandidates(db(), organizationId, 10, window)).toMatchObject([
      { id: money!.id },
    ])
  })
  it('parks a missing book zone as a setup refusal, counting attempts', async () => {
    await db().delete(schema.OrganizationSetting)
    const a = await staged()
    await accept(a.id)
    expect(await readWorkItem(a.id)).toMatchObject({ reasonCode: 'SETUP_INCOMPLETE', attempts: 1 })

    await accept(a.id)
    expect(await readWorkItem(a.id)).toMatchObject({ reasonCode: 'SETUP_INCOMPLETE', attempts: 2 })
  })
  it('rejects cross-organization order ownership before financial writes', async () => {
    const { stageOrderPaymentEvidenceInTx } = await import('../record-evidence')
    const other = (await createTestOrganization()).id
    await expect(
      db().transaction((tx) =>
        stageOrderPaymentEvidenceInTx(tx, {
          organizationId: other,
          orderInstanceId: orderId,
          evidence: {
            version: 2,
            sourceAccount: {
              providerKey: 'file',
              externalAccountId: 'account',
              environment: 'live',
            },
            orderExternalId: 'order-fixture',
            sourceUpdatedAt: null,
            complete: true,
            transactions: [],
          },
        })
      )
    ).rejects.toThrow('active order')
  })
})
