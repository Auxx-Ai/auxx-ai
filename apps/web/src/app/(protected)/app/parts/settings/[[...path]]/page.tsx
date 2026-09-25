// apps/web/src/app/(protected)/app/parts/settings/[[...path]]/page.tsx

import { redirect } from 'next/navigation'

/** `/app/parts/settings/*` moved to `/app/parts/manage/*` (plans/mrp/07-ui-plan.md D26). */
export default async function PartsSettingsRedirect({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const { path } = await params
  redirect(`/app/parts/manage/${path?.join('/') || 'general'}`)
}
