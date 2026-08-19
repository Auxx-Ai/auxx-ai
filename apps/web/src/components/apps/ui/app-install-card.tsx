// apps/web/src/components/apps/ui/app-install-card.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Plug } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useAppConnectionResolver } from '~/components/apps/hooks/use-app-connection-state'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { useOptionalAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

interface AppInstallCardProps {
  appSlug: string
  /** Fired after a successful install, once the apps caches have refreshed. */
  onInstalled?: () => void
  className?: string
}

/**
 * Offer to install a marketplace app, and then to connect an account for it,
 * **without ever navigating away** from the surface the card sits in (a Kopilot
 * transcript, a workflow node's panel). A full-page redirect out of the builder
 * destroys the canvas and any transcript with it, so:
 *
 *  - install runs through `InlineAppInstallButton` → `api.apps.install`, in the
 *    user's own session, with every router gate/audit/cache event attached;
 *  - connect happens inside `AppSettingsDialog`'s `connections` tab, which owns
 *    the `ConnectTarget` assembly, per-scope `ConnectButton`s, the multi-method
 *    dropdown and the `canEdit` gate. This card builds no connect UI of its own
 *    and never touches `useConnectFlow` — `flow.start` falls back to
 *    `window.location.href` when a popup is blocked, so it must only ever be
 *    reached from a real click, inside that dialog.
 */
export function AppInstallCard({ appSlug, onInstalled, className }: AppInstallCardProps) {
  const pathname = usePathname()
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()
  const resolveConnection = useAppConnectionResolver()
  const access = useOptionalAccess()
  const [connectOpen, setConnectOpen] = useState(false)

  // Display metadata only — `getBySlug` is NOT the installed-state authority
  // (see below). `retry: false` so an invented slug settles on NOT_FOUND fast.
  const details = api.apps.getBySlug.useQuery({ appSlug }, { retry: false })

  // The installed-state authority is `AppsContext`: `InlineAppInstallButton`
  // refreshes installations on success, and that is what advances this card.
  const installation = appInstallations.find((inst) => inst.app.slug === appSlug)
  const isInstalled = !!installation

  // An invented slug renders as a muted line, never as an Install button that
  // would fail at mutate-time with a toast.
  if (details.isError) {
    return (
      <p className='text-xs text-foreground/50'>
        That app isn’t available to install in this workspace.
      </p>
    )
  }
  if (!details.data) return null

  const { app, developerAccount, installation: appDetails } = details.data

  // `installation.connectionDefinitions` on `getBySlug` is populated only when
  // the app IS installed — the derived two-slot view is installed-only by
  // design. `methods` is the install-independent list (connection methods are
  // app-keyed), which is what lets the PRE-install card say "will need an
  // account". The resolver cannot answer this before install either: it derives
  // `requiresConnection` from the *installations* list, so an uninstalled app
  // resolves to `not_required` — a false negative that would hide connect
  // entirely.
  const declaresConnection =
    appDetails.methods.length > 0 ||
    !!appDetails.connectionDefinitions.user ||
    !!appDetails.connectionDefinitions.organization

  const connection = resolveConnection(app.id, undefined)
  const needsConnect =
    isInstalled &&
    declaresConnection &&
    (connection.state === 'missing' || connection.state === 'expired')
  const isReady = isInstalled && declaresConnection && connection.state === 'ok'

  // `api.apps.install` is `permissionProcedure(integrationsManage)`; without it
  // the click ends in a 403 toast. Outside a `CapabilitiesProvider` the answer
  // is unknown — stay visible, the server gates regardless.
  const canInstall = access ? access.can(PermissionKey.integrationsManage) : true

  const subtitle = [
    developerAccount.title,
    !isInstalled && declaresConnection ? `Will need a ${app.title} account` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-2xl bg-card/25 p-2 pl-3 shadow-lg shadow-black/[.065] ring-1 ring-border-illustration',
          className
        )}>
        <div className='flex min-w-0 items-center gap-2'>
          <AppIcon iconId={app.avatarUrl ?? 'package'} size='default' />
          <div className='min-w-0'>
            <div className='truncate text-xs font-semibold text-foreground/90'>{app.title}</div>
            {subtitle && <div className='truncate text-xs text-foreground/50'>{subtitle}</div>}
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-1.5'>
          {needsConnect ? (
            <Button
              variant='outline'
              size='sm'
              className='h-6 text-xs'
              onClick={() => setConnectOpen(true)}>
              <Plug />
              {connection.state === 'expired' ? 'Reconnect' : 'Connect'}
            </Button>
          ) : isReady ? (
            <Badge variant='gray' className='h-6 text-xs'>
              <Check className='mr-1' />
              Ready
            </Badge>
          ) : !isInstalled && !canInstall ? (
            <span className='text-xs text-foreground/50'>Ask an admin to install</span>
          ) : (
            // Renders the `Installed` badge itself once installed — this card
            // deliberately does not reimplement that state.
            <InlineAppInstallButton
              appSlug={appSlug}
              onInstalled={() => {
                void utils.apps.listConnections.invalidate()
                onInstalled?.()
              }}
            />
          )}
        </div>
      </div>

      {installation && (
        <AppSettingsDialog
          appSlug={appSlug}
          installationType={installation.installationType}
          // The safety net for the popup-blocked → full-page-redirect fallback
          // we cannot fully prevent: come back to where the card is, not to /app.
          returnTo={pathname || '/app'}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          initialTab='connections'
          onConnectionCreated={() => {
            setConnectOpen(false)
            void utils.apps.listConnections.invalidate()
          }}
        />
      )}
    </>
  )
}
