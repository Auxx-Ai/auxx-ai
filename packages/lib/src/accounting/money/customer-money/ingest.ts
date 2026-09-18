// packages/lib/src/accounting/money/customer-money/ingest.ts

import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { ConflictError } from '../../../errors'
import {
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../../sales/credit-memos/reads'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { pokePendingMatchesForSourceObject } from '../payouts/match-poke'
import { confirmedCustomerMovement } from './contracts'
import {
  readStoredCustomerMoneyObservation,
  resolveSourceDocumentFromConnector,
} from './source-observation-adapter'

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
  // A provider namespace alone cannot distinguish two connected merchant accounts.
  const fromConnector = () =>
    resolveSourceDocumentFromConnector(tx, {
      organizationId,
      connectorId: connectorId,
      sourceAccountId,
      externalId,
      kind,
    })
  if (!connectionId || !sourceAccountId) return fromConnector()
  const account = await tx.query.FinancialSourceAccount.findFirst({
    where: and(
      eq(schema.FinancialSourceAccount.organizationId, organizationId),
      eq(schema.FinancialSourceAccount.id, sourceAccountId)
    ),
  })
  if (!account) return null
  const rows = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId),
        eq(schema.EntityInstance.organizationId, schema.RecordIdentity.organizationId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.source, account.providerKey),
        eq(schema.RecordIdentity.connectionId, connectionId),
        eq(schema.RecordIdentity.externalId, externalId),
        eq(schema.EntityDefinition.entityType, kind),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(2)
  return rows.length === 1 ? rows[0]!.id : rows.length === 0 ? fromConnector() : null
}

async function documentFacts(tx: Transaction, organizationId: string, entityId: string) {
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

async function updateAcceptance(
  tx: Transaction,
  id: string,
  values: Partial<typeof schema.FinancialSourceAcceptance.$inferInsert>
) {
  await tx
    .update(schema.FinancialSourceAcceptance)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.FinancialSourceAcceptance.id, id))
}

/** Materialize or resolve one durable source observation; shared lock protects money capacities. */
export async function materializeImportedMoneyInTx(
  tx: Transaction,
  organizationId: string,
  acceptanceId: string
): Promise<void> {
  await withAccountingCommitLock(tx, organizationId)
  const acceptance = await tx.query.FinancialSourceAcceptance.findFirst({
    where: and(
      eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
      eq(schema.FinancialSourceAcceptance.id, acceptanceId)
    ),
  })
  if (!acceptance) return
  const observation = await tx.query.FinancialSourceObservation.findFirst({
    where: and(
      eq(schema.FinancialSourceObservation.organizationId, organizationId),
      eq(schema.FinancialSourceObservation.id, acceptance.observationId)
    ),
  })
  if (!observation) throw new Error('Source observation is missing')
  const object = await tx.query.FinancialSourceObject.findFirst({
    where: and(
      eq(schema.FinancialSourceObject.organizationId, organizationId),
      eq(schema.FinancialSourceObject.id, acceptance.sourceObjectId)
    ),
  })
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
    await updateAcceptance(tx, acceptance.id, { orderInstanceId: acquiredOrderId })
  const source = readStoredCustomerMoneyObservation(observation.payload)
  if (!source.success) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'rejected',
      reason: 'Invalid transaction identity or money evidence',
    })
    return
  }
  if (
    acceptance.moneyTransactionId &&
    (source.data.status !== 'confirmed' || !['receipt', 'refund'].includes(source.data.kind))
  ) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'blocked',
      reason:
        'Accepted money source no longer reports the same confirmed movement; explicit correction required',
    })
    return
  }
  const sourceAccount = await tx.query.FinancialSourceAccount.findFirst({
    where: and(
      eq(schema.FinancialSourceAccount.organizationId, organizationId),
      eq(schema.FinancialSourceAccount.id, object.sourceAccountId)
    ),
    columns: { environment: true },
  })
  if (!sourceAccount) throw new Error('Source account is outside this organization')
  if (source.data.test || sourceAccount.environment === 'test') {
    await updateAcceptance(tx, acceptance.id, {
      state: 'accepted',
      reason: 'Test-mode observation; no operational money created',
      nextAttemptAt: null,
    })
    return
  }
  if (['authorization', 'void'].includes(source.data.kind) || source.data.status === 'failed') {
    await updateAcceptance(tx, acceptance.id, {
      state: 'accepted',
      reason: 'Source observation records no confirmed cash movement',
      nextAttemptAt: null,
    })
    return
  }
  if (source.data.status !== 'confirmed') {
    await updateAcceptance(tx, acceptance.id, {
      state: 'pending',
      reason: 'Transaction success is not yet confirmed',
    })
    return
  }
  let movement: ReturnType<typeof confirmedCustomerMovement>
  try {
    movement = confirmedCustomerMovement(source.data)
  } catch (error) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'rejected',
      reason: error instanceof Error ? error.message : String(error),
    })
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
  let linked = await tx.query.MoneySourceLink.findFirst({
    where: and(
      eq(schema.MoneySourceLink.organizationId, organizationId),
      eq(schema.MoneySourceLink.sourceObjectId, object.id)
    ),
  })
  let money = linked
    ? await tx.query.MoneyTransaction.findFirst({
        where: and(
          eq(schema.MoneyTransaction.organizationId, organizationId),
          eq(schema.MoneyTransaction.id, linked.moneyTransactionId)
        ),
      })
    : undefined
  if (
    money &&
    (money.amountMinor !== movement.amountMinor ||
      money.currency !== movement.currency ||
      money.purpose !== movement.purpose ||
      money.occurredAt?.getTime() !== movement.occurredAt.getTime())
  ) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'blocked',
      reason: 'Observed movement changed; explicit accounting correction required',
    })
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
  let command = await tx.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, organizationId),
      eq(schema.MoneyCommand.commandKey, commandKey)
    ),
  })
  if (command && command.payloadHash !== payloadHash)
    throw new ConflictError('Source command has conflicting money evidence')
  if (!command)
    [command] = await tx
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey,
        kind: 'import_customer_money',
        payloadHash,
        actorSnapshot: { kind: 'source_record', ...snapshot },
      })
      .returning()
  if (!money) {
    ;[money] = await tx
      .insert(schema.MoneyTransaction)
      .values({
        organizationId,
        ...movement,
        datePrecision: 'instant',
        partyInstanceId: partyId,
        recordedByCommandId: command!.id,
        reference: source.data.paymentId,
      })
      .returning()
    ;[linked] = await tx
      .insert(schema.MoneySourceLink)
      .values({
        organizationId,
        sourceObjectId: object.id,
        moneyTransactionId: money!.id,
        verifiedByCommandId: command!.id,
      })
      .returning()
    await tx
      .update(schema.MoneyCommand)
      .set({ resultIds: { moneyTransactionId: money!.id } })
      .where(eq(schema.MoneyCommand.id, command!.id))
    // The receipt a payout item has been waiting for has just arrived (§9.2).
    await pokePendingMatchesForSourceObject(tx, organizationId, object.id)
  }
  if (!money) throw new Error('Money materialization failed')
  const base = {
    moneyTransactionId: money.id,
    orderInstanceId: orderId,
    attempts: acceptance.attempts + 1,
    nextAttemptAt: new Date(Date.now() + 60_000),
  }
  if (!orderId || !facts) {
    await updateAcceptance(tx, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Order reference is unresolved',
    })
    return
  }
  if (!partyId || facts.get('order_currency')?.text !== money.currency) {
    await updateAcceptance(tx, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Order customer or currency is unresolved or incompatible',
    })
    return
  }
  if (money.partyInstanceId && money.partyInstanceId !== partyId) {
    await updateAcceptance(tx, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Observed customer differs from the immutable movement customer',
    })
    return
  }
  if (!money.partyInstanceId)
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
    await updateAcceptance(tx, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Book timezone is unresolved or invalid',
    })
    return
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
      const movementApplications = await tx.query.MoneyApplication.findMany({
        where: and(
          eq(schema.MoneyApplication.organizationId, organizationId),
          eq(schema.MoneyApplication.moneyTransactionId, money.id)
        ),
      })
      const usedMoney = movementApplications.reduce(
        (sum, row) => sum + (row.operation === 'apply' ? row.amountMinor : -row.amountMinor),
        0n
      )
      if (usedMoney !== 0n) {
        await updateAcceptance(tx, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Movement is already applied; new source evidence cannot apply it again',
        })
        return
      }
      const total = facts.get('order_total')?.amount
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
        await updateAcceptance(tx, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Order balance is unresolved',
        })
        return
      }
      const applications = await tx.query.MoneyApplication.findMany({
        where: and(
          eq(schema.MoneyApplication.organizationId, organizationId),
          eq(schema.MoneyApplication.orderInstanceId, orderId)
        ),
      })
      const applied = applications.reduce(
        (sum, row) => sum + (row.operation === 'apply' ? row.amountMinor : -row.amountMinor),
        0n
      )
      if (applied + money.amountMinor > BigInt(total)) {
        await updateAcceptance(tx, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Confirmed receipt exceeds the remaining order obligation',
        })
        return
      }
      await tx.insert(schema.MoneyApplication).values({
        organizationId,
        moneyTransactionId: money.id,
        operation: 'apply',
        amountMinor: money.amountMinor,
        orderInstanceId: orderId,
        appliedAt: money.occurredAt!,
        effectiveDate,
        commandId: command!.id,
        commandItemKey: 'initial_order',
      })
    }
  } else {
    const existing = await tx.query.MoneyRefundSettlement.findFirst({
      where: and(
        eq(schema.MoneyRefundSettlement.organizationId, organizationId),
        eq(schema.MoneyRefundSettlement.refundTransactionId, money.id)
      ),
    })
    if (!existing) {
      const originalObject = source.data.parentTransactionId
        ? await tx.query.FinancialSourceObject.findFirst({
            where: and(
              eq(schema.FinancialSourceObject.organizationId, organizationId),
              eq(schema.FinancialSourceObject.sourceAccountId, object.sourceAccountId),
              eq(schema.FinancialSourceObject.objectType, 'order_transaction'),
              eq(schema.FinancialSourceObject.externalId, source.data.parentTransactionId)
            ),
          })
        : undefined
      const originalLink = originalObject
        ? await tx.query.MoneySourceLink.findFirst({
            where: and(
              eq(schema.MoneySourceLink.organizationId, organizationId),
              eq(schema.MoneySourceLink.sourceObjectId, originalObject.id)
            ),
          })
        : undefined
      const creditId =
        source.data.creditMemoInstanceId ||
        snapshot.creditMemoInstanceId ||
        source.data.creditMemoExternalId
          ? await typedDocument(
              tx,
              organizationId,
              snapshot.credentialId,
              source.data.creditMemoExternalId ?? '',
              'credit_memo',
              object.sourceAccountId,
              source.data.creditMemoInstanceId ?? snapshot.creditMemoInstanceId,
              snapshot.connectorId
            )
          : null
      if (!originalLink || !creditId) {
        await updateAcceptance(tx, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Refund original receipt or credit document is unresolved',
        })
        return
      }
      const original = await tx.query.MoneyTransaction.findFirst({
        where: and(
          eq(schema.MoneyTransaction.organizationId, organizationId),
          eq(schema.MoneyTransaction.id, originalLink.moneyTransactionId)
        ),
      })
      const creditFacts = await documentFacts(tx, organizationId, creditId)
      const creditTotal = creditFacts.get('credit_memo_total')?.amount
      const settlements = await tx.query.MoneyRefundSettlement.findMany({
        where: and(
          eq(schema.MoneyRefundSettlement.organizationId, organizationId),
          or(
            eq(schema.MoneyRefundSettlement.originalTransactionId, originalLink.moneyTransactionId),
            eq(schema.MoneyRefundSettlement.customerCreditMemoInstanceId, creditId)
          )
        ),
      })
      const originalUsed = settlements
        .filter((row) => row.originalTransactionId === originalLink.moneyTransactionId)
        .reduce((sum, row) => sum + row.amountMinor, 0n)
      const [creditApplied, creditReserved] = await Promise.all([
        sumCreditMemoApplications(tx as unknown as Database, organizationId, creditId),
        // The current imported refund is not a settlement yet. Its source projection
        // can already include it, so this gate uses actual reservations only.
        sumReservedCreditMemoRefunds(tx as unknown as Database, organizationId, {
          id: creditId,
          source: 'native',
          amountRefundedMinor: 0,
        }),
      ])
      if (
        !original ||
        original.purpose !== 'customer_receipt' ||
        original.currency !== money.currency ||
        original.partyInstanceId !== partyId ||
        originalUsed + money.amountMinor > original.amountMinor ||
        typeof creditTotal !== 'number' ||
        !Number.isSafeInteger(creditTotal) ||
        BigInt(creditApplied) + BigInt(creditReserved) + money.amountMinor > BigInt(creditTotal) ||
        creditFacts.get('credit_memo_currency')?.text !== money.currency ||
        creditFacts.get('credit_memo_contact')?.related !== partyId
      ) {
        await updateAcceptance(tx, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Refund capacity, credit currency or customer does not match',
        })
        return
      }
      await tx.insert(schema.MoneyRefundSettlement).values({
        organizationId,
        refundTransactionId: money.id,
        originalTransactionId: original.id,
        amountMinor: money.amountMinor,
        disposition: 'customer_credit',
        customerCreditMemoInstanceId: creditId,
        commandId: command!.id,
        commandItemKey: 'initial_credit',
      })
    }
  }
  await updateAcceptance(tx, acceptance.id, {
    ...base,
    state: 'accepted',
    reason: null,
    nextAttemptAt: null,
  })
}

/** Refresh acceptance coverage from durable states after relationship recovery. */
async function refreshMoneyCoverageInTx(
  tx: Transaction,
  organizationId: string,
  acceptanceId: string
) {
  const acceptance = await tx.query.FinancialSourceAcceptance.findFirst({
    where: and(
      eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
      eq(schema.FinancialSourceAcceptance.id, acceptanceId)
    ),
  })
  if (!acceptance) return
  const object = await tx.query.FinancialSourceObject.findFirst({
    where: and(
      eq(schema.FinancialSourceObject.organizationId, organizationId),
      eq(schema.FinancialSourceObject.id, acceptance.sourceObjectId)
    ),
  })
  if (!object) return
  const coverage = await tx.query.FinancialSourceCoverage.findFirst({
    where: and(
      eq(schema.FinancialSourceCoverage.organizationId, organizationId),
      eq(schema.FinancialSourceCoverage.sourceAccountId, object.sourceAccountId),
      eq(schema.FinancialSourceCoverage.streamKey, 'order_transactions'),
      eq(schema.FinancialSourceCoverage.windowKey, acceptance.orderInstanceId ?? '')
    ),
  })
  if (!coverage) return
  const rows = await tx
    .select({ state: schema.FinancialSourceAcceptance.state })
    .from(schema.FinancialSourceAcceptance)
    .innerJoin(
      schema.FinancialSourceObject,
      and(
        eq(
          schema.FinancialSourceObject.organizationId,
          schema.FinancialSourceAcceptance.organizationId
        ),
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceAcceptance.sourceObjectId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceObject.sourceAccountId, object.sourceAccountId),
        eq(schema.FinancialSourceAcceptance.orderExternalId, acceptance.orderExternalId)
      )
    )
  const acceptedCount = rows.filter((row) => row.state === 'accepted').length
  const rejectedCount = rows.filter((row) => row.state === 'rejected').length
  const pendingCount = rows.length - acceptedCount - rejectedCount
  const fetched = coverage.fetchedBoundary as { sourceComplete?: boolean }
  await tx
    .update(schema.FinancialSourceCoverage)
    .set({
      fetchedCount: rows.length,
      acceptedCount,
      rejectedCount,
      pendingCount,
      complete:
        fetched.sourceComplete === true &&
        coverage.fetchedCount === rows.length &&
        rejectedCount === 0 &&
        pendingCount === 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.FinancialSourceCoverage.id, coverage.id))
}

/** Bounded retry through the existing maintenance job; isolate failed records and rotate fairly. */
export async function sweepImportedCustomerMoney(
  db: Database,
  organizationId: string,
  limit = 100
) {
  const rows = await db.query.FinancialSourceAcceptance.findMany({
    where: and(
      eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
      inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked']),
      or(
        isNull(schema.FinancialSourceAcceptance.nextAttemptAt),
        lte(schema.FinancialSourceAcceptance.nextAttemptAt, new Date())
      )
    ),
    orderBy: asc(schema.FinancialSourceAcceptance.updatedAt),
    limit: Math.min(Math.max(limit, 1), 100),
  })
  let failed = 0
  for (const row of rows) {
    try {
      await db.transaction(async (tx) => {
        await materializeImportedMoneyInTx(tx, organizationId, row.id)
        await refreshMoneyCoverageInTx(tx, organizationId, row.id)
      })
    } catch (error) {
      failed++
      await db.transaction(async (tx) => {
        await withAccountingCommitLock(tx, organizationId)
        await tx
          .update(schema.FinancialSourceAcceptance)
          .set({
            state: 'blocked',
            reason: error instanceof Error ? error.message : 'Source recovery failed',
            attempts: row.attempts + 1,
            nextAttemptAt: new Date(Date.now() + 60_000),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
              eq(schema.FinancialSourceAcceptance.id, row.id),
              eq(schema.FinancialSourceAcceptance.observationId, row.observationId),
              inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked'])
            )
          )
      })
    }
  }
  return { examined: rows.length, failed }
}
