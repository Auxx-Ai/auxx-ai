// packages/lib/src/accounting/ledger/post/auto-post.ts
//
// Gate 1 of TARGET.md §4: per-avenue, off drafts a writer's entry for review,
// on posts it immediately. One settings key per avenue, `accounting.autoPost.<avenue>`.

import type { SettingKey } from '../../../settings/catalog'
import { getOrganizationSetting } from '../../../settings/settings-service'

/** The avenues a writer can be gated on. Mirrors MIGRATION.md step 1b's writer table. */
export const AUTO_POST_AVENUES = [
  'fulfillment',
  'invoice',
  'receipt',
  'refund',
  'creditMemo',
  'expenseBill',
] as const

export type AutoPostAvenue = (typeof AUTO_POST_AVENUES)[number]

/** The settings key an avenue's `autoPost` switch lives under. */
export function autoPostSettingKey(avenue: AutoPostAvenue): SettingKey {
  return `accounting.autoPost.${avenue}` as SettingKey
}

/**
 * `'post'` when the avenue's switch is on, `'draft'` when it is off or unset.
 *
 * Off is the default (fail closed): a writer that reads a mode it cannot
 * resolve must draft, never post unattended. No caller writes
 * `accounting.autoPost.*` earlier in the same transaction, so this always
 * takes the cached path (decision 9).
 */
export async function readAutoPostMode(
  organizationId: string,
  avenue: AutoPostAvenue
): Promise<'draft' | 'post'> {
  const value = await getOrganizationSetting({
    organizationId,
    key: autoPostSettingKey(avenue),
  })
  return value === true ? 'post' : 'draft'
}
