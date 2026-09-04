// apps/web/src/app/(protected)/app/settings/apps/[slug]/page.tsx

import { Globe } from 'lucide-react'
import { redirect } from 'next/navigation'
import AppAbout from '~/components/apps/ui/app-about'
import { AppIcon } from '~/components/apps/ui/app-icon'
import AppInstallButton from '~/components/apps/ui/app-install-button'
import { AppLeftoverFieldsCard } from '~/components/apps/ui/app-leftover-fields-card'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/server'

type Props = { params: Promise<{ slug: string }> }

async function AppPage({ params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status
  const appData = await api.apps.getBySlug({ appSlug: slug })

  // Redirect installed apps to the tabbed installed view
  if (appData.installation.isInstalled) {
    redirect(`/app/settings/apps/installed/${slug}`)
  }

  return (
    <SettingsPage
      title={appData.app.title}
      icon={
        appData.app.avatarUrl ? (
          <div className='size-10 rounded-xl overflow-hidden'>
            <AppIcon iconId={appData.app.avatarUrl} size='lg' />
          </div>
        ) : (
          <div className='size-10 border rounded-xl flex items-center justify-center bg-primary-100'>
            <Globe className='size-4' />
          </div>
        )
      }
      description={appData.app.description ?? 'App description'}
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Apps', href: '/app/settings/apps' },
        { title: appData.app.title },
      ]}
      button={
        <AppInstallButton
          appSlug={slug}
          isInstalled={appData.installation.isInstalled}
          installationType={appData.installation.installationType}
          availableDeployments={appData.availableDeployments}
        />
      }>
      {/* Only renders when an UNINSTALLED installation still owns columns; this page
          is the uninstalled-app page, which is exactly where that is true. */}
      <AppLeftoverFieldsCard appSlug={slug} appTitle={appData.app.title} />
      <AppAbout app={appData} />
    </SettingsPage>
  )
}

export default AppPage
