import { Globe } from 'lucide-react'
import AppAbout from '~/components/apps/app-about'
import AppInstallButton from '~/components/apps/app-install-button'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/server'

type Props = { params: Promise<{ slug: string }> }

async function AppPage({ params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status
  const appData = await api.apps.getBySlug({ appSlug: slug })
  return (
    <SettingsPage
      title={appData.app.title}
      icon={
        <div className='size-10 border rounded-xl flex items-center justify-center bg-primary-100'>
          <Globe className='size-4' />
        </div>
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
          availableVersions={appData.availableVersions}
        />
      }>
      <AppAbout app={appData} />
    </SettingsPage>
  )
}

export default AppPage
