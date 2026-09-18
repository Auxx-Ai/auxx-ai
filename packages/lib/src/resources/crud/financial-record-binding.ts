// packages/lib/src/resources/crud/financial-record-binding.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq, or, sql } from 'drizzle-orm'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import type { FinancialRecordType } from '../../money/customer-money/record-contracts'
import type { FinancialWriteProvenance } from '../../money/customer-money/record-storage'
import { accountingBasisHash } from '../../postings/basis-hash'
import type { MutationContext } from './unified-handler-mutations'

/** Financial resources use the normal record identity with typed storage for source facts. */
export function financialRecordType(value: string | null | undefined): FinancialRecordType | null {
  return value === 'payout' || value === 'processor_balance_entry' ? value : null
}

/** Entity kinds whose archive/delete path must preserve accepted accounting history. */
export function hasAccountingHistory(value: string | null | undefined): boolean {
  return (
    financialRecordType(value) !== null ||
    value === 'credit_memo' ||
    value === 'credit_memo_line' ||
    value === 'credit_memo_application'
  )
}
/** Resolve verified reporting connection data from the platform write session. */
export async function resolveFinancialWriteProvenance(
  ctx: Pick<MutationContext, 'db' | 'organizationId' | 'session'>
): Promise<FinancialWriteProvenance> {
  const origin = ctx.session.origin
  if (origin.kind !== 'sync') return { source: origin.kind }
  if (origin.source !== 'connector') return { source: origin.source, ref: origin.ref }
  const run = await ctx.db.query.DataConnectorRun.findFirst({
    where: and(
      eq(schema.DataConnectorRun.organizationId, ctx.organizationId),
      eq(schema.DataConnectorRun.id, origin.ref)
    ),
  })
  const connector = run
    ? await ctx.db.query.DataConnector.findFirst({
        where: and(
          eq(schema.DataConnector.organizationId, ctx.organizationId),
          eq(schema.DataConnector.id, run.dataConnectorId)
        ),
      })
    : undefined
  if (!connector) throw new UnprocessableEntityError('Financial source connector run was not found')
  if (!connector.credentialId)
    return { source: 'connector', ref: origin.ref, connectorId: connector.id }
  const credential = await ctx.db.query.Credential.findFirst({
    where: and(
      eq(schema.Credential.organizationId, ctx.organizationId),
      eq(schema.Credential.id, connector.credentialId)
    ),
  })
  if (!credential || credential.appInstallationId !== connector.appInstallationId)
    throw new UnprocessableEntityError(
      'Financial source credential does not match its installation'
    )
  return {
    source: 'connector',
    ref: origin.ref,
    connectorId: connector.id,
    credentialId: credential.id,
    appInstallationId: connector.appInstallationId ?? undefined,
    credentialMetadataHash: accountingBasisHash(credential.metadata),
  }
}

/** Prevent generic deletion or archival from hiding durable financial history. */
export async function assertFinancialRecordCanDelete(
  db: Database | Transaction,
  organizationId: string,
  recordId: string
): Promise<void> {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(
    recordId as Parameters<typeof parseRecordId>[0]
  )
  // Record IDs may use either the definition ID or the resource slug.
  const definition = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.organizationId, organizationId),
      or(
        eq(schema.EntityDefinition.id, entityDefinitionId),
        eq(schema.EntityDefinition.entityType, entityDefinitionId)
      )
    ),
    columns: { entityType: true },
  })
  // The slug IS the entity type, so a RecordId in that form still classifies even
  // if no def row resolves — a missing def must not read as "not financial".
  const entityType = definition?.entityType ?? entityDefinitionId
  const type = financialRecordType(entityType)
  if (!type) return
  const rows = await db
    .select({ id: schema.FinancialSourceObservation.id })
    .from(schema.FinancialSourceObservation)
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, organizationId),
        sql`${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'recordId' = ${entityInstanceId}`
      )
    )
    .limit(1)
  if (rows.length)
    throw new ConflictError(
      'Financial history cannot be archived or deleted; record a correction instead'
    )
}
