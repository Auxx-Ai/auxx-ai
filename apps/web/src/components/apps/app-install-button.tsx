// apps/web/src/components/apps/app-install-button.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import { ChevronDown, Code } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

/**
 * Props for AppInstallButton component
 */
type Props = {
  appSlug: string
  isInstalled: boolean
  installationType?: 'development' | 'production'
  availableDeployments: Array<{
    id: string
    version: string | null
    deploymentType: 'development' | 'production'
    status: string
    createdAt: Date
  }>
}

/**
 * AppInstallButton component handles app installation and uninstallation
 */
export default function AppInstallButton({
  appSlug,
  isInstalled,
  installationType,
  availableDeployments,
}: Props) {
  const router = useRouter()
  const utils = api.useUtils()
  const posthog = useAnalytics()

  // Install mutation
  const install = api.apps.install.useMutation({
    onError: (error) => {
      toastError({
        title: 'Failed to install app',
        description: error.message,
      })
    },
  })

  // Uninstall mutation
  const uninstall = api.apps.uninstall.useMutation({
    onError: (error) => {
      toastError({
        title: 'Failed to uninstall app',
        description: error.message,
      })
    },
  })

  /**
   * Handle install for a specific deployment
   */
  const handleInstall = async (deploymentId: string) => {
    await install.mutateAsync({
      appSlug,
      deploymentId,
    })
    posthog?.capture('app_installed', { app_slug: appSlug })
    await utils.apps.getBySlug.invalidate({ appSlug })
    router.refresh()
    router.push(`/app/settings/apps/installed/${appSlug}`)
  }

  /**
   * Handle uninstall button click
   */
  const handleUninstall = async () => {
    await uninstall.mutateAsync({
      appSlug,
      type: installationType,
    })
    await utils.apps.getBySlug.invalidate({ appSlug })
    router.refresh()
    router.push(`/app/settings/apps/${appSlug}`)
  }

  const isPending = install.isPending || uninstall.isPending

  // If installed, show uninstall button
  if (isInstalled) {
    return (
      <Button
        variant='destructive'
        size='sm'
        onClick={handleUninstall}
        loading={isPending}
        loadingText='Uninstalling...'>
        Uninstall
      </Button>
    )
  }

  // Get recommended deployment (first installable deployment)
  const recommendedDeployment = availableDeployments.find((d) =>
    d.deploymentType === 'development' ? d.status === 'active' : d.status === 'published'
  )

  // Not installed - show split button with dropdown
  return (
    <div className='flex'>
      {/* Main install button */}
      <Button
        variant='default'
        size='sm'
        onClick={() => recommendedDeployment && handleInstall(recommendedDeployment.id)}
        loading={isPending}
        loadingText='Installing...'
        disabled={!recommendedDeployment}
        className='rounded-r-none border-r-0'>
        Install
      </Button>

      {/* Dropdown menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='default'
            size='icon-sm'
            className='rounded-l-none border-l focus:ring-0 focus-visible:ring-offset-0'
            disabled={isPending}>
            <ChevronDown className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-[250px]'>
          {availableDeployments.map((deployment) => {
            const isInstallable =
              deployment.deploymentType === 'development'
                ? deployment.status === 'active'
                : deployment.status === 'published'

            return (
              <DropdownMenuItem
                key={deployment.id}
                onClick={() => handleInstall(deployment.id)}
                disabled={!isInstallable}
                className=''>
                <div className='flex items-center justify-between w-full'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>
                      {deployment.version ? `v${deployment.version}` : 'Latest'}
                    </span>
                    {!isInstallable && (
                      <Badge variant='outline' className='text-xs'>
                        {deployment.status}
                      </Badge>
                    )}
                    <div className='text-xs text-muted-foreground'>
                      {format(new Date(deployment.createdAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                  {deployment.deploymentType === 'development' && (
                    <Badge variant='secondary' className='text-xs'>
                      <Code className='size-3' />
                      Dev
                    </Badge>
                  )}
                </div>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
