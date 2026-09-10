// apps/web/src/components/accounting/ui/settings/provider-agreement-section.tsx

'use client'

// Accounting > Settings > General, under the QuickBooks section: the second
// door onto the agreement view (plans/accounting/tasks/20-two-authors-one-
// ledger.md §8.3), for a date somebody picks rather than the period a close
// console happens to be showing.
//
// 🛑 The TABLE is not built here. This file is a heading, a default date and a
// place to put them; `ProviderAgreementPanel` is the whole of the behaviour and
// the close console renders the same one. Two copies of a reconciliation table
// is two answers to one question.

import { ArrowLeftRight } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useSettings } from '~/hooks/use-settings'
import { today } from '../journal/period-helpers'
import { ProviderAgreementPanel } from '../provider-agreement/provider-agreement-panel'

/** Same fallback `useLedgerPeriod` uses when the book timezone is unset. */
const FALLBACK_BOOK_TIME_ZONE = 'UTC'

/**
 * "Does QuickBooks agree?", for an arbitrary date.
 *
 * Defaults to today in the BOOK timezone, not the browser's: an accounting date
 * is a calendar day in the books' own zone, and defaulting to the viewer's would
 * put a bookkeeper in Auckland a day ahead of their own ledger.
 */
export function ProviderAgreementSettingsSection() {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE
  const [asOf, setAsOf] = useState(() => today(bookTimeZone))

  return (
    <SettingsSection
      icon={ArrowLeftRight}
      title='Does QuickBooks agree?'
      description='Compare every account balance here against the connected system, as of any date. A read only - nothing posts, and no statement reads the answer.'>
      <ProviderAgreementPanel asOf={asOf} onAsOfChange={setAsOf} className='mt-1' />
    </SettingsSection>
  )
}
