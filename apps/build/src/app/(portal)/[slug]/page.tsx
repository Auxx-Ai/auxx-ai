// apps/build/src/app/(portal)/[slug]/page.tsx

import { RedirectType, redirect } from 'next/navigation'
import { api } from '~/trpc/server'

/** Developer account page - redirects to first app or onboarding */
export default async function DeveloperAccountPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  try {
    // Check access and get first app
    const { app } = await api.developerAccounts.getFirstApp({ slug })

    if (app) {
      redirect(`/${slug}/apps/${app.slug}`)
    } else {
      redirect(`/${slug}/onboarding/first-app`, RedirectType.replace)
    }
  } catch (error) {
    // Re-throw Next.js redirects (they use errors internally)
    if (error instanceof Error && 'digest' in error) {
      throw error
    }
    // Account not found or access denied — redirect to root
    redirect('/', RedirectType.replace)
  }
}
