// packages/lib/src/money/payouts/ingestion-owner.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import type { PayoutSourceCtx } from './source'

/** Refuse a legacy writer only when its gateway, source account, or connection has a new owner. */
export async function assertLegacyPayoutIngestionOwner(
  db: Database | Transaction,
  ctx: Pick<PayoutSourceCtx, 'organizationId'> &
    Partial<Pick<PayoutSourceCtx, 'rail' | 'conflictingRails' | 'ownership' | 'sourceId'>>
): Promise<void> {
  const refuse = () => {
    throw new UnprocessableEntityError(
      'This settlement feed is managed by financial source records. Review its payout evidence; settlement posting is not enabled for this flow.',
      { organizationId: ctx.organizationId }
    )
  }
  const railIds = [
    ...new Set([
      ...(ctx.rail ? [ctx.rail.id] : []),
      ...(ctx.conflictingRails ?? []).map((rail) => rail.id),
    ]),
  ]
  if (railIds.length) {
    const [selected] = await db
      .select({ id: schema.FieldValue.id })
      .from(schema.FieldValue)
      .innerJoin(
        schema.CustomField,
        and(
          eq(schema.CustomField.id, schema.FieldValue.fieldId),
          eq(schema.CustomField.organizationId, ctx.organizationId)
        )
      )
      .where(
        and(
          eq(schema.FieldValue.organizationId, ctx.organizationId),
          inArray(schema.FieldValue.entityId, railIds),
          eq(schema.CustomField.systemAttribute, 'payment_gateway_settlement_account'),
          isNotNull(schema.FieldValue.valueText),
          ne(schema.FieldValue.valueText, '')
        )
      )
      .limit(1)
    if (selected) refuse()
  }
  const identity = ctx.ownership?.sourceAccount
  if (identity) {
    const [observed] = await db
      .select({ id: schema.FinancialSourceAccount.id })
      .from(schema.FinancialSourceAccount)
      .innerJoin(
        schema.FinancialSourceObject,
        and(
          eq(schema.FinancialSourceObject.sourceAccountId, schema.FinancialSourceAccount.id),
          eq(schema.FinancialSourceObject.organizationId, ctx.organizationId)
        )
      )
      .where(
        and(
          eq(schema.FinancialSourceAccount.organizationId, ctx.organizationId),
          eq(schema.FinancialSourceAccount.providerKey, identity.providerKey),
          eq(schema.FinancialSourceAccount.externalAccountId, identity.externalAccountId),
          identity.environment
            ? eq(schema.FinancialSourceAccount.environment, identity.environment)
            : undefined,
          inArray(schema.FinancialSourceObject.objectType, ['payout', 'balance_transaction'])
        )
      )
      .limit(1)
    if (observed) refuse()
  }
  const connection = ctx.ownership
  if (!connection?.appInstallationId || !connection.credentialId) return
  const [mapped] = await db
    .select({ id: schema.DataConnector.id })
    .from(schema.DataConnector)
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.dataConnectorId, schema.DataConnector.id)
    )
    .innerJoin(
      schema.DataConnectorMapping,
      and(
        eq(schema.DataConnectorMapping.dataConnectorStreamId, schema.DataConnectorStream.id),
        eq(schema.DataConnectorMapping.organizationId, ctx.organizationId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.DataConnectorMapping.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, ctx.organizationId)
      )
    )
    .where(
      and(
        eq(schema.DataConnector.organizationId, ctx.organizationId),
        eq(schema.DataConnector.appInstallationId, connection.appInstallationId),
        eq(schema.DataConnector.credentialId, connection.credentialId),
        eq(schema.DataConnectorStream.enabled, true),
        eq(schema.DataConnectorMapping.linkMode, 'upsert'),
        inArray(schema.EntityDefinition.entityType, ['payout', 'processor_balance_entry'])
      )
    )
    .limit(1)
  if (mapped) refuse()
}
