// apps/web/src/components/accounting/ui/settings/provider-sync-section.tsx

'use client'

// Accounting > Settings > Connected system, under the balance comparison: the
// one door onto the INBOUND half of the seam
// (plans/accounting/tasks/20-two-authors-one-ledger.md §7.4).
//
// The pair is deliberate and they read in this order: the comparison asks
// "do our books and theirs agree", and this is what makes them agree. §8.5
// makes that the acceptance test - after a sync of a period, the difference for
// that period should be zero.
//
// 🛑 The behaviour is not built here. This file is a heading, the two settings
// the panel needs, and a place to put it; `ProviderSyncPanel` is the whole of
// it, exactly the way `provider-agreement-section.tsx` defers to its panel.
//
// 🛑 NO VENDOR NAME IN THE COPY (brief 27 §3). The heading says what the button
// does; the description interpolates whatever is connected.

import { CloudDownload } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import { useSettings } from '~/hooks/use-settings'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { today } from '../journal/period-helpers'
import { ProviderSyncPanel } from '../provider-sync/provider-sync-panel'

/** Same fallback `useLedgerPeriod` uses when the book timezone is unset. */
const FALLBACK_BOOK_TIME_ZONE = 'UTC'

/**
 * "Bring in what your accountant authored", for a range somebody picks.
 *
 * `to` defaults to today in the BOOK timezone rather than the browser's, for
 * the comparison section's reason: an accounting date is a calendar day in the
 * books' own zone, and defaulting to the viewer's would put a bookkeeper in
 * Auckland a day ahead of their own ledger.
 */
export function ProviderSyncSettingsSection() {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const provider = useAccountingProviderStatus()
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE
  const cutoffPeriod = (getSetting('accounting.cutoffPeriod') as string) || ''
  const orgCurrency = (getSetting('organization.currency') as string) || 'USD'

  return (
    <SettingsSection
      icon={CloudDownload}
      title='Bring in entries'
      description={`Read ${providerLabel}'s general ledger and write everything your accountant authored there into these books. Depreciation, accruals, reclasses and payroll - the entries that are never authored here.`}>
      <ProviderSyncPanel
        cutoffPeriod={cutoffPeriod}
        orgCurrency={orgCurrency}
        todayInBooks={today(bookTimeZone)}
        className='mt-1'
      />
    </SettingsSection>
  )
}
