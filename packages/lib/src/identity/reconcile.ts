// packages/lib/src/identity/reconcile.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { upsertRecordIdentity } from './upsert'

type DbHandle = Database | Transaction

export interface ReconcileRecordIdentitiesResult {
  /** Identity cells whose mirror was created or corrected. */
  upserted: number
  /** Identity cells that couldn't be mirrored (missing `appSlug`, or a
   *  unique-key conflict with a different record). */
  skipped: number
  /** Mirror rows deleted because their backing `FieldValue` cell is gone
   *  (cleared or deleted). Never touches app-less rows (chat). */
  orphanedDeleted: number
}

/**
 * Drift backstop for the explicit-writer mirror. Any writer outside the
 * closed set (connector sink, chat passport, chat JWT resolver) — AI
 * autofill, a workflow field-set action, a future path — updates the
 * `FieldValue` but not the `RecordIdentity` mirror, silently. This rebuilds
 * the index from `FieldValue ⋈ CustomField(isIdentity)` and removes mirror
 * rows whose backing cell is gone. Idempotent; safe to run repeatedly on a
 * schedule. Never touches app-less rows (`fieldId IS NULL`, e.g. chat
 * `visitorId`) — those have no backing `FieldValue` by design.
 */
export async function reconcileRecordIdentities(
  organizationId: string,
  db: DbHandle = database
): Promise<ReconcileRecordIdentitiesResult> {
  const identityCells = await db
    .select({
      entityId: schema.FieldValue.entityId,
      entityDefinitionId: schema.FieldValue.entityDefinitionId,
      valueText: schema.FieldValue.valueText,
      fieldId: schema.CustomField.id,
      appSlug: schema.CustomField.appSlug,
      appInstallationId: schema.CustomField.appInstallationId,
      connectionId: schema.CustomField.connectionId,
      appFieldKey: schema.CustomField.appFieldKey,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.CustomField.isIdentity, true),
        isNotNull(schema.FieldValue.valueText)
      )
    )

  let upserted = 0
  let skipped = 0
  for (const cell of identityCells) {
    if (!cell.valueText || !cell.appSlug) {
      skipped++
      continue
    }
    const result = await upsertRecordIdentity(
      {
        organizationId,
        entityInstanceId: cell.entityId,
        entityDefinitionId: cell.entityDefinitionId,
        source: cell.appSlug,
        appInstallationId: cell.appInstallationId,
        connectionId: cell.connectionId,
        appFieldKey: cell.appFieldKey,
        fieldId: cell.fieldId,
        externalId: cell.valueText,
      },
      db
    )
    if (result.ok) {
      upserted++
    } else {
      skipped++
    }
  }

  // Mirror rows whose backing cell is gone (cleared or deleted). App-less
  // rows (fieldId IS NULL) have no cell to check against — excluded.
  const orphaned = await db
    .select({ id: schema.RecordIdentity.id })
    .from(schema.RecordIdentity)
    .leftJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.RecordIdentity.entityInstanceId),
        eq(schema.FieldValue.fieldId, schema.RecordIdentity.fieldId),
        isNotNull(schema.FieldValue.valueText)
      )
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        isNotNull(schema.RecordIdentity.fieldId),
        isNull(schema.FieldValue.id)
      )
    )

  if (orphaned.length > 0) {
    await db.delete(schema.RecordIdentity).where(
      inArray(
        schema.RecordIdentity.id,
        orphaned.map((row) => row.id)
      )
    )
  }

  return { upserted, skipped, orphanedDeleted: orphaned.length }
}
