// apps/web/src/app/(protected)/app/settings/apps/installed/[slug]/layout.tsx
import React from 'react'
import { Globe } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/server'
import { InstalledAppTabs } from '~/components/apps/installed-app-tabs'
import AppInstallButton from '~/components/apps/app-install-button'

/**
 * Props for InstalledAppLayout
 */
type Props = {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

/**
 * InstalledAppLayout component
 * Server component that provides layout with tabs for installed app detail pages
 */
export default async function InstalledAppLayout({ children, params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status server-side
  const appData = await api.apps.getBySlug({ appSlug: slug })

  return (
    <SettingsPage
      title={appData.app.title}
      icon={
        <div className="size-10 border rounded-xl flex items-center justify-center bg-primary-100">
          <Globe className="size-4" />
        </div>
      }
      description={appData.app.description ?? 'App description'}
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Apps', href: '/app/settings/apps' },
        { title: 'Installed', href: '/app/settings/apps/installed' },
        { title: appData.app.title },
      ]}
      button={
        <AppInstallButton
          appSlug={slug}
          isInstalled={appData.installation.isInstalled}
          installationType={appData.installation.installationType}
          availableVersions={appData.availableVersions}
        />
      }>
      <InstalledAppTabs slug={slug}>{children}</InstalledAppTabs>
    </SettingsPage>
  )
}
