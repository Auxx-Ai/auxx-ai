// apps/web/src/app/(protected)/app/accounting/settings/page.tsx

import { redirect } from 'next/navigation'

/**
 * Index route for the accounting settings segment.
 *
 * Two things need it. `SidebarSecondary` always links to `${baseUrl}/${slug}`
 * with no empty-slug support, and `MainPageTabs` derives its active tab by
 * LONGEST-PREFIX match on the pathname — so the Settings tab has to point at
 * this segment rather than at a leaf. Pointing it at `/settings/general`
 * (which it did) made every OTHER settings page fall through to the `/app/accounting`
 * prefix and light up the Ledger tab instead. Same shape as
 * `dispatch/settings/page.tsx`.
 */
function AccountingSettings() {
  redirect('/app/accounting/settings/general')
}

export default AccountingSettings
