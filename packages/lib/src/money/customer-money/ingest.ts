// packages/lib/src/money/customer-money/ingest.ts
import { type Database, schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { accountingBasisHash } from '../../postings/effect-basis'
import { periodKeyForDate } from '../../postings/periods'
import {
  confirmedShopifyMovement,
  shopifyMoneyEnvelopeSchema,
  shopifyMoneyObservationSchema,
  shopifySourceDomain,
} from './contracts'

/** Authenticated connector context. Stable store identity is read from its credential, not supplied. */
export interface IngestShopifyOrderMoneyInput {
  organizationId: string
  credentialId: string
  appInstallationId: string
  connectorId: string
  runId: string
  orderExternalId: string
  envelope: unknown
}

async function sourceAccountInTx(
  tx: Transaction,
  input: IngestShopifyOrderMoneyInput,
  environment: 'live' | 'test'
) {
  const credential = await tx.query.Credential.findFirst({
    where: and(
      eq(schema.Credential.id, input.credentialId),
      eq(schema.Credential.organizationId, input.organizationId)
    ),
    columns: { appId: true, appInstallationId: true, metadata: true },
  })
  if (!credential?.appId || credential.appInstallationId !== input.appInstallationId)
    throw new UnprocessableEntityError(
      'Shopify source connection does not match this organization and installation'
    )
  const app = await tx.query.App.findFirst({
    where: eq(schema.App.id, credential.appId),
    columns: { slug: true },
  })
  const installation = await tx.query.AppInstallation.findFirst({
    where: and(
      eq(schema.AppInstallation.id, input.appInstallationId),
      eq(schema.AppInstallation.organizationId, input.organizationId),
      eq(schema.AppInstallation.appId, credential.appId),
      isNull(schema.AppInstallation.uninstalledAt)
    ),
  })
  if (app?.slug !== 'shopify' || !installation)
    throw new UnprocessableEntityError('Shopify source installation is unavailable')
  const domain = shopifySourceDomain(credential.metadata)
  const identity = {
    organizationId: input.organizationId,
    providerKey: 'shopify',
    externalAccountId: domain.toLowerCase(),
    environment,
  }
  const [account] = await tx
    .insert(schema.FinancialSourceAccount)
    .values(identity)
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceAccount.organizationId,
        schema.FinancialSourceAccount.providerKey,
        schema.FinancialSourceAccount.externalAccountId,
        schema.FinancialSourceAccount.environment,
      ],
      set: { externalAccountId: identity.externalAccountId },
    })
    .returning()
  return account!
}

async function typedDocument(
  tx: Transaction,
  organizationId: string,
  connectorId: string,
  externalId: string,
  kind: string,
  sourceAccountId?: string
) {
  if (sourceAccountId) {
    const account = await tx.query.FinancialSourceAccount.findFirst({
      where: and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        eq(schema.FinancialSourceAccount.id, sourceAccountId)
      ),
    })
    const connector = await tx.query.DataConnector.findFirst({
      where: and(
        eq(schema.DataConnector.organizationId, organizationId),
        eq(schema.DataConnector.id, connectorId)
      ),
      columns: { credentialId: true },
    })
    const credential = connector?.credentialId
      ? await tx.query.Credential.findFirst({
          where: and(
            eq(schema.Credential.organizationId, organizationId),
            eq(schema.Credential.id, connector.credentialId)
          ),
          columns: { metadata: true },
        })
      : undefined
    if (!account || !credential) return null
    try {
      if (shopifySourceDomain(credential.metadata) !== account.externalAccountId) return null
    } catch {
      return null
    }
  }
  const rows = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.DataConnectorItem)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.organizationId, schema.DataConnectorItem.organizationId),
        eq(schema.EntityInstance.id, schema.DataConnectorItem.entityInstanceId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, organizationId),
        eq(schema.DataConnectorItem.dataConnectorId, connectorId),
        eq(schema.DataConnectorItem.externalId, externalId),
        eq(schema.EntityDefinition.entityType, kind),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(2)
  if (rows.length !== 1) return null
  return rows[0]!.id
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
    ...(observation.reportingInstallationSnapshot as { connectorId?: string }),
    ...(acceptance.unresolvedReferences as { connectorId?: string }),
  }
  const acquiredOrderId =
    acceptance.orderInstanceId ??
    (acquisition.connectorId
      ? await typedDocument(
          tx,
          organizationId,
          acquisition.connectorId,
          acceptance.orderExternalId,
          'order',
          object.sourceAccountId
        )
      : null)
  if (acquiredOrderId && !acceptance.orderInstanceId)
    await updateAcceptance(tx, acceptance.id, { orderInstanceId: acquiredOrderId })
  const source = shopifyMoneyObservationSchema.safeParse(observation.payload)
  if (!source.success) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'rejected',
      reason: 'Invalid transaction identity or money evidence',
    })
    return
  }
  if (source.data.test) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'accepted',
      reason: 'Test-mode observation; no operational money created',
      nextAttemptAt: null,
    })
    return
  }
  if (
    ['AUTHORIZATION', 'VOID'].includes(source.data.kind.toUpperCase()) ||
    ['FAILURE', 'ERROR'].includes(source.data.status.toUpperCase())
  ) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'accepted',
      reason: 'Source observation records no confirmed cash movement',
      nextAttemptAt: null,
    })
    return
  }
  if (source.data.status.toUpperCase() !== 'SUCCESS') {
    await updateAcceptance(tx, acceptance.id, {
      state: 'pending',
      reason: 'Transaction success is not yet confirmed',
    })
    return
  }
  let movement: ReturnType<typeof confirmedShopifyMovement>
  try {
    movement = confirmedShopifyMovement(source.data)
  } catch (error) {
    await updateAcceptance(tx, acceptance.id, {
      state: 'rejected',
      reason: error instanceof Error ? error.message : String(error),
    })
    return
  }
  const snapshot = {
    ...(observation.reportingInstallationSnapshot as { connectorId?: string }),
    ...(acceptance.unresolvedReferences as { connectorId?: string }),
  }
  if (!snapshot.connectorId) throw new Error('Source acquisition context is missing')
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
      snapshot.connectorId,
      acceptance.orderExternalId,
      'order',
      object.sourceAccountId
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
        actorSnapshot: { kind: 'connector', ...snapshot },
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
  const zone = await tx.query.OrganizationSetting.findFirst({
    where: and(
      eq(schema.OrganizationSetting.organizationId, organizationId),
      eq(schema.OrganizationSetting.key, 'accounting.bookTimeZone')
    ),
    columns: { value: true },
  })
  let effectiveDate: string
  try {
    if (typeof zone?.value !== 'string' || !zone.value.trim()) throw new Error('missing timezone')
    effectiveDate = periodKeyForDate(money.occurredAt!, 'day', zone.value)
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
      const creditId = source.data.creditMemoExternalId
        ? await typedDocument(
            tx,
            organizationId,
            snapshot.connectorId,
            source.data.creditMemoExternalId,
            'credit_memo',
            object.sourceAccountId
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
      const creditUsed = settlements
        .filter((row) => row.customerCreditMemoInstanceId === creditId)
        .reduce((sum, row) => sum + row.amountMinor, 0n)
      if (
        !original ||
        original.purpose !== 'customer_receipt' ||
        original.currency !== money.currency ||
        original.partyInstanceId !== partyId ||
        originalUsed + money.amountMinor > original.amountMinor ||
        typeof creditTotal !== 'number' ||
        !Number.isSafeInteger(creditTotal) ||
        creditUsed + money.amountMinor > BigInt(creditTotal) ||
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
    reason: money.paymentRouteId
      ? 'Payment accounting is not enabled yet'
      : 'Payment processor needs to be linked; payment accounting is not enabled yet',
    nextAttemptAt: null,
  })
}

/** Stage the entire fetched source envelope durably before the connector advances its cursor. */
export async function ingestShopifyOrderMoney(
  db: Database,
  input: IngestShopifyOrderMoneyInput
): Promise<void> {
  const envelope = shopifyMoneyEnvelopeSchema.safeParse(input.envelope)
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const raw = envelope.success ? envelope.data.transactions : []
    const environments = new Set<'live' | 'test'>(
      raw.map((item) =>
        !!item && typeof item === 'object' && 'test' in item && item.test === true ? 'test' : 'live'
      )
    )
    if (!environments.size) environments.add('live')
    for (const environment of environments) {
      const account = await sourceAccountInTx(tx, input, environment)
      let fetched = 0
      let accepted = 0
      let rejected = 0
      let pending = 0
      for (const [index, payload] of raw.entries()) {
        const recordEnvironment =
          payload && typeof payload === 'object' && 'test' in payload && payload.test === true
            ? 'test'
            : 'live'
        if (recordEnvironment !== environment) continue
        fetched++
        const parsed = shopifyMoneyObservationSchema.safeParse(payload)
        const externalId = parsed.success
          ? parsed.data.id
          : `invalid:${input.orderExternalId}:${accountingBasisHash(payload)}:${index}`
        const [object] = await tx
          .insert(schema.FinancialSourceObject)
          .values({
            organizationId: input.organizationId,
            sourceAccountId: account.id,
            objectType: 'order_transaction',
            externalId,
            componentKey: '',
          })
          .onConflictDoUpdate({
            target: [
              schema.FinancialSourceObject.organizationId,
              schema.FinancialSourceObject.sourceAccountId,
              schema.FinancialSourceObject.objectType,
              schema.FinancialSourceObject.externalId,
              schema.FinancialSourceObject.componentKey,
            ],
            set: { externalId },
          })
          .returning()
        const contentHash = accountingBasisHash(payload)
        const [observation] = await tx
          .insert(schema.FinancialSourceObservation)
          .values({
            organizationId: input.organizationId,
            sourceObjectId: object!.id,
            contentHash,
            observedAt: new Date(),
            payload,
            reportingInstallationSnapshot: {
              appInstallationId: input.appInstallationId,
              connectorId: input.connectorId,
              runId: input.runId,
              orderExternalId: input.orderExternalId,
            },
          })
          .onConflictDoUpdate({
            target: [
              schema.FinancialSourceObservation.organizationId,
              schema.FinancialSourceObservation.sourceObjectId,
              schema.FinancialSourceObservation.contentHash,
            ],
            set: { contentHash },
          })
          .returning()
        const [acceptance] = await tx
          .insert(schema.FinancialSourceAcceptance)
          .values({
            organizationId: input.organizationId,
            sourceObjectId: object!.id,
            observationId: observation!.id,
            state: 'pending',
            orderExternalId: input.orderExternalId,
            unresolvedReferences: {
              connectorId: input.connectorId,
              parentTransactionId: parsed.success ? parsed.data.parentTransactionId : null,
              gateway: parsed.success ? parsed.data.gateway : null,
            },
          })
          .onConflictDoUpdate({
            target: [
              schema.FinancialSourceAcceptance.organizationId,
              schema.FinancialSourceAcceptance.sourceObjectId,
            ],
            set: {
              observationId: observation!.id,
              unresolvedReferences: {
                connectorId: input.connectorId,
                parentTransactionId: parsed.success ? parsed.data.parentTransactionId : null,
                gateway: parsed.success ? parsed.data.gateway : null,
              },
              updatedAt: new Date(),
            },
          })
          .returning()
        if (acceptance!.orderExternalId !== input.orderExternalId) {
          await updateAcceptance(tx, acceptance!.id, {
            state: 'blocked',
            reason: 'Source transaction moved to another order; review required',
          })
          pending++
          continue
        }
        await materializeImportedMoneyInTx(tx, input.organizationId, acceptance!.id)
        const outcome = await tx.query.FinancialSourceAcceptance.findFirst({
          where: eq(schema.FinancialSourceAcceptance.id, acceptance!.id),
          columns: { state: true },
        })
        if (outcome?.state === 'accepted') accepted++
        else if (outcome?.state === 'rejected') rejected++
        else pending++
      }
      const currentFetched = fetched
      const retained = await tx
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
            eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
            eq(schema.FinancialSourceObject.sourceAccountId, account.id),
            eq(schema.FinancialSourceAcceptance.orderExternalId, input.orderExternalId)
          )
        )
      fetched = retained.length
      accepted = retained.filter((row) => row.state === 'accepted').length
      rejected = retained.filter((row) => row.state === 'rejected').length
      pending = fetched - accepted - rejected
      const complete =
        envelope.success &&
        envelope.data.complete &&
        currentFetched === fetched &&
        pending === 0 &&
        rejected === 0
      await tx
        .insert(schema.FinancialSourceCoverage)
        .values({
          organizationId: input.organizationId,
          sourceAccountId: account.id,
          streamKey: 'shopify_order_transactions',
          windowKey: input.orderExternalId,
          requestedBoundary: { orderExternalId: input.orderExternalId },
          fetchedBoundary: {
            runId: input.runId,
            payloadVersion: envelope.success ? 1 : null,
            sourceComplete:
              envelope.success && envelope.data.complete && currentFetched === fetched,
          },
          fetchedCount: fetched,
          acceptedCount: accepted,
          rejectedCount: rejected,
          pendingCount: pending,
          complete,
        })
        .onConflictDoUpdate({
          target: [
            schema.FinancialSourceCoverage.organizationId,
            schema.FinancialSourceCoverage.sourceAccountId,
            schema.FinancialSourceCoverage.streamKey,
            schema.FinancialSourceCoverage.windowKey,
          ],
          set: {
            fetchedBoundary: {
              runId: input.runId,
              payloadVersion: envelope.success ? 1 : null,
              sourceComplete:
                envelope.success && envelope.data.complete && currentFetched === fetched,
            },
            fetchedCount: fetched,
            acceptedCount: accepted,
            rejectedCount: rejected,
            pendingCount: pending,
            complete,
            updatedAt: new Date(),
          },
        })
    }
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
      eq(schema.FinancialSourceCoverage.streamKey, 'shopify_order_transactions'),
      eq(schema.FinancialSourceCoverage.windowKey, acceptance.orderExternalId)
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
