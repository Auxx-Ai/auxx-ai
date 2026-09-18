// packages/lib/src/money/customer-money/source-observation-adapter.ts
import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { accountingBasisHash } from '../../accounting/ledger/builders/basis-hash'
import { customerMoneyObservationSchema } from './contracts'

/** Stored observations contain shared financial facts; provider translation happens in the source app. */
export function readStoredCustomerMoneyObservation(payload: unknown) {
  return customerMoneyObservationSchema.safeParse(payload)
}

/** Resolve connector-owned documents only when a saved observation verifies the same source and connection. */
export async function resolveSourceDocumentFromConnector(
  tx: Transaction,
  input: {
    organizationId: string
    connectorId?: string
    sourceAccountId?: string
    externalId: string
    kind: string
  }
) {
  if (!input.connectorId || !input.sourceAccountId) return null
  const account = await tx.query.FinancialSourceAccount.findFirst({
    where: and(
      eq(schema.FinancialSourceAccount.organizationId, input.organizationId),
      eq(schema.FinancialSourceAccount.id, input.sourceAccountId)
    ),
  })
  if (!account) return null
  const connector = await tx.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.organizationId, input.organizationId),
      eq(schema.DataConnector.id, input.connectorId)
    ),
    columns: { credentialId: true },
  })
  const credential = connector?.credentialId
    ? await tx.query.Credential.findFirst({
        where: and(
          eq(schema.Credential.organizationId, input.organizationId),
          eq(schema.Credential.id, connector.credentialId)
        ),
        columns: { metadata: true },
      })
    : null
  if (!credential) return null
  const observations = await tx
    .select({ id: schema.FinancialSourceObservation.id })
    .from(schema.FinancialSourceObservation)
    .innerJoin(
      schema.FinancialSourceObject,
      and(
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceObservation.sourceObjectId),
        eq(schema.FinancialSourceObject.organizationId, input.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
        eq(schema.FinancialSourceObject.sourceAccountId, account.id),
        sql`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'connectorId' = ${input.connectorId}`,
        sql`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'credentialId' = ${connector?.credentialId}`,
        sql`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'credentialMetadataHash' = ${accountingBasisHash(credential.metadata)}`
      )
    )
    .limit(1)
  if (!observations.length) return null
  const rows = await tx
    .select({ id: schema.EntityInstance.id })
    .from(schema.DataConnectorItem)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.DataConnectorItem.entityInstanceId),
        eq(schema.EntityInstance.organizationId, schema.DataConnectorItem.organizationId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.DataConnectorItem.organizationId, input.organizationId),
        eq(schema.DataConnectorItem.dataConnectorId, input.connectorId),
        eq(schema.DataConnectorItem.externalId, input.externalId),
        eq(schema.EntityDefinition.entityType, input.kind),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(2)
  return rows.length === 1 ? rows[0]!.id : null
}
