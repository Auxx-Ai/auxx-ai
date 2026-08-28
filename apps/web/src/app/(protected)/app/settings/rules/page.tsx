// apps/web/src/app/(protected)/app/settings/rules/page.tsx
'use client'

import SettingsPage from '~/components/global/settings-page'
import { MailFiltersSection } from '~/components/mail-filters/ui/mail-filters-section'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { RecordRulesSection } from '~/components/record-rules/ui/record-rules-section'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/**
 * Automation settings: record rules and mail filters, side by side.
 *
 * ⚠️ **The whole-page `CapabilityPageGuard` on `automationRules.manage` is gone
 * on purpose** (plan §6.4 — reviewed as a permission change, not a side effect).
 * Personal-mailbox owners manage their filters here (D16) and need no key at all
 * (D14), so a single-key page gate locked out an audience the feature exists
 * for.
 *
 * The check moved DOWN into the sections, which each answer for their own
 * audience:
 *
 * | Caller                                     | Sees                      |
 * | ------------------------------------------ | ------------------------- |
 * | automation admin, writes to shared inboxes | both sections             |
 * | automation admin, no inbox write           | record rules only         |
 * | member with a personal mailbox, no key     | mail filters — their own  |
 * | member with neither                        | the not-authorized state  |
 *
 * The not-authorized state therefore depends on BOTH answers, which is why this
 * page reads `authorableInboxes` itself: the mail-filter half of the question is
 * "may this member author on any inbox", and no permission key expresses it —
 * holding `automationRules.manage` grants no reach over inboxes the caller
 * cannot write to, and nothing ever surfaces someone else's personal-inbox
 * filters.
 *
 * This is a MOUNT POINT, not an authorization path. `mailFiltersRouter` and
 * `recordRulesRouter` are the gates (invariant 11) — every procedure on both
 * asserts independently of anything decided here.
 */
export default function RulesPage() {
  const { can, isLoading: isAccessLoading } = useAccess()
  const hasAutomationKey = can('automationRules.manage')
  const { data: authorableInboxes, isLoading: isInboxesLoading } =
    api.mailFilters.authorableInboxes.useQuery()

  const hasMailFilters = (authorableInboxes?.length ?? 0) > 0
  // Only after BOTH answers are in — showing "no access" while either is still
  // resolving would flash a denial at members who do have access.
  const isResolved = !isAccessLoading && !isInboxesLoading
  const showNoAccess = isResolved && !hasAutomationKey && !hasMailFilters

  return (
    <SettingsPage
      title='Rules'
      description='Automate reactions to record changes, and sort new mail as it arrives — conditions and actions on any field or inbox.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Rules' }]}>
      {showNoAccess ? (
        <NoAccess area='automation rules' />
      ) : (
        <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
          <RecordRulesSection />
          <MailFiltersSection />
        </div>
      )}
    </SettingsPage>
  )
}
