// apps/build/src/app/(portal)/[slug]/page.tsx

import { redirect, RedirectType } from 'next/navigation'
import { api } from '~/trpc/server'

/** Developer account page - redirects to first app or onboarding */
export default async function DeveloperAccountPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Check access and get first app
  const { app, account } = await api.developerAccounts.getFirstApp({ slug })

  if (app) {
    // Redirect to first app
    redirect(`/${slug}/apps/${app.slug}`)
  } else {
    // No apps yet, redirect to onboarding
    return redirect(`/${slug}/onboarding/first-app`, RedirectType.replace)
  }
}
