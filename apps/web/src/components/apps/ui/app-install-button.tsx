// apps/web/src/components/apps/ui/app-install-button.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { Check, ChevronDown, Code, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useAnalytics } from '~/hooks/use-analytics'
import { useConfirm } from '~/hooks/use-confirm'
import { useDemo } from '~/hooks/use-demo'
import { api } from '~/trpc/react'

/** Copy for the demo block, shared by both install buttons. */
const DEMO_BLOCK = {
  title: 'Not Available in Demo',
  description: 'Installing apps is not available in demo mode. Sign up to connect your own tools.',
} as const

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
  const { isDemo } = useDemo()
  const [demoDialogOpen, setDemoDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

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
    // Covers the split button and every dropdown entry — both route through here.
    if (isDemo) {
      setDemoDialogOpen(true)
      return
    }
    await install.mutateAsync({
      appSlug,
      deploymentId,
    })
    posthog?.capture('app_installed', { app_slug: appSlug })
    await utils.apps.getBySlug.invalidate({ appSlug })
    router.refresh()
    router.push(`/app/settings/apps/installed/${appSlug}`)
  }

  // What an uninstall would touch. Only fetched while the app IS installed — the
  // dialog is the sole consumer and the query is a handful of aggregates.
  const impact = api.apps.uninstallImpact.useQuery(
    { appSlug, type: installationType },
    { enabled: isInstalled }
  )

  /**
   * Uninstall, after naming what it destroys (plans/money/tasks/44 D-3).
   *
   * 🛑 There was no confirmation here at all — one click uninstalled, deleted every
   * connector the installation owned, and deleted every column it had registered
   * along with their values. The three branches below are the same keep/archive/delete
   * disposition the connector detail view already offers, so the two surfaces read the
   * same way.
   */
  const handleUninstall = async (syncedData: 'keep' | 'archive' | 'delete') => {
    const data = impact.data
    const connectors = data?.connectors ?? []
    const records = (data?.mintedTotal ?? 0).toLocaleString()
    const plural = (data?.mintedTotal ?? 0) === 1

    // Named, not implied. `mintedTotal` counts only records the connectors CREATED —
    // a pre-existing contact one merely enriched is never touched on any branch.
    const connectorClause =
      connectors.length === 0
        ? ''
        : syncedData === 'keep'
          ? ` ${connectors.length} ${connectors.length === 1 ? 'connector is' : 'connectors are'} disconnected and can be resumed after reinstalling.`
          : ` ${connectors.length} ${connectors.length === 1 ? 'connector is' : 'connectors are'} removed.`

    const copy = {
      keep: `Synced records are kept.${connectorClause}`,
      archive: `${records} synced ${plural ? 'record is' : 'records are'} archived.${connectorClause}`,
      delete: `${records} synced ${plural ? 'record' : 'records'} ${plural ? 'is' : 'are'} permanently deleted.${connectorClause}`,
    }[syncedData]

    // Removing records runs on the worker, so say so rather than leaving the user
    // watching an app that has not disappeared yet.
    const background =
      syncedData === 'keep' || (data?.mintedTotal ?? 0) === 0
        ? ''
        : ' Removing them runs in the background and may take a few minutes.'

    const confirmed = await confirm({
      title: `Uninstall ${appSlug}?`,
      description: `${copy}${background}`,
      confirmText: syncedData === 'keep' ? 'Uninstall' : 'Uninstall and remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    await uninstall.mutateAsync({
      appSlug,
      type: installationType,
      syncedData,
    })
    await utils.apps.getBySlug.invalidate({ appSlug })
    router.refresh()
    router.push(`/app/settings/apps/${appSlug}`)
  }

  const isPending = install.isPending || uninstall.isPending

  // If installed, show uninstall split button. The dropdown mirrors
  // `connector-detail-view`'s delete menu: the keep branch is the plain click, the
  // destructive branches are a deliberate second choice.
  if (isInstalled) {
    const hasRecords = (impact.data?.mintedTotal ?? 0) > 0
    return (
      <>
        <div className='flex'>
          <Button
            variant='destructive'
            size='sm'
            onClick={() => void handleUninstall('keep')}
            loading={isPending}
            loadingText='Uninstalling...'
            className={hasRecords ? 'rounded-r-none border-r-0' : undefined}>
            Uninstall
          </Button>
          {hasRecords && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='destructive'
                  size='icon-sm'
                  className='rounded-l-none border-l focus:ring-0 focus-visible:ring-offset-0'
                  disabled={isPending}
                  aria-label='Uninstall options'>
                  <ChevronDown className='size-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => void handleUninstall('keep')}>
                  Uninstall, keep synced records
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleUninstall('archive')}>
                  Uninstall, archive synced records
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => void handleUninstall('delete')}>
                  Uninstall and delete synced records
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <ConfirmDialog />
      </>
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

      <LimitReachedDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        icon={Download}
        title={DEMO_BLOCK.title}
        description={DEMO_BLOCK.description}
      />
    </div>
  )
}

type InlineAppInstallButtonProps = {
  appSlug: string
  /** Custom content for the button. Defaults to "Install" with download icon */
  children?: React.ReactNode
  /**
   * Fired after a successful install, once installations and the app's
   * `getBySlug` cache have both been refreshed. Lets a caller advance its own
   * state (e.g. Kopilot's install card moving on to Connect) without polling.
   */
  onInstalled?: () => void
  /**
   * Everything else lands on the `Button`. A dialog footer needs to override the
   * compact inline sizing and to carry `data-dialog-submit` (what `Dialog` keys
   * Enter-to-submit off), neither of which this component can decide for itself.
   * `onClick`/`loading` stay owned here — they ARE the install.
   */
} & Omit<ButtonProps, 'onClick' | 'loading' | 'loadingText' | 'children'>

/**
 * Lightweight install button that self-determines install status.
 * Use in contexts where you want inline install without navigating away.
 */
export function InlineAppInstallButton({
  appSlug,
  children,
  onInstalled,
  variant = 'outline',
  size = 'sm',
  className,
  ...buttonProps
}: InlineAppInstallButtonProps) {
  const { appInstallations, refreshInstallations } = useAppsContext()
  const utils = api.useUtils()
  const posthog = useAnalytics()
  const { isDemo } = useDemo()
  const [demoDialogOpen, setDemoDialogOpen] = useState(false)

  const isInstalled = appInstallations.some((inst) => inst.app.slug === appSlug)

  const install = api.apps.install.useMutation({
    onSuccess: async () => {
      posthog?.capture('app_installed', { app_slug: appSlug })
      // Mirrors `AppInstallButton` — a stale `getBySlug` after an install is
      // wrong for every consumer, not just the one that noticed.
      await Promise.all([refreshInstallations(), utils.apps.getBySlug.invalidate({ appSlug })])
      onInstalled?.()
    },
    onError: (error) => {
      toastError({ title: 'Failed to install app', description: error.message })
    },
  })

  if (isInstalled) {
    return (
      <Badge variant='gray' className='h-6 text-xs'>
        <Check className='mr-1' />
        Installed
      </Badge>
    )
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        // Compact by default (this button usually sits inline in a sentence or a
        // card row); `className` is twMerge'd, so a footer caller passing `h-7`
        // gets the standard `size='sm'` height back.
        className={cn('h-6 text-xs', className)}
        {...buttonProps}
        onClick={(e) => {
          e.stopPropagation()
          if (isDemo) {
            setDemoDialogOpen(true)
            return
          }
          install.mutate({ appSlug })
        }}
        loading={install.isPending}
        loadingText='Installing...'>
        {children ?? (
          <>
            <Download className='size-3' />
            Install
          </>
        )}
      </Button>

      <LimitReachedDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        icon={Download}
        title={DEMO_BLOCK.title}
        description={DEMO_BLOCK.description}
      />
    </>
  )
}
