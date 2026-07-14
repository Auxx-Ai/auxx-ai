// apps/web/src/app/(protected)/app/dispatch/settings/page.tsx

import { redirect } from 'next/navigation'

/** `SidebarSecondary` always links to `${baseUrl}/${slug}` (no empty-slug support), so the
 * index route just redirects to the General settings page. */
function DispatchSettings() {
  redirect('/app/dispatch/settings/general')
}

export default DispatchSettings
