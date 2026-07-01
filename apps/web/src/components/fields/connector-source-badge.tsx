// apps/web/src/components/fields/connector-source-badge.tsx

'use client'

import type { RecordSourceChip } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'

interface ConnectorSourceBadgeProps {
  /**
   * App-origin identity chips from the `RecordIdentity` index (replaces the
   * retired `EntityInstance.integrationSource`). The badge renders the first
   * chip that resolves to an installed app; empty/unresolved → nothing.
   */
  sources: RecordSourceChip[] | null | undefined
  /** `icon` → bare logo (grid primary cell); `chip` → logo + name (drawer header). */
  variant: 'icon' | 'chip'
  className?: string
}

/**
 * Entity-level "Synced from <app>" indicator. Resolves the record's app-origin
 * identity chips (from the `RecordIdentity` index) to their installed app's
 * branding via `useAppsContext` — so the badge shows the real app logo + title.
 *
 * Complements the per-cell `ConnectorLockBadge` (field-grain provenance) with a
 * record-grain marker. Renders `null` when the record has no app identity or
 * the app isn't installed, so unmanaged rows pay nothing visually.
 */
export function ConnectorSourceBadge({ sources, variant, className }: ConnectorSourceBadgeProps) {
  const { appInstallations } = useAppsContext()

  const app = useMemo(() => {
    if (!sources?.length) return null
    for (const chip of sources) {
      const match = appInstallations.find(
        (i) => i.installationId === chip.appInstallationId || i.app.slug === chip.source
      )?.app
      if (match) return match
    }
    return null
  }, [sources, appInstallations])

  if (!app) return null

  const label = app.title || 'a connected app'
  const iconId = app.avatarUrl ?? 'plug'

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
