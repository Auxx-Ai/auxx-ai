// packages/lib/src/postings/export-settings.ts
//
// TARGET §3: which grain postings leave in, and whether a person releases them.
// `EXPORT_AVENUES`, `SUMMARY_GRAIN_AVENUES` and `avenueOfPostingType` are PURE -
// only `../types` - so `readExportSettings` reaches the settings service through
// a dynamic import rather than a static one, keeping this file's own import
// graph client-safe and letting `client.ts` re-export the pure names unchanged.

import type { Database, Transaction } from '@auxx/database'
import type { SettingKey } from '../settings/catalog'
import type { PostingType } from './types'

/** Every avenue the export batch groups postings by. Mirrors TARGET §3's provider-object table. */
export const EXPORT_AVENUES = [
  'fulfillment',
  'receipt',
  'refund',
  'creditMemo',
  'invoice',
  'expenseBill',
  'payout',
  'bankDeposit',
  'journal',
] as const

export type ExportAvenue = (typeof EXPORT_AVENUES)[number]

/** The avenues `accounting.summaryGrain.*` governs. Payouts, bank deposits and journals have no grain - one object each. */
export const SUMMARY_GRAIN_AVENUES = [
  'fulfillment',
  'receipt',
  'refund',
  'creditMemo',
  'invoice',
  'expenseBill',
] as const

export type SummaryGrainAvenue = (typeof SUMMARY_GRAIN_AVENUES)[number]

export type SummaryGrain = 'day' | 'month'

/**
 * Which export avenue a posting type rolls up under, or `null` when it is never
 * exported. The inverse of the writers MIGRATION.md step 1b's table names.
 *
 * No `default` case: the switch must stay exhaustive over `PostingType` so a
 * posting type added later fails to compile here rather than silently landing
 * in no avenue at all - `export-settings.test.ts` also checks it is total over
 * `POSTING_TYPES` at runtime.
 */
export function avenueOfPostingType(postingType: PostingType): ExportAvenue | null {
  switch (postingType) {
    case 'fulfillment':
      return 'fulfillment'
    case 'payment':
      return 'receipt'
    case 'refund':
      return 'refund'
    case 'credit_memo':
      return 'creditMemo'
    case 'invoice_issued':
    case 'write_off':
      return 'invoice'
    case 'expense_bill':
    case 'vendor_bill':
      return 'expenseBill'
    case 'payout':
      return 'payout'
    case 'bank_deposit':
      return 'bankDeposit'
    // No native object (TARGET §3's table): a journal entry.
    case 'manual_journal':
    case 'recurring_journal':
    case 'month_end_inventory':
    case 'month_end_deferral':
    case 'month_end_reversal':
    case 'build':
    case 'receipt':
      return 'journal'
    // Rides along with the payment it applies against - TARGET §5: "part of the Payment".
    case 'deposit_application':
      return 'receipt'
    // Never exported: an opening entry has no provider counterpart, a
    // provider-authored entry must never be pushed back at the provider, and a
    // coded bank line is already on the provider's own bank feed.
    case 'opening_balance':
    case 'provider_sync':
    case 'bank_transaction':
      return null
  }
}

function autoSendSettingKey(avenue: ExportAvenue): SettingKey {
  return `accounting.autoSend.${avenue}` as SettingKey
}

function summaryGrainSettingKey(avenue: SummaryGrainAvenue): SettingKey {
  return `accounting.summaryGrain.${avenue}` as SettingKey
}

export interface ExportSettings {
  mode: 'transaction' | 'summary'
  /** `YYYY-MM-DD`, or `null` when unset - nothing dated before it is ever batched. */
  cutover: string | null
  autoSend: Record<ExportAvenue, boolean>
  summaryGrain: Record<SummaryGrainAvenue, SummaryGrain>
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
  const { getOrganizationSetting } = await import('../settings/settings-service')

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
