// packages/lib/src/accounting/ledger/setup/read-export-settings.ts
//
// Server-only half of `export-settings.ts`: the settings read. Kept out of that
// file because `client.ts` re-exports its pure names, and Turbopack follows even
// a dynamic `import()` into the browser bundle.

import type { SettingKey } from '../../../settings/catalog'
import { readOrganizationSettings } from '../../../settings/read'
import {
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  isSummaryGrain,
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
 * per-avenue `autoSend` / `summaryGrain` switches.
 *
 * Off/unset fails closed to the safe value - `autoSend` false (batches hold for
 * release), `summaryGrain` `'day'`. No caller writes one of these keys earlier
 * in the same transaction, so this always takes the cached path (decision 9).
 */
export async function readExportSettings(organizationId: string): Promise<ExportSettings> {
  const settings = await readOrganizationSettings(organizationId, [
    'accounting.exportMode',
    'accounting.exportModeCutover',
    ...EXPORT_AVENUES.map(autoSendSettingKey),
    ...SUMMARY_GRAIN_AVENUES.map(summaryGrainSettingKey),
  ] as const)

  const autoSend = Object.fromEntries(
    EXPORT_AVENUES.map((avenue) => [avenue, settings[autoSendSettingKey(avenue)] === true])
  ) as Record<ExportAvenue, boolean>

  const summaryGrain = Object.fromEntries(
    SUMMARY_GRAIN_AVENUES.map((avenue) => {
      const value = settings[summaryGrainSettingKey(avenue)]
      return [avenue, isSummaryGrain(value) ? value : 'day']
    })
  ) as Record<SummaryGrainAvenue, SummaryGrain>

  const cutover = settings['accounting.exportModeCutover']
  return {
    mode: settings['accounting.exportMode'] === 'summary' ? 'summary' : 'transaction',
    cutover: typeof cutover === 'string' && cutover ? cutover : null,
    autoSend,
    summaryGrain,
  }
}
