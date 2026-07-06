'use client'
import { Input } from '@auxx/ui/components/input'
import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
// apps/web/src/app/(protected)/app/settings/apps/installed/page.tsx
import { Code, Trash } from 'lucide-react'
import { useState } from 'react'
import { dedupeInstallationsByApp } from '~/components/apps/dedupe-installations'
import { useUninstallApp } from '~/components/apps/hooks/use-uninstall-app'
import { AppIcon } from '~/components/apps/ui/app-icon'
import SettingsPage from '~/components/global/settings-page'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

/**
 * AppsInstalledListPage component
 * Displays a list of installed apps with search functionality
 */
export default function AppsInstalledListPage() {
  const { data: installedResult } = api.apps.listInstalled.useQuery(
    {
      // type filter is optional - omitting it returns all installations (both dev and production)
    },
    { staleTime: ORG_STATIC_STALE_TIME }
  )
  const { data: results } = api.apps.list.useQuery({}, { staleTime: ORG_STATIC_STALE_TIME })
  const { uninstallApp, ConfirmDialog } = useUninstallApp()

  // Collapse dev+production installs of the same app to one entry (see helper).
  const installed = dedupeInstallationsByApp(installedResult?.installations ?? [])
  const apps = results?.apps ?? []

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Get installed apps with full app data
  const installedAppsWithData = installed
    .map((installation) => {
      const fullApp = apps.find((app) => app.slug === installation.app.slug)
      return fullApp ? { app: fullApp, installation } : null
    })
    .filter(
      (item): item is { app: (typeof apps)[0]; installation: (typeof installed)[0] } =>
        item !== null
    )

  // Filter installed apps based on search query
  const filteredInstalledApps = installedAppsWithData.filter(({ app }) => {
    if (!searchQuery.trim()) return true

    const query = searchQuery.toLowerCase()
    return (
      app.title.toLowerCase().includes(query) ||
      app.description?.toLowerCase().includes(query) ||
      app.category?.toLowerCase().includes(query) ||
      app.developerAccount.title.toLowerCase().includes(query)
    )
  })

  return (
    <SettingsPage
      title='Installed Apps'
      description='Manage your installed applications'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Apps', href: '/app/settings/apps' },
        { title: 'Installed' },
      ]}
      button={<></>}>
      <ConfirmDialog />
      <div className='flex flex-col flex-1 p-3 sm:p-6 space-y-6 @container'>
        <Input
          placeholder='Search installed apps'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {filteredInstalledApps.length === 0 && searchQuery.trim() ? (
          <div className='text-center py-12 text-muted-foreground'>
            <div className='text-base font-medium mb-2'>No apps found</div>
            <div className='text-sm'>
              Try adjusting your search query to find what you're looking for
            </div>
          </div>
        ) : filteredInstalledApps.length === 0 ? (
          <div className='border bg-primary-50 w-full p-6 rounded-2xl text-center text-sm text-muted-foreground'>
            No apps installed yet
          </div>
        ) : (
          <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
            {filteredInstalledApps.map(({ app, installation }) => (
              <ListCard
                key={app.id}
                title={app.title}
                description={app.description}
                href={`/app/settings/apps/installed/${app.slug}`}
                icon={app.avatarUrl ? <AppIcon iconId={app.avatarUrl} size='sm' /> : undefined}
                subtitle={`By ${app.developerAccount.title}`}
                verified={app.verified}
                headerEnd={renderBadgeChips([
                  ...(app.isDevelopment ? [{ icon: <Code className='size-3' /> }] : []),
                  ...(app.isInstalled ? [{ label: 'Installed' }] : []),
                ])}
                menuItems={[
                  {
                    label: 'Uninstall',
                    icon: <Trash />,
                    destructive: true,
                    onClick: () => void uninstallApp(app.slug, installation.installationType),
                  },
                ]}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsPage>
  )
}
