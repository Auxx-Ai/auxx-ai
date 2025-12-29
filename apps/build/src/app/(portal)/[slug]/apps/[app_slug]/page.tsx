// apps/build/src/app/(portal)/[slug]/apps/[:app_slug]/page.tsx

import { AppUpdateForm } from '~/components/apps/app-update-form'

interface AppPageProps {
  params: Promise<{
    slug: string
    app_slug: string
  }>
}

/**
 * App details page
 * Uses dehydrated state from BuildDehydratedStateProvider for instant render
 */
export default async function AppPage(props: AppPageProps) {
  const params = await props.params
  console.log(params)
  return <AppUpdateForm appSlug={params.app_slug} />
}
