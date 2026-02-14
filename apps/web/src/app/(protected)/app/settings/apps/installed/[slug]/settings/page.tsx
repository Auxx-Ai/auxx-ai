import AppSettings from '~/components/apps/app-settings'
import { api } from '~/trpc/server'

/**
 * Props for AppInstalledSettingsPage
 */
type Props = { params: Promise<{ slug: string }> }

/**
 * AppInstalledSettingsPage component
 * Displays the settings page for an installed app
 */
async function AppInstalledSettingsPage({ params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status
  const appData = await api.apps.getBySlug({ appSlug: slug })

  // Check if app is installed
  if (!appData.installation.isInstalled) {
    return <div className='p-6'>App not installed</div>
  }

  const installationType = appData.installation.installationType!

  // Fetch schema and settings in parallel
  const [schema, currentSettings] = await Promise.all([
    api.apps.getSettingsSchema({
      appSlug: slug,
      installationType,
    }),
    api.apps.getSettings({
      appSlug: slug,
      installationType,
    }),
  ])

  return (
    <AppSettings
      app={appData}
      installationType={installationType}
      currentSettings={currentSettings}
      schema={schema}
    />
  )
}

export default AppInstalledSettingsPage
