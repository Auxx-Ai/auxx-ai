// packages/lib/src/accounting/money/customer-money/ingest.ts

import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { GUEST_CONTACT_SETTING_KEY } from '../../parties'
import type { WorkItemCode } from '../../work-items/codes'
import { noWorkItem, runWorkItemSweep } from '../../work-items/sweep'
import { wakeSources } from '../../work-items/wake'
import { deleteWorkItem, upsertWorkItem } from '../../work-items/write'
import { insertMovement } from '../commands/insert-movement'
import { findMoneyCommandByKey } from '../commands/run-money-command'
import { pokePendingMatchesForSourceObject } from '../payouts/match-poke'
import {
  findSourceLink,
  listRefundSettlements,
  readMovement,
  sumAppliedToMovement,
  sumAppliedToOrder,
} from '../reads'
import { insertApplication } from '../writes'
import { confirmedCustomerMovement } from './contracts'
import { readRecordIdentityMatches } from './identity-reads'
import { linkReceiptPostingToOrderInTx } from './link-later'
import { linkRefundPostingToMemos } from './refund-accounting'
import {
  readStoredCustomerMoneyObservation,
  resolveSourceDocumentFromConnector,
} from './source-observation-adapter'
import {
  findSourceObjectByIdentity,
  readAcceptance,
  readSourceAccount,
  readSourceObject,
} from './source-reads'
import { refreshOrderCoverageCounts, updateAcceptance } from './source-writes'

const IMPORT_COMMAND_KIND = 'import_customer_money'

/** The `sourceKind` of an acceptance's `evidence` work item. */
export const ACCEPTANCE_SOURCE_KIND = 'financial_source_acceptance'

export const acceptanceWorkKey = (acceptanceId: string) => ({
  sourceKind: ACCEPTANCE_SOURCE_KIND,
  sourceId: acceptanceId,
  stage: 'evidence' as const,
})

async function typedDocument(
  tx: Transaction,
  organizationId: string,
  connectionId: string | undefined,
  externalId: string,
  kind: string,
  sourceAccountId?: string,
  explicitRecordId?: string | null,
  connectorId?: string
) {
  if (explicitRecordId) {
    const rows = await tx
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.id, explicitRecordId),
          eq(schema.EntityDefinition.entityType, kind),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .limit(1)
    return rows[0]?.id ?? null
  }
  const fromConnector = () =>
    resolveSourceDocumentFromConnector(tx, {
      organizationId,
      connectorId: connectorId,
      sourceAccountId,
      externalId,
      kind,
    })
  if (!sourceAccountId) return fromConnector()
  const account = await readSourceAccount(tx, organizationId, sourceAccountId)
  if (!account) return null
  const identity = { source: account.providerKey, kind, externalId }
  if (connectionId) {
    const scoped = await readRecordIdentityMatches(tx, organizationId, {
      ...identity,
      connectionId,
    })
    if (scoped.length) return scoped.length === 1 ? scoped[0]! : null
  }
  // A provider namespace alone cannot distinguish two connected merchant
  // accounts, so only a hit unique across the org resolves (task 79 §4.3).
  const rows = await readRecordIdentityMatches(tx, organizationId, identity)
  return rows.length === 1 ? rows[0]! : rows.length === 0 ? fromConnector() : null
}

async function documentFacts(tx: Database | Transaction, organizationId: string, entityId: string) {
  const rows = await tx
    .select({
      attribute: schema.CustomField.systemAttribute,
      text: schema.FieldValue.valueText,
      amount: schema.FieldValue.valueNumber,
      related: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityId)
      )
    )
  return new Map(rows.map((row) => [row.attribute, row]))
}

/** Materialize or resolve one durable source observation; shared lock protects money capacities. */
export async function materializeImportedMoneyInTx(
  tx: Transaction,
  organizationId: string,
  acceptanceId: string
): Promise<void> {
  await withAccountingCommitLock(tx, organizationId)
  const acceptance = await readAcceptance(tx, organizationId, acceptanceId)
  if (!acceptance) return
  // The one place a refusal is parked; its code decides the retry (91 §4.6).
  const park = (reasonCode: WorkItemCode, detail?: Record<string, unknown>) =>
    upsertWorkItem(tx, organizationId, {
      ...acceptanceWorkKey(acceptance.id),
      reasonCode,
      externalRef: acceptance.orderExternalId,
      ...(detail ? { detail } : {}),
    })
  const settle = () => deleteWorkItem(tx, organizationId, acceptanceWorkKey(acceptance.id))
  const observation = await tx.query.FinancialSourceObservation.findFirst({
    where: and(
      eq(schema.FinancialSourceObservation.organizationId, organizationId),
      eq(schema.FinancialSourceObservation.id, acceptance.observationId)
    ),
  })
  if (!observation) throw new Error('Source observation is missing')
  const object = await readSourceObject(tx, organizationId, acceptance.sourceObjectId)
  if (!object) throw new Error('Source object is missing')
  const acquisition = {
    ...(observation.reportingInstallationSnapshot as {
      credentialId?: string
      connectorId?: string
      creditMemoInstanceId?: string
    }),
    ...(acceptance.unresolvedReferences as {
      credentialId?: string
      connectorId?: string
      creditMemoInstanceId?: string
    }),
  }
  const acquiredOrderId =
    acceptance.orderInstanceId ??
    (acquisition.credentialId || acquisition.connectorId
      ? await typedDocument(
          tx,
          organizationId,
          acquisition.credentialId,
          acceptance.orderExternalId,
          'order',
          object.sourceAccountId,
          undefined,
          acquisition.connectorId
        )
      : null)
  if (acquiredOrderId && !acceptance.orderInstanceId)
    await updateAcceptance(tx, organizationId, acceptance.id, { orderInstanceId: acquiredOrderId })
  const source = readStoredCustomerMoneyObservation(observation.payload)
  if (!source.success) {
    await park('INVALID_EVIDENCE')
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'rejected' })
    return
  }
  if (
    acceptance.moneyTransactionId &&
    (source.data.status !== 'confirmed' || !['receipt', 'refund'].includes(source.data.kind))
  ) {
    await park('MOVEMENT_CHANGED')
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'blocked' })
    return
  }
  const sourceAccount = await readSourceAccount(tx, organizationId, object.sourceAccountId)
  if (!sourceAccount) throw new Error('Source account is outside this organization')
  if (source.data.test || sourceAccount.environment === 'test') {
    // Test mode: no operational money is created.
    await settle()
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'accepted' })
    return
  }
  if (['authorization', 'void'].includes(source.data.kind) || source.data.status === 'failed') {
    // No confirmed cash moved, so there is nothing to materialize.
    await settle()
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'accepted' })
    return
  }
  if (source.data.status !== 'confirmed') {
    await park('NOT_CONFIRMED')
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'pending' })
    return
  }
  let movement: ReturnType<typeof confirmedCustomerMovement>
  try {
    movement = confirmedCustomerMovement(source.data)
  } catch (error) {
    await park('INVALID_EVIDENCE', {
      message: error instanceof Error ? error.message : String(error),
    })
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'rejected' })
    return
  }
  const snapshot = {
    ...(observation.reportingInstallationSnapshot as {
      credentialId?: string
      connectorId?: string
      creditMemoInstanceId?: string
    }),
    ...(acceptance.unresolvedReferences as {
      credentialId?: string
      connectorId?: string
      creditMemoInstanceId?: string
    }),
  }
  let linked = await findSourceLink(tx, organizationId, object.id)
  let money = linked
    ? ((await readMovement(tx, organizationId, linked.moneyTransactionId)) ?? undefined)
    : undefined
  if (
    money &&
    (money.amountMinor !== movement.amountMinor ||
      money.currency !== movement.currency ||
      money.purpose !== movement.purpose ||
      money.occurredAt?.getTime() !== movement.occurredAt.getTime())
  ) {
    await park('MOVEMENT_CHANGED')
    await updateAcceptance(tx, organizationId, acceptance.id, { state: 'blocked' })
    return
  }
  const orderId =
    acquiredOrderId ??
    (await typedDocument(
      tx,
      organizationId,
      snapshot.credentialId,
      acceptance.orderExternalId,
      'order',
      object.sourceAccountId,
      undefined,
      snapshot.connectorId
    ))
  const facts = orderId ? await documentFacts(tx, organizationId, orderId) : null
  const partyId = facts?.get('order_contact')?.related ?? null
  const payloadHash = accountingBasisHash({
    sourceObjectId: object.id,
    ...movement,
    amountMinor: movement.amountMinor.toString(),
    occurredAt: movement.occurredAt.toISOString(),
  })
  const commandKey = `source-money:${object.id}`
  let command = await findMoneyCommandByKey(tx, organizationId, commandKey, {
    kind: IMPORT_COMMAND_KIND,
    payloadHash,
  })
  if (!command)
    [command] = await tx
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey,
        kind: IMPORT_COMMAND_KIND,
        payloadHash,
        actorSnapshot: { kind: 'source_record', ...snapshot },
      })
      .returning()
  if (!money) {
    money = await insertMovement(tx, organizationId, command!.id, {
      purpose: movement.purpose,
      amountMinor: movement.amountMinor,
      when: { instant: movement.occurredAt },
      partyInstanceId: partyId,
      endpoint: {
        paymentGatewayId: null,
        cashAccountInstanceId: null,
        currency: movement.currency,
      },
      // Channel money names no method; the feed link stamps the rail at post time.
      method: null,
      currency: { code: movement.currency, exponent: movement.currencyExponent },
      reference: source.data.paymentId,
    })
    const [inserted] = await tx
      .insert(schema.MoneySourceLink)
      .values({
        organizationId,
        sourceObjectId: object.id,
        moneyTransactionId: money!.id,
        verifiedByCommandId: command!.id,
      })
      .returning()
    linked = inserted ?? null
    await tx
      .update(schema.MoneyCommand)
      .set({ resultIds: { moneyTransactionId: money!.id } })
      .where(eq(schema.MoneyCommand.id, command!.id))
    // The receipt a payout item has been waiting for has just arrived (§9.2).
    await pokePendingMatchesForSourceObject(tx, organizationId, object.id)
  }
  if (!money) throw new Error('Money materialization failed')
  const base = { moneyTransactionId: money.id, orderInstanceId: orderId }
  // An accepted receipt already stands on its own facts; a refusal from here on
  // holds only its order link, never the entry (91 §8.6).
  const linking = acceptance.state === 'accepted' && money.purpose === 'customer_receipt'
  const block = async (reasonCode: WorkItemCode) => {
    await park(reasonCode)
    await updateAcceptance(tx, organizationId, acceptance.id, {
      ...base,
      state: linking ? 'accepted' : 'blocked',
    })
  }
  // A poster that met the acceptance unsettled parked `EVIDENCE_PENDING`; accepting wakes it.
  const wakePost = () =>
    wakeSources(tx, organizationId, {
      sourceKind: 'money_transaction',
      sourceIds: [money.id],
      stage: 'post',
    })
  if (!orderId || !facts) {
    if (money.purpose !== 'customer_receipt') return block('ORDER_NOT_FOUND')
    // Post now, link later: the order's arrival wakes this row by external id (91 §8.6).
    await park('ORDER_NOT_FOUND')
    await updateAcceptance(tx, organizationId, acceptance.id, { ...base, state: 'accepted' })
    await wakePost()
    return
  }
  if (!partyId || facts.get('order_currency')?.text !== money.currency)
    return block('CUSTOMER_UNRESOLVED')
  // The guest is a stand-in: a receipt ingested while its order still named the
  // guest takes the customer the order names now, never a `CUSTOMER_CHANGED`.
  const guestId = await getOrganizationSetting({
    organizationId,
    key: GUEST_CONTACT_SETTING_KEY,
    db: tx,
  })
  const provisional = !money.partyInstanceId || money.partyInstanceId === guestId
  if (!provisional && money.partyInstanceId !== partyId) return block('CUSTOMER_CHANGED')
  if (money.partyInstanceId !== partyId)
    await tx
      .update(schema.MoneyTransaction)
      .set({ partyInstanceId: partyId })
      .where(eq(schema.MoneyTransaction.id, money.id))
  const zone = await getOrganizationSetting({
    organizationId,
    key: 'accounting.bookTimeZone',
  })
  let effectiveDate: string
  try {
    if (typeof zone !== 'string' || !zone.trim()) throw new Error('missing timezone')
    effectiveDate = periodKeyForDate(money.occurredAt!, 'day', zone)
  } catch {
    return block('SETUP_INCOMPLETE')
  }
  if (money.purpose === 'customer_receipt') {
    const existing = await tx.query.MoneyApplication.findFirst({
      where: and(
        eq(schema.MoneyApplication.organizationId, organizationId),
        eq(schema.MoneyApplication.moneyTransactionId, money.id),
        eq(schema.MoneyApplication.orderInstanceId, orderId),
        eq(schema.MoneyApplication.operation, 'apply')
      ),
    })
    if (!existing) {
      const usedMoney = await sumAppliedToMovement(tx, organizationId, money.id)
      if (usedMoney !== 0n) return block('MOVEMENT_ALREADY_APPLIED')
      const total = facts.get('order_total')?.amount
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)
        return block('ORDER_BALANCE_UNRESOLVED')
      const applied = await sumAppliedToOrder(tx, organizationId, orderId)
      if (applied + money.amountMinor > BigInt(total)) return block('RECEIPT_EXCEEDS_ORDER')
      await insertApplication(tx, organizationId, command!.id, {
        moneyTransactionId: money.id,
        operation: 'apply',
        amountMinor: money.amountMinor,
        orderInstanceId: orderId,
        appliedAt: money.occurredAt!,
        effectiveDate,
        commandItemKey: 'initial_order',
      })
    }
    // The link step of "post now, link later": a no-op until the receipt has posted.
    await linkReceiptPostingToOrderInTx(tx, organizationId, {
      moneyTransactionId: money.id,
      orderInstanceId: orderId,
    })
  } else {
    // The link step, never a precondition: the refund posts whether or not its memo is here (91 D4).
    await linkImportedRefundInTx(tx, organizationId, {
      money,
      sourceAccountId: object.sourceAccountId,
      data: source.data,
      snapshot,
      commandId: command!.id,
    })
  }
  await settle()
  await updateAcceptance(tx, organizationId, acceptance.id, { ...base, state: 'accepted' })
  await wakePost()
}

type ObservationData = Extract<
  ReturnType<typeof readStoredCustomerMoneyObservation>,
  { success: true }
>['data']

type ReportingSnapshot = {
  credentialId?: string
  connectorId?: string
  creditMemoInstanceId?: string
}

/**
 * Write a channel refund's `MoneyRefundSettlement` once the memo it names exists, then
 * link its posting (91 §4.4). `false` while the memo has not arrived.
 */
async function linkImportedRefundInTx(
  tx: Transaction,
  organizationId: string,
  input: {
    money: NonNullable<Awaited<ReturnType<typeof readMovement>>>
    sourceAccountId: string
    data: ObservationData
    snapshot: ReportingSnapshot
    commandId: string
  }
): Promise<boolean> {
  const { money, data, snapshot } = input
  const [existing] = await listRefundSettlements(tx, organizationId, {
    refundTransactionId: money.id,
  })
  if (existing) return false
  const explicitCreditId = data.creditMemoInstanceId ?? snapshot.creditMemoInstanceId
  if (!explicitCreditId && !data.creditMemoExternalId) return false
  const creditId = await typedDocument(
    tx,
    organizationId,
    snapshot.credentialId,
    data.creditMemoExternalId ?? '',
    'credit_memo',
    input.sourceAccountId,
    explicitCreditId,
    snapshot.connectorId
  )
  if (!creditId) return false
  const originalObject = data.parentTransactionId
    ? await findSourceObjectByIdentity(tx, organizationId, {
        sourceAccountId: input.sourceAccountId,
        objectType: 'order_transaction',
        externalId: data.parentTransactionId,
        componentKey: '',
      })
    : undefined
  const originalLink = originalObject
    ? await findSourceLink(tx, organizationId, originalObject.id)
    : null
  const original = originalLink
    ? await readMovement(tx, organizationId, originalLink.moneyTransactionId)
    : null
  await tx.insert(schema.MoneyRefundSettlement).values({
    organizationId,
    refundTransactionId: money.id,
    originalTransactionId:
      original?.purpose === 'customer_receipt' && original.currency === money.currency
        ? original.id
        : null,
    amountMinor: money.amountMinor,
    disposition: 'customer_credit',
    customerCreditMemoInstanceId: creditId,
    commandId: input.commandId,
    commandItemKey: 'initial_credit',
  })
  await linkRefundPostingToMemos(tx, organizationId, money.id)
  return true
}

/**
 * The link step from the memo's side: channel refunds on its order that arrived
 * before it and name it. Returns how many were linked.
 */
export async function linkImportedRefundsToMemo(
  db: Database,
  organizationId: string,
  creditMemoInstanceId: string
): Promise<number> {
  const memoOrderId = (await documentFacts(db, organizationId, creditMemoInstanceId)).get(
    'credit_memo_order'
  )?.related
  if (!memoOrderId) return 0
  const acceptance = schema.FinancialSourceAcceptance
  const rows = await db
    .select({
      sourceObjectId: acceptance.sourceObjectId,
      observationId: acceptance.observationId,
      unresolvedReferences: acceptance.unresolvedReferences,
      moneyTransactionId: schema.MoneyTransaction.id,
    })
    .from(acceptance)
    .innerJoin(
      schema.MoneyTransaction,
      and(
        eq(schema.MoneyTransaction.organizationId, acceptance.organizationId),
        eq(schema.MoneyTransaction.id, acceptance.moneyTransactionId)
      )
    )
    .where(
      and(
        eq(acceptance.organizationId, organizationId),
        eq(acceptance.orderInstanceId, memoOrderId),
        eq(acceptance.state, 'accepted'),
        eq(schema.MoneyTransaction.purpose, 'customer_refund'),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.MoneyRefundSettlement} s
          WHERE s."organizationId" = ${organizationId}
          AND s."refundTransactionId" = ${schema.MoneyTransaction.id})`
      )
    )
  let linked = 0
  for (const row of rows) {
    const done = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, organizationId)
      const object = await readSourceObject(tx, organizationId, row.sourceObjectId)
      const observation = await tx.query.FinancialSourceObservation.findFirst({
        where: and(
          eq(schema.FinancialSourceObservation.organizationId, organizationId),
          eq(schema.FinancialSourceObservation.id, row.observationId)
        ),
      })
      const parsed = readStoredCustomerMoneyObservation(observation?.payload)
      const money = await readMovement(tx, organizationId, row.moneyTransactionId)
      const command = object
        ? await tx.query.MoneyCommand.findFirst({
            where: and(
              eq(schema.MoneyCommand.organizationId, organizationId),
              eq(schema.MoneyCommand.commandKey, `source-money:${object.id}`)
            ),
          })
        : undefined
      if (!object || !parsed.success || !money || !command) return false
      return linkImportedRefundInTx(tx, organizationId, {
        money,
        sourceAccountId: object.sourceAccountId,
        data: parsed.data,
        snapshot: {
          ...(observation!.reportingInstallationSnapshot as ReportingSnapshot),
          ...(row.unresolvedReferences as ReportingSnapshot),
        },
        commandId: command.id,
      })
    })
    if (done) linked++
  }
  return linked
}

/** Refresh acceptance coverage from durable states after relationship recovery. */
async function refreshMoneyCoverageInTx(
  tx: Transaction,
  organizationId: string,
  acceptanceId: string
) {
  const acceptance = await readAcceptance(tx, organizationId, acceptanceId)
  if (!acceptance?.orderInstanceId) return
  const object = await readSourceObject(tx, organizationId, acceptance.sourceObjectId)
  if (!object) return
  await refreshOrderCoverageCounts(tx, organizationId, {
    sourceAccountId: object.sourceAccountId,
    orderInstanceId: acceptance.orderInstanceId,
  })
}

/**
 * Bounded retry through the recovery job: acceptances never tried first, then due
 * `evidence` work items. A throw parks the acceptance as `blocked` with a transient row.
 */
export async function sweepImportedCustomerMoney(
  db: Database,
  organizationId: string,
  limit = 100
): Promise<{ examined: number; failed: number }> {
  const counts = await runWorkItemSweep(db, {
    organizationId,
    stage: 'evidence',
    sourceKind: ACCEPTANCE_SOURCE_KIND,
    limit: Math.min(Math.max(limit, 1), 100),
    listFresh: async (fresh) =>
      (
        await db
          .select({ id: schema.FinancialSourceAcceptance.id })
          .from(schema.FinancialSourceAcceptance)
          .where(
            and(
              eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
              inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked']),
              noWorkItem(organizationId, {
                stage: 'evidence',
                sourceKind: ACCEPTANCE_SOURCE_KIND,
                sourceId: schema.FinancialSourceAcceptance.id,
              })
            )
          )
          .orderBy(asc(schema.FinancialSourceAcceptance.updatedAt))
          .limit(fresh)
      ).map((row) => row.id),
    handle: async (acceptanceId) => {
      const row = await readAcceptance(db, organizationId, acceptanceId)
      // An accepted row still due is a receipt waiting to link its order (91 §8.6).
      if (!row || row.state === 'rejected') {
        await deleteWorkItem(db, organizationId, acceptanceWorkKey(acceptanceId))
        return { status: 'skipped' }
      }
      try {
        await db.transaction(async (tx) => {
          await materializeImportedMoneyInTx(tx, organizationId, acceptanceId)
          await refreshMoneyCoverageInTx(tx, organizationId, acceptanceId)
        })
        return { status: 'accepted' }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Source recovery failed'
        await db.transaction(async (tx) => {
          await withAccountingCommitLock(tx, organizationId)
          await upsertWorkItem(tx, organizationId, {
            ...acceptanceWorkKey(acceptanceId),
            reasonCode: 'TRANSIENT_ERROR',
            detail: { message },
          })
          await updateAcceptance(
            tx,
            organizationId,
            acceptanceId,
            { state: 'blocked' },
            // Only if nothing else has moved the row since this attempt started.
            and(
              eq(schema.FinancialSourceAcceptance.observationId, row.observationId),
              inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked'])
            )
          )
        })
        return { status: 'failed' }
      }
    },
  })
  return { examined: counts.scanned, failed: counts.failed ?? 0 }
}
