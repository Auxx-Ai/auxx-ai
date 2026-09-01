// apps/web/src/app/(protected)/app/parts/settings/page.tsx

import { redirect } from 'next/navigation'

/**
 * Index route for the parts settings segment.
 *
 * Two things need it. `SidebarSecondary` always links to `${baseUrl}/${slug}`
 * with no empty-slug support, and `MainPageTabs` derives its active tab by
 * LONGEST-PREFIX match on the pathname — so the Settings tab has to point at
 * this segment rather than at a leaf, or every settings page falls through to
 * the `/app/parts` prefix and lights up the Parts tab instead. Same shape as
 * `accounting/settings/page.tsx`, which recorded that failure.
 */
function PartsSettings() {
  redirect('/app/parts/settings/general')
}

export default PartsSettings
