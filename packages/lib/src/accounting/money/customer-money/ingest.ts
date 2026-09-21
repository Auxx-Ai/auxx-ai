// packages/lib/src/accounting/money/customer-money/ingest.ts

import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { ConflictError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { periodKeyForDate } from '../../ledger/periods/periods'
import {
  readReceiptRefundEndpoints,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../sales/credit-memos/reads'
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
  const account = await readSourceAccount(tx, organizationId, sourceAccountId)
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

/** Materialize or resolve one durable source observation; shared lock protects money capacities. */
export async function materializeImportedMoneyInTx(
  tx: Transaction,
  organizationId: string,
  acceptanceId: string
): Promise<void> {
  await withAccountingCommitLock(tx, organizationId)
  const acceptance = await readAcceptance(tx, organizationId, acceptanceId)
  if (!acceptance) return
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
    await updateAcceptance(tx, organizationId, acceptance.id, {
      state: 'rejected',
      reason: 'Invalid transaction identity or money evidence',
    })
    return
  }
  if (
    acceptance.moneyTransactionId &&
    (source.data.status !== 'confirmed' || !['receipt', 'refund'].includes(source.data.kind))
  ) {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      state: 'blocked',
      reason:
        'Accepted money source no longer reports the same confirmed movement; explicit correction required',
    })
    return
  }
  const sourceAccount = await readSourceAccount(tx, organizationId, object.sourceAccountId)
  if (!sourceAccount) throw new Error('Source account is outside this organization')
  if (source.data.test || sourceAccount.environment === 'test') {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      state: 'accepted',
      reason: 'Test-mode observation; no operational money created',
      nextAttemptAt: null,
    })
    return
  }
  if (['authorization', 'void'].includes(source.data.kind) || source.data.status === 'failed') {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      state: 'accepted',
      reason: 'Source observation records no confirmed cash movement',
      nextAttemptAt: null,
    })
    return
  }
  if (source.data.status !== 'confirmed') {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      state: 'pending',
      reason: 'Transaction success is not yet confirmed',
    })
    return
  }
  let movement: ReturnType<typeof confirmedCustomerMovement>
  try {
    movement = confirmedCustomerMovement(source.data)
  } catch (error) {
    await updateAcceptance(tx, organizationId, acceptance.id, {
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
    await updateAcceptance(tx, organizationId, acceptance.id, {
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
  const base = {
    moneyTransactionId: money.id,
    orderInstanceId: orderId,
    attempts: acceptance.attempts + 1,
    nextAttemptAt: new Date(Date.now() + 60_000),
  }
  if (!orderId || !facts) {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Order reference is unresolved',
    })
    return
  }
  if (!partyId || facts.get('order_currency')?.text !== money.currency) {
    await updateAcceptance(tx, organizationId, acceptance.id, {
      ...base,
      state: 'blocked',
      reason: 'Order customer or currency is unresolved or incompatible',
    })
    return
  }
  if (money.partyInstanceId && money.partyInstanceId !== partyId) {
    await updateAcceptance(tx, organizationId, acceptance.id, {
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
    await updateAcceptance(tx, organizationId, acceptance.id, {
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
      const usedMoney = await sumAppliedToMovement(tx, organizationId, money.id)
      if (usedMoney !== 0n) {
        await updateAcceptance(tx, organizationId, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Movement is already applied; new source evidence cannot apply it again',
        })
        return
      }
      const total = facts.get('order_total')?.amount
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
        await updateAcceptance(tx, organizationId, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Order balance is unresolved',
        })
        return
      }
      const applied = await sumAppliedToOrder(tx, organizationId, orderId)
      if (applied + money.amountMinor > BigInt(total)) {
        await updateAcceptance(tx, organizationId, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Confirmed receipt exceeds the remaining order obligation',
        })
        return
      }
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
  } else {
    const [existing] = await listRefundSettlements(tx, organizationId, {
      refundTransactionId: money.id,
    })
    if (!existing) {
      const originalObject = source.data.parentTransactionId
        ? await findSourceObjectByIdentity(tx, organizationId, {
            sourceAccountId: object.sourceAccountId,
            objectType: 'order_transaction',
            externalId: source.data.parentTransactionId,
            componentKey: '',
          })
        : undefined
      const originalLink = originalObject
        ? await findSourceLink(tx, organizationId, originalObject.id)
        : null
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
        await updateAcceptance(tx, organizationId, acceptance.id, {
          ...base,
          state: 'blocked',
          reason: 'Refund original receipt or credit document is unresolved',
        })
        return
      }
      const original = await readMovement(tx, organizationId, originalLink.moneyTransactionId)
      const creditFacts = await documentFacts(tx, organizationId, creditId)
      const creditTotal = creditFacts.get('credit_memo_total')?.amount
      const settlements = await listRefundSettlements(tx, organizationId, {
        originalTransactionIds: [originalLink.moneyTransactionId],
        customerCreditMemoInstanceId: creditId,
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
        await updateAcceptance(tx, organizationId, acceptance.id, {
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
      // The refund went back the way the receipt came in — read THROUGH the
      // receipt's deposit, so a banked receipt's refund leaves the account the
      // deposit put it in rather than undeposited funds (task 71 D6).
      const endpoint = (
        await readReceiptRefundEndpoints(tx as unknown as Database, organizationId, [original])
      ).get(original.id)
      if (
        endpoint &&
        (endpoint.paymentGatewayId || endpoint.cashAccountInstanceId) &&
        !money.paymentGatewayId &&
        !money.cashAccountInstanceId
      )
        await tx
          .update(schema.MoneyTransaction)
          .set({
            paymentGatewayId: endpoint.paymentGatewayId,
            cashAccountInstanceId: endpoint.cashAccountInstanceId,
          })
          .where(
            and(
              eq(schema.MoneyTransaction.organizationId, organizationId),
              eq(schema.MoneyTransaction.id, money.id),
              isNull(schema.MoneyTransaction.paymentGatewayId),
              isNull(schema.MoneyTransaction.cashAccountInstanceId)
            )
          )
    }
  }
  await updateAcceptance(tx, organizationId, acceptance.id, {
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
  const acceptance = await readAcceptance(tx, organizationId, acceptanceId)
  if (!acceptance?.orderInstanceId) return
  const object = await readSourceObject(tx, organizationId, acceptance.sourceObjectId)
  if (!object) return
  await refreshOrderCoverageCounts(tx, organizationId, {
    sourceAccountId: object.sourceAccountId,
    orderInstanceId: acceptance.orderInstanceId,
  })
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
        await updateAcceptance(
          tx,
          organizationId,
          row.id,
          {
            state: 'blocked',
            reason: error instanceof Error ? error.message : 'Source recovery failed',
            attempts: row.attempts + 1,
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
          // Only if nothing else has moved the row since this attempt started.
          and(
            eq(schema.FinancialSourceAcceptance.observationId, row.observationId),
            inArray(schema.FinancialSourceAcceptance.state, ['pending', 'blocked'])
          )
        )
      })
    }
  }
  return { examined: rows.length, failed }
}
