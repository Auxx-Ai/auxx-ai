// apps/web/src/app/(protected)/app/settings/apps/installed/[slug]/about/page.tsx
import React from 'react'
import AppAbout from '~/components/apps/app-about'
import { api } from '~/trpc/server'

/**
 * Props for AppInstalledAboutPage
 */
type Props = { params: Promise<{ slug: string }> }

/**
 * AppInstalledAboutPage component
 * Displays the about page for an installed app
 */
async function AppInstalledAboutPage({ params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status
  const appData = await api.apps.getBySlug({ appSlug: slug })

  return <AppAbout app={appData} />
}

export default AppInstalledAboutPage
