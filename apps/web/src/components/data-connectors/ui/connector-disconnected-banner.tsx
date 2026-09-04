// apps/web/src/components/data-connectors/ui/connector-disconnected-banner.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
import { Unplug } from 'lucide-react'
import Link from 'next/link'

interface ConnectorDisconnectedBannerProps {
  /** The connector's live status — only `'disconnected'` renders anything. */
  status: string
  /** Free-text reason stamped by `disconnectConnectors` ("Shopify was uninstalled"). */
  error?: string | null
  /** App slug, when the connector came from an app — drives the reinstall link. */
  appSlug?: string | null
}

/**
 * Why this connector stopped, when the merchant did not stop it
 * (plans/money/tasks/44 D-4).
 *
 * 🛑 Not optional polish. A `disconnected` connector keeps its rows, its bindings and
 * its cadence, and does nothing — which without an explanation reads as a bug, and the
 * obvious "fix" is to delete the connector by hand. That is precisely the outcome
 * disconnecting exists to avoid: the delete takes 13,173 `DataConnectorItem` bindings
 * with it and makes the next sync re-mint duplicates.
 *
 * Deliberately NOT dismissible, unlike `ConnectorResyncBanner`. That one is advisory
 * (the safety already ran); this one is the only place the state is explained, and a
 * dismissed banner would leave the merchant back at "why is this doing nothing".
 */
export function ConnectorDisconnectedBanner({
  status,
  error,
  appSlug,
}: ConnectorDisconnectedBannerProps) {
  if (status !== 'disconnected') return null

  return (
    <Banner
      variant='warning'
      icon={<Unplug />}
      title={error || 'This connector is disconnected'}
      action={
        appSlug ? (
          <Button asChild variant='outline' size='xs'>
            <Link href={`/app/settings/apps/${appSlug}`}>Reinstall app</Link>
          </Button>
        ) : undefined
      }>
      Syncing is stopped. Your synced records and their sync history are kept — reinstalling the app
      restores the connector, and you resume it from here.
    </Banner>
  )
}
