// apps/web/src/app/(protected)/app/parts/manage/page.tsx

import { redirect } from 'next/navigation'

/** The segment index: the Manage tab points here, never at a leaf (`MainPageTabs` longest-prefix). */
export default function ManageIndexPage() {
  redirect('/app/parts/manage/general')
}
