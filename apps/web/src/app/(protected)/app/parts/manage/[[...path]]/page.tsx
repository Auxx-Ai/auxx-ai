// apps/web/src/app/(protected)/app/parts/manage/[[...path]]/page.tsx

import { redirect } from 'next/navigation'

/** `/app/parts/manage/*` moved to `/app/inventory/*`; seeded dashboard widgets still link here. */
export default async function PartsManageRedirect({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const { path } = await params
  redirect(`/app/inventory${path?.length ? `/${path.join('/')}` : ''}`)
}
