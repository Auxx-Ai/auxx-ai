// apps/web/src/app/(protected)/app/parts/settings/[[...path]]/page.tsx

import { redirect } from 'next/navigation'

/** `/app/parts/settings/*` moved to `/app/inventory/*`. */
export default async function PartsSettingsRedirect({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const { path } = await params
  redirect(`/app/inventory/${path?.join('/') || 'general'}`)
}
