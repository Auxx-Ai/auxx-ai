// packages/lib/src/inventory/builds/auto-build-settings.ts

/**
 * The four `inventory.autoBuild*` org settings, resolved into the shape the
 * trigger reads.
 *
 * plans/products/12-order-triggered-build.md section 5.4.
 *
 * No `db` parameter: every one of these comes out of the `orgSettings` org cache (`getOrganizationSetting` merges the
 * catalog defaults with the persisted rows behind a 100 ms L1 plus one Redis
 * hash GET), so hitting the database here would defeat the invalidation the
 * settings write path already performs.
 */

import { readOrganizationSettings } from '../../settings/read'
import {
  type AutoBuildStatus,
  type AutoBuildStockRule,
  parseAutoBuildEnabledAt,
  resolveAutoBuildStatus,
  resolveAutoBuildStockRule,
} from './auto-build-policy'

/** What the switch is set to right now, for one org. */
export interface AutoBuildSettings {
  /** `inventory.autoBuildFromOrders`. Off by default. */
  enabled: boolean
  /**
   * `inventory.autoBuildEnabledAt` — when the switch was last turned on (AB8).
   *
   * `null` on an org whose row predates the stamp. The trigger treats that as
   * "no order qualifies", never as "every order qualifies".
   */
  enabledAt: Date | null
  /** `inventory.autoBuildStatus`. `planned` (AB5). */
  status: AutoBuildStatus
  /** `inventory.autoBuildStockRule`. `out_of_stock_only` by default (AB4). */
  stockRule: AutoBuildStockRule
}

/** Read the four settings for one org, all four concurrently. */
export async function loadAutoBuildSettings(organizationId: string): Promise<AutoBuildSettings> {
  const settings = await readOrganizationSettings(organizationId, [
    'inventory.autoBuildFromOrders',
    'inventory.autoBuildEnabledAt',
    'inventory.autoBuildStatus',
    'inventory.autoBuildStockRule',
  ] as const)

  return {
    enabled: settings['inventory.autoBuildFromOrders'] === true,
    enabledAt: parseAutoBuildEnabledAt(settings['inventory.autoBuildEnabledAt']),
    status: resolveAutoBuildStatus(settings['inventory.autoBuildStatus']),
    stockRule: resolveAutoBuildStockRule(settings['inventory.autoBuildStockRule']),
  }
}

/** `inventory.backflush` (111 D23). Exclusive with `enabled` above; the settings write keeps it so. */
export interface BackflushSettings {
  enabled: boolean
}

export async function loadBackflushSettings(organizationId: string): Promise<BackflushSettings> {
  const settings = await readOrganizationSettings(organizationId, ['inventory.backflush'] as const)
  return { enabled: settings['inventory.backflush'] === true }
}
