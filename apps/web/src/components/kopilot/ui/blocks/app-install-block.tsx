// apps/web/src/components/kopilot/ui/blocks/app-install-block.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Check, Plug } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useAppConnectionResolver } from '~/components/apps/hooks/use-app-connection-state'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { AppSettingsDialog } from '~/components/apps/ui/app-settings-dialog'
import { api } from '~/trpc/react'
import type { BlockRendererProps } from './block-registry'
import type { AppInstallData } from './block-schemas'
import { useStreamSafeIds } from './use-stream-safe-ids'

/**
 * `auxx:app-install` — offer to install a marketplace app, and then to connect
 * an account for it, **without ever navigating away** from the surface the chat
 * is sitting in (the workflow builder, typically). A full-page redirect out of
 * the builder destroys the canvas and this transcript, so:
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
export function AppInstallBlock({ data, lastValueTruncated }: BlockRendererProps<AppInstallData>) {
  // Mid-stream the fence reads `{"appSlug":"u` — withhold the slug until its
  // JSON string is closed, or the card would query and 404 on a prefix and
  // flash "not available" before the real slug lands.
  const [appSlug] = useStreamSafeIds(data.appSlug ? [data.appSlug] : [], lastValueTruncated)
  if (!appSlug) return null

  return (
    <div className='not-prose my-2'>
      <AppInstallCard appSlug={appSlug} />
    </div>
  )
}

function AppInstallCard({ appSlug }: { appSlug: string }) {
  const pathname = usePathname()
  const utils = api.useUtils()
  const { appInstallations } = useAppsContext()
  const resolveConnection = useAppConnectionResolver()
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

  const subtitle = [
    developerAccount.title,
    !isInstalled && declaresConnection ? `Will need a ${app.title} account` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className='flex items-center justify-between gap-3 rounded-2xl bg-card/25 p-2 pl-3 shadow-lg shadow-black/[.065] ring-1 ring-border-illustration'>
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
          ) : (
            // Renders the `Installed` badge itself once installed — this card
            // deliberately does not reimplement that state.
            <InlineAppInstallButton
              appSlug={appSlug}
              onInstalled={() => void utils.apps.listConnections.invalidate()}
            />
          )}
        </div>
      </div>

      {installation && (
        <AppSettingsDialog
          appSlug={appSlug}
          installationType={installation.installationType}
          // The safety net for the popup-blocked → full-page-redirect fallback
          // we cannot fully prevent: come back to the builder, not to /app.
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
