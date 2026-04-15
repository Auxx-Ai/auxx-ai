// apps/web/src/app/(protected)/app/meetings/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Meeting import entry point.
 * Redirects to the upload step for a new import.
 */
export default function MeetingsImportPage() {
  redirect('/app/meetings/import/new?step=upload')
}
