// apps-web/src/components/apps/app-install-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ChevronDown, Code } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { format } from 'date-fns'

/**
 * Props for AppInstallButton component
 */
type Props = {
  appSlug: string
  isInstalled: boolean
  installationType?: 'development' | 'production'
  availableVersions: Array<{
    id: string
    versionString: string
    versionType: 'dev' | 'prod'
    status: string
    releasedAt: Date | null
  }>
}

/**
 * AppInstallButton component handles app installation and uninstallation
 */
export default function AppInstallButton({
  appSlug,
  isInstalled,
  installationType,
  availableVersions,
}: Props) {
  const router = useRouter()
  const utils = api.useUtils()

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
   * Handle install for a specific version
   */
  const handleInstall = async (versionId: string) => {
    await install.mutateAsync({
      appSlug,
      versionId,
    })
    await utils.apps.getBySlug.invalidate({ appSlug })
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
    router.push(`/app/settings/apps/${appSlug}`)
  }

  const isPending = install.isPending || uninstall.isPending

  // If installed, show uninstall button
  if (isInstalled) {
    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={handleUninstall}
        loading={isPending}
        loadingText="Uninstalling...">
        Uninstall
      </Button>
    )
  }

  // Get recommended version (first active version)
  const recommendedVersion = availableVersions.find((v) => v.status === 'active')

  // Not installed - show split button with dropdown
  return (
    <div className="flex">
      {/* Main install button */}
      <Button
        variant="default"
        size="sm"
        onClick={() => recommendedVersion && handleInstall(recommendedVersion.id)}
        loading={isPending}
        loadingText="Installing..."
        disabled={!recommendedVersion}
        className="rounded-r-none border-r-0">
        Install
      </Button>

      {/* Dropdown menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="icon-sm"
            className="rounded-l-none border-l focus:ring-0 focus-visible:ring-offset-0"
            disabled={isPending}>
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[250px]">
          {availableVersions.map((version) => (
            <DropdownMenuItem
              key={version.id}
              onClick={() => handleInstall(version.id)}
              disabled={version.status !== 'active'}
              className="">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{version.versionString}</span>
                  {version.status !== 'active' && (
                    <Badge variant="outline" className="text-xs">
                      {version.status}
                    </Badge>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {version.releasedAt
                      ? format(new Date(version.releasedAt), 'MMM d, yyyy')
                      : 'Not released'}
                  </div>
                </div>
                {version.versionType === 'dev' && (
                  <Badge variant="secondary" className="text-xs">
                    <Code className="size-3" />
                    Dev
                  </Badge>
                )}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
