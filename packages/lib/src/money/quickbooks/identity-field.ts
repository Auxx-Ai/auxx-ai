// packages/lib/src/money/quickbooks/identity-field.ts
//
// Read/write the QuickBooks id-map fields (`qboCustomerId` / `qboItemId` / `qboInvoiceId`,
// declared by the app as hidden, connection-scoped `identity: true` fields — see
// auxxai-apps/apps/quickbooks/src/fields.ts). Mirrors the exact write-through
// `writeShopifyCustomerIdField` established (`packages/lib/src/chat/shopify-identity-field.ts`):
// `FieldValueService.setValue` writes the cell, `upsertRecordIdentity` mirrors it into
// `RecordIdentity` so the reverse lookup (`findByIntegrationId`) and future reverse-sync
// converge on the same cell. Shared by `upsert-customer.ts` and the accounting provider's
// counterparty resolution so the (appInstallationId, connectionId, appFieldKey) to
// CustomField resolution is written once. The invoice mirror that also used it
// (`sync-invoice.ts`, `upsert-item.ts`) was retired on 2026-09-10 (brief 14).

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { extractValue } from '@auxx/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { getRecordIdentitiesForRecords, upsertRecordIdentity } from '../../identity'
import type { UnifiedCrudHandler } from '../../resources/crud'

const logger = createScopedLogger('quickbooks-identity-field')

/** `RecordIdentity.source` for every id-map field this module reads/writes. */
export const QUICKBOOKS_SOURCE = 'quickbooks'

/** Resolve the connection-scoped `CustomField` the QuickBooks app provisioned for one identity key. */
async function findAppField(params: {
  organizationId: string
  installationId: string
  connectionId: string
  appFieldKey: string
}): Promise<{ id: string } | undefined> {
  return database.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, params.organizationId),
      eq(schema.CustomField.appInstallationId, params.installationId),
      eq(schema.CustomField.connectionId, params.connectionId),
      eq(schema.CustomField.appFieldKey, params.appFieldKey)
    ),
    columns: { id: true },
  })
}

/**
 * Read a QuickBooks id-map field's current value off a record (e.g. does this contact
 * already have a `qboCustomerId`?). Returns `undefined` when the field isn't provisioned or
 * has never been written - both are "no stored id, fall through to find-or-create".
 *
 * ## Two places the answer can live, and why the second one matters
 *
 * The cell is authoritative. The `RecordIdentity` mirror is the fallback, and it
 * exists for exactly one state: **the record has been deleted**
 * (plans/accounting/tasks/23 section 4.1).
 *
 * `deleteEntityInstance` calls `sweepEntityFieldValues`, which deletes
 * `FieldValue` rows. It does NOT touch `RecordIdentity` - verified 2026-09-11,
 * and the mirror is keyed on `entityInstanceId` rather than joined to a live
 * instance, so it survives. That asymmetry is what makes this fallback work.
 *
 * 🛑 Without it, a posting line whose counterparty was later deleted becomes
 * permanently unexportable. The line's `counterpartyId` is FROZEN (brief 13
 * section 1.1 - a retry exports under the attribution the ledger asserted, not
 * the current record), so it still names the gone contact, but the cell is gone
 * and there is no name or email left to search or create with. Reading the
 * mirror lets that entry still export under the customer it was posted for,
 * which is what "frozen attribution" was supposed to mean in the first place.
 *
 * The mirror is a record that a correspondence HAPPENED. Deleting our copy of
 * one side does not make it un-happen.
 *
 * ⚠️ Costs nothing on the normal path: the fallback query only runs when the
 * cell is absent, which for a live record it never is.
 */
export async function readQuickbooksIdField(params: {
  organizationId: string
  installationId: string
  connectionId: string
  appFieldKey: string
  recordId: RecordId
  handler: UnifiedCrudHandler
}): Promise<string | undefined> {
  const field = await findAppField(params)

  if (field) {
    const values = await params.handler.getFieldValues(params.recordId, [field.id])
    const entry = values.get(field.id)
    const typed = Array.isArray(entry) ? entry[0] : entry
    if (typed) {
      const value = extractValue(typed)
      if (typeof value === 'string' && value) return value
    }
  }

  return readIdentityMirror(params)
}

/**
 * The `RecordIdentity` row for one record and one id kind, or undefined.
 *
 * Reads through the identity module's own batch primitive rather than querying
 * `RecordIdentity` here: that table has two unique indexes with COALESCE'd
 * expressions and a module that owns the reading of it, and a second hand-rolled
 * query against it is how the two come to disagree.
 */
async function readIdentityMirror(params: {
  organizationId: string
  connectionId: string
  appFieldKey: string
  recordId: RecordId
}): Promise<string | undefined> {
  const { organizationId, connectionId, appFieldKey, recordId } = params

  const byRecord = await getRecordIdentitiesForRecords(organizationId, [recordId])
  const rows = byRecord.get(recordId) ?? []

  const match = rows.find(
    (row) =>
      row.source === QUICKBOOKS_SOURCE &&
      row.connectionId === connectionId &&
      row.appFieldKey === appFieldKey
  )
  if (!match?.externalId) return undefined

  logger.debug('Resolved a QuickBooks id from the RecordIdentity mirror, not the cell', {
    organizationId,
    entityInstanceId: parseRecordId(recordId).entityInstanceId,
    appFieldKey,
  })
  return match.externalId
}

/**
 * Write a QuickBooks external id back onto a record's id-map field, then mirror it into
 * `RecordIdentity`. Best-effort on the mirror step only — a missed `RecordIdentity` write is
 * logged and swallowed (the reconciler is the backstop); the `FieldValueService.setValue` call
 * itself is allowed to throw, since a failed cell write means the sync genuinely didn't
 * complete and the caller's try/catch should surface `status: 'error'`.
 */
export async function writeQuickbooksIdField(params: {
  organizationId: string
  installationId: string
  connectionId: string
  appFieldKey: string
  /** System entity type slug ('contact' | 'catalog_item' | 'invoice') — not the UUID def id. */
  entityType: string
  entityInstanceId: string
  externalId: string
  userId?: string
}): Promise<void> {
  const {
    organizationId,
    installationId,
    connectionId,
    appFieldKey,
    entityType,
    entityInstanceId,
    externalId,
    userId,
  } = params

  const field = await findAppField({ organizationId, installationId, connectionId, appFieldKey })
  if (!field) {
    logger.warn('QuickBooks id-map field not provisioned — skipping write', {
      organizationId,
      appFieldKey,
    })
    return
  }

  const service = new FieldValueService(organizationId, userId)
  await service.setValue({
    recordId: toRecordId(entityType, entityInstanceId),
    fieldId: field.id,
    value: externalId,
  })

  const entityDefId = await getCachedEntityDefId(organizationId, entityType)
  if (!entityDefId) {
    logger.warn('No entity definition found — skipping RecordIdentity mirror', {
      organizationId,
      entityType,
    })
    return
  }

  const mirrored = await upsertRecordIdentity({
    organizationId,
    entityInstanceId,
    entityDefinitionId: entityDefId,
    source: QUICKBOOKS_SOURCE,
    appInstallationId: installationId,
    connectionId,
    appFieldKey,
    fieldId: field.id,
    externalId,
  })
  if (!mirrored.ok) {
    logger.warn('Failed to mirror QuickBooks id into RecordIdentity', {
      organizationId,
      entityType,
      entityInstanceId,
      appFieldKey,
      error: mirrored.error.message,
    })
  }
}
