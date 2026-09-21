// packages/lib/src/accounting/money/customer-money/source-observation-adapter.ts
import { schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { readAppCredential } from '../../../connections/credential-reads'
import { getConnector } from '../../../data-connectors/service'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'
import { customerMoneyObservationSchema } from './contracts'
import { readSourceAccount } from './source-reads'

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
  const account = await readSourceAccount(tx, input.organizationId, input.sourceAccountId)
  if (!account) return null
  const connector = await getConnector(tx, input.organizationId, input.connectorId)
  const credentialId = connector.isOk() ? connector.value.credentialId : null
  const credential = credentialId
    ? await readAppCredential(tx, input.organizationId, credentialId)
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
        sql`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'credentialId' = ${credentialId}`,
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
