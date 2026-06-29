// apps/web/src/components/fields/connector-source-badge.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import {
  type ResolvedConnector,
  useConnector,
} from '~/components/resources/hooks/use-connector-name'

interface ConnectorSourceBadgeProps {
  /**
   * `EntityInstance.integrationSource` — a DataConnector id for connector-synced
   * records, null/undefined for hand-created records. Anything that doesn't
   * resolve to a known connector renders nothing (handles legacy free-form
   * sources).
   */
  integrationSource: string | null | undefined
  /** `icon` → bare logo (grid primary cell); `chip` → logo + name (drawer header). */
  variant: 'icon' | 'chip'
  className?: string
}

/** `"app:shopify"` → `"shopify"`; null for non-app connector types. */
function slugFromType(type: string): string | null {
  return type.startsWith('app:') ? type.slice('app:'.length) : null
}

/**
 * Entity-level "Synced from <connector>" indicator. Resolves the record's
 * `integrationSource` (a DataConnector id) to its installed app's branding via
 * the existing `useConnector` + `useAppsContext` hooks — the same pair the
 * connector builder uses — so the badge shows the real app logo + title.
 *
 * Complements the per-cell `ConnectorLockBadge` (field-grain provenance) with a
 * record-grain marker. Renders `null` until resolved / when the source isn't a
 * known connector, so unmanaged rows pay nothing visually.
 */
export function ConnectorSourceBadge({
  integrationSource,
  variant,
  className,
}: ConnectorSourceBadgeProps) {
  const connector = useConnector(integrationSource)
  // Resolve nothing until the source maps to a known connector. Gating the
  // inner component here means hand-created records (the common case) never read
  // `useAppsContext` — so the badge is safe to render in tables that may live
  // outside `AppsProvider` (e.g. KB articles), which carry no integrationSource.
  if (!connector) return null
  return <ResolvedSourceBadge connector={connector} variant={variant} className={className} />
}

function ResolvedSourceBadge({
  connector,
  variant,
  className,
}: { connector: ResolvedConnector } & Pick<ConnectorSourceBadgeProps, 'variant' | 'className'>) {
  const { appInstallations } = useAppsContext()

  const app = useMemo(() => {
    const slug = slugFromType(connector.type)
    return appInstallations.find(
      (i) => i.installationId === connector.appInstallationId || (slug && i.app.slug === slug)
    )?.app
  }, [connector, appInstallations])

  // Prefer the connector's own name (e.g. "Shopify Customers"); fall back to the
  // app title. Logo = the app's uploaded avatar, else a generic plug.
  const label = connector.name || app?.title || 'a data connector'
  const iconId = app?.avatarUrl ?? 'plug'

  if (variant === 'icon') {
    return (
      <Tooltip content={`Synced from ${label}`} side='top'>
        <AppIcon iconId={iconId} fallbackIconId='plug' size='xs' className={className} />
      </Tooltip>
    )
  }

  return (
    <Tooltip content={`Synced from ${label}`} side='top'>
      <Badge variant='gray' size='sm' className={cn('gap-1', className)}>
        <AppIcon iconId={iconId} fallbackIconId='plug' size='xs' />
        {label}
      </Badge>
    </Tooltip>
  )
}
