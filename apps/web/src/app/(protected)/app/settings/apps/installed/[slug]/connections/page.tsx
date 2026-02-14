import AppConnections from '~/components/apps/app-connections'
import { api } from '~/trpc/server'

/**
 * Props for AppInstalledConnectionsPage
 */
type Props = { params: Promise<{ slug: string }> }

/**
 * AppInstalledConnectionsPage component
 * Displays the connections page for an installed app
 */
async function AppInstalledConnectionsPage({ params }: Props) {
  const { slug } = await params

  // Fetch app details with installation status
  const appData = await api.apps.getBySlug({ appSlug: slug })

  return <AppConnections app={appData} />
}

export default AppInstalledConnectionsPage
