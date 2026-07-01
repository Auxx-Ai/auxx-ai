// packages/lib/src/data-connectors/inventory-bridge-config.ts
// The INVENTORY_BRIDGE org setting: which entity defs/fields are inventory sources for
// the v9 inventory→part watermark pass. One OrganizationSetting row per org (key
// `inventory.bridge`, scope INVENTORY_BRIDGE) holding a list of source entries. Written by
// connector provisioning (B1) + the link picker; read by the pass and the picker (it's how
// the picker knows which defs count as inventory sources). Mirrors the getting-started
// scope-keyed row pattern (migration 0242).
// See plans/data-connectors/v9/shopify-inventory-part-bridge-plan.md (locked #6).

import type { Database } from '@auxx/database'
import { getOrgCache, onCacheEvent } from '../cache'
import { SettingsService } from '../settings'

/** The setting key that holds the inventory-bridge source list. */
export const INVENTORY_BRIDGE_SETTING_KEY = 'inventory.bridge'

/**
 * One inventory source the bridge understands. `sourceDefId` is the synced record's entity
 * def (e.g. shopify_variants); `quantityFieldId` is the field the pass compares to the
 * watermark; `relationshipFieldId` is the edge on the source record pointing at the `part`.
 */
export interface InventoryBridgeConfigEntry {
  /** The connector that syncs this source — stamped onto watermark rows the picker creates. */
  dataConnectorId: string
  sourceDefId: string
  quantityFieldId: string
  relationshipFieldId: string
}

/** Read the config via the org-settings cache (hot read path — pass + picker). */
export async function readInventoryBridgeConfig(
  organizationId: string
): Promise<InventoryBridgeConfigEntry[]> {
  const settings = await getOrgCache().get(organizationId, 'orgSettings')
  const value = settings[INVENTORY_BRIDGE_SETTING_KEY]
  return Array.isArray(value) ? (value as InventoryBridgeConfigEntry[]) : []
}

/** Read the config directly (write path — avoids a stale-cache read-modify-write). */
async function readConfigDirect(
  service: SettingsService,
  organizationId: string
): Promise<InventoryBridgeConfigEntry[]> {
  const value = await service.getOrganizationSetting({
    organizationId,
    key: INVENTORY_BRIDGE_SETTING_KEY,
  })
  return Array.isArray(value) ? (value as InventoryBridgeConfigEntry[]) : []
}

async function writeConfig(
  service: SettingsService,
  organizationId: string,
  entries: InventoryBridgeConfigEntry[]
): Promise<void> {
  await service.updateOrganizationSetting({
    organizationId,
    key: INVENTORY_BRIDGE_SETTING_KEY,
    value: entries,
    allowUserOverride: false,
  })
  await onCacheEvent('org.settings.changed', { orgId: organizationId })
}

/**
 * Idempotently add/update a source entry keyed by `sourceDefId` (one entry per source
 * def). Re-provisioning overwrites the entry's field ids in place.
 */
export async function upsertInventoryBridgeConfigEntry(
  db: Database,
  organizationId: string,
  entry: InventoryBridgeConfigEntry
): Promise<void> {
  const service = new SettingsService(db)
  const entries = await readConfigDirect(service, organizationId)
  const next = entries.filter((e) => e.sourceDefId !== entry.sourceDefId)
  next.push(entry)
  await writeConfig(service, organizationId, next)
}

/**
 * Remove every source entry whose `sourceDefId` is in the given set (connector deletion).
 * No-op when nothing matches.
 */
export async function removeInventoryBridgeConfigEntries(
  db: Database,
  organizationId: string,
  sourceDefIds: string[]
): Promise<void> {
  if (sourceDefIds.length === 0) return
  const service = new SettingsService(db)
  const entries = await readConfigDirect(service, organizationId)
  const drop = new Set(sourceDefIds)
  const next = entries.filter((e) => !drop.has(e.sourceDefId))
  if (next.length === entries.length) return
  await writeConfig(service, organizationId, next)
}
