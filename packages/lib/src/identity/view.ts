// packages/lib/src/identity/view.ts

import type { RecordIdentityEntity } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { getCachedCustomFields, getCachedInstalledApps } from '../cache'
import { getRecordIdentitiesForRecords } from './batch'

/** `RecordIdentity.source` used for the app-less chat-visitor link. */
const CHAT_SOURCE = 'chat'

/**
 * A display-ready external-identity link for the record detail's "External
 * identities" card. Decorated from org cache only (installed apps + custom
 * fields) — no extra DB round-trip on top of the batch identity load.
 */
export interface RecordIdentityView {
  id: string
  /** Universal namespace — `'shopify'`, `'chat'`, `'hubspot'`. */
  source: string
  /** Installed-app title (`'Shopify'`), a friendly label for `chat`, else null. */
  appName: string | null
  /** Installed-app avatar/icon url, when the source is an app. */
  appIconKey: string | null
  /** Which store/connection this identity belongs to (null for app-less links). */
  connectionId: string | null
  /** Human label for the connection — not available from org cache in v1. */
  connectionLabel: string | null
  /** The id kind, e.g. `customerId` (null for bare-source links like chat). */
  appFieldKey: string | null
  /** The backing `CustomField` name, e.g. `'Shopify customer ID'`. */
  fieldLabel: string | null
  /** The external value — numeric Shopify id, chat visitor id, … */
  externalId: string
  updatedAt: string
}

/**
 * Decorate raw `RecordIdentity` rows into display-ready views using org cache
 * only (installed apps for app name/icon, custom fields for the field label).
 * Sorted by source then external id for a stable card order.
 */
export async function decorateRecordIdentities(
  organizationId: string,
  rows: RecordIdentityEntity[]
): Promise<RecordIdentityView[]> {
  if (rows.length === 0) return []

  const installedApps = await getCachedInstalledApps(organizationId)
  const appByInstallation = new Map(installedApps.map((a) => [a.installationId, a.app]))

  // Field labels: load the custom-field set for each distinct entity def once.
  const defIds = [...new Set(rows.map((r) => r.entityDefinitionId))]
  const fieldNameById = new Map<string, string>()
  await Promise.all(
    defIds.map(async (defId) => {
      const fields = await getCachedCustomFields(organizationId, defId)
      for (const f of fields) fieldNameById.set(f.id, f.name)
    })
  )

  return rows
    .map((row) => {
      const app = row.appInstallationId ? appByInstallation.get(row.appInstallationId) : undefined
      return {
        id: row.id,
        source: row.source,
        appName: app?.title ?? (row.source === CHAT_SOURCE ? 'Chat' : null),
        appIconKey: app?.avatarUrl ?? null,
        connectionId: row.connectionId,
        connectionLabel: null,
        appFieldKey: row.appFieldKey,
        fieldLabel: row.fieldId ? (fieldNameById.get(row.fieldId) ?? null) : null,
        externalId: row.externalId,
        updatedAt: row.updatedAt.toISOString(),
      }
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.externalId.localeCompare(b.externalId))
}

/**
 * Batch-load + decorate the external identities for a single record — the
 * "External identities" card's data source. One index query + org-cache
 * decoration, no N+1.
 */
export async function getRecordIdentityViews(
  organizationId: string,
  recordId: RecordId
): Promise<RecordIdentityView[]> {
  const grouped = await getRecordIdentitiesForRecords(organizationId, [recordId])
  const rows = grouped.get(recordId) ?? []
  return decorateRecordIdentities(organizationId, rows)
}
