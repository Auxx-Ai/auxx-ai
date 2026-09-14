// apps/web/src/components/accounting/ui/settings/provider-agreement-section.tsx

'use client'

// Accounting > Settings > Connected system, under the provider section: the
// second door onto the agreement view (plans/accounting/tasks/20-two-authors-
// one-ledger.md §8.3), for a date somebody picks rather than the period a close
// console happens to be showing.
//
// 🛑 The TABLE is not built here. This file is a heading, a default date and a
// place to put them; `ProviderAgreementPanel` is the whole of the behaviour and
// the close console renders the same one. Two copies of a reconciliation table
// is two answers to one question.
//
// 🛑 NO VENDOR NAME IN THE COPY. The heading names the artifact and the
// description interpolates whatever is connected - which is
// `UNKNOWN_PROVIDER_LABEL` when nothing is (brief 27 §3). The close console's
// door keeps the question form ("Does X agree?") because a specific period is
// on screen there and the question is being asked because a month is closing;
// here the date is arbitrary, and §8 of that brief is why the two differ.

import { ArrowLeftRight } from 'lucide-react'
import { useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useSettings } from '~/hooks/use-settings'
import { today } from '../journal/period-helpers'
import {
  ProviderAgreementAction,
  ProviderAgreementPanel,
  useProviderAgreement,
} from '../provider-agreement/provider-agreement-panel'

/** Same fallback `useLedgerPeriod` uses when the book timezone is unset. */
const FALLBACK_BOOK_TIME_ZONE = 'UTC'

/**
 * The balance comparison, for an arbitrary date.
 *
 * Defaults to today in the BOOK timezone, not the browser's: an accounting date
 * is a calendar day in the books' own zone, and defaulting to the viewer's would
 * put a bookkeeper in Auckland a day ahead of their own ledger.
 */
export function ProviderAgreementSettingsSection() {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || FALLBACK_BOOK_TIME_ZONE
  const [asOf, setAsOf] = useState(() => today(bookTimeZone))
  const agreement = useProviderAgreement(asOf)

  return (
    <SettingsSection
      icon={ArrowLeftRight}
      title='Balance comparison'
      description={`Compare every account balance here against ${agreement.providerLabel}, as of any date. A read only - nothing posts, and no statement reads the answer.`}>
      {/* ⚠️ In the BODY here, not in `SettingsSection`'s `action` slot - unlike
          the close console, which puts the same control in its section header.
          This door carries a date field beside the button, and the settings
          layout's right-hand column is narrow enough that the pair pushed the
          title onto three lines. The close console's date is fixed by the month
          on screen, so there it is a button alone and it fits. */}
      <ProviderAgreementAction agreement={agreement} asOf={asOf} onAsOfChange={setAsOf} />
      <ProviderAgreementPanel agreement={agreement} className='mt-1' />
    </SettingsSection>
  )
}
