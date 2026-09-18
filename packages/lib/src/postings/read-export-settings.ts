// packages/lib/src/postings/read-export-settings.ts
//
// Server-only half of `export-settings.ts`: the settings read. Kept out of that
// file because `client.ts` re-exports its pure names, and Turbopack follows even
// a dynamic `import()` into the browser bundle.

import type { Database, Transaction } from '@auxx/database'
import type { SettingKey } from '../settings/catalog'
import { getOrganizationSetting } from '../settings/settings-service'
import {
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  SUMMARY_GRAIN_AVENUES,
  type SummaryGrain,
  type SummaryGrainAvenue,
} from './export-settings'

function autoSendSettingKey(avenue: ExportAvenue): SettingKey {
  return `accounting.autoSend.${avenue}` as SettingKey
}

function summaryGrainSettingKey(avenue: SummaryGrainAvenue): SettingKey {
  return `accounting.summaryGrain.${avenue}` as SettingKey
}

/**
 * Every export setting for one org, in one call: mode, cutover, and the
 * per-avenue `autoSend` / `summaryGrain` switches beside `autoPost`.
 *
 * Off/unset fails closed to the safe value - `autoSend` false (batches hold for
 * release), `summaryGrain` `'day'`.
 */
export async function readExportSettings(
  db: Database | Transaction,
  organizationId: string
): Promise<ExportSettings> {
  const [mode, cutover] = await Promise.all([
    getOrganizationSetting({ organizationId, key: 'accounting.exportMode', db }),
    getOrganizationSetting({ organizationId, key: 'accounting.exportModeCutover', db }),
  ])

  const autoSendEntries = await Promise.all(
    EXPORT_AVENUES.map(async (avenue) => {
      const value = await getOrganizationSetting({
        organizationId,
        key: autoSendSettingKey(avenue),
        db,
      })
      return [avenue, value === true] as const
    })
  )

  const summaryGrainEntries = await Promise.all(
    SUMMARY_GRAIN_AVENUES.map(async (avenue) => {
      const value = await getOrganizationSetting({
        organizationId,
        key: summaryGrainSettingKey(avenue),
        db,
      })
      return [avenue, value === 'month' ? ('month' as const) : ('day' as const)] as const
    })
  )

  return {
    mode: mode === 'summary' ? 'summary' : 'transaction',
    cutover: typeof cutover === 'string' && cutover ? cutover : null,
    autoSend: Object.fromEntries(autoSendEntries) as Record<ExportAvenue, boolean>,
    summaryGrain: Object.fromEntries(summaryGrainEntries) as Record<
      SummaryGrainAvenue,
      SummaryGrain
    >,
  }
}
