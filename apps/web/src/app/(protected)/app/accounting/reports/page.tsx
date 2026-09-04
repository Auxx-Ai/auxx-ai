// apps/web/src/app/(protected)/app/accounting/reports/page.tsx

import { redirect } from 'next/navigation'

/**
 * Index route for the reports segment - same shape and same reason as
 * `settings/page.tsx`: `SidebarSecondary` always links to
 * `${baseUrl}/${slug}` with no empty-slug support, and `MainPageTabs`
 * matches the Reports tab by longest prefix, so this segment has to render
 * something rather than redirect through a leaf page.
 */
function AccountingReports() {
  redirect('/app/accounting/reports/trial-balance')
}

export default AccountingReports
