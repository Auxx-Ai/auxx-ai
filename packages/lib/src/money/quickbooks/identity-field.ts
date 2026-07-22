// packages/lib/src/money/quickbooks/identity-field.ts
//
// Read/write the QuickBooks id-map fields (`qboCustomerId` / `qboItemId` / `qboInvoiceId`,
// declared by the app as hidden, connection-scoped `identity: true` fields — see
// auxxai-apps/apps/quickbooks/src/fields.ts). Mirrors the exact write-through
// `writeShopifyCustomerIdField` established (`packages/lib/src/chat/shopify-identity-field.ts`):
// `FieldValueService.setValue` writes the cell, `upsertRecordIdentity` mirrors it into
// `RecordIdentity` so the reverse lookup (`findByIntegrationId`) and future reverse-sync
// converge on the same cell. Shared across upsert-customer/upsert-item/sync-invoice so the
// (appInstallationId, connectionId, appFieldKey) → CustomField resolution isn't repeated
// three times.

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { extractValue } from '@auxx/types'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { upsertRecordIdentity } from '../../identity'
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
 * has never been written — both are "no stored id, fall through to find-or-create".
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
  if (!field) return undefined

  const values = await params.handler.getFieldValues(params.recordId, [field.id])
  const entry = values.get(field.id)
  const typed = Array.isArray(entry) ? entry[0] : entry
  if (!typed) return undefined

  const value = extractValue(typed)
  return typeof value === 'string' && value ? value : undefined
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
