// apps/web/src/components/fields/connector-source-badge.tsx

'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
import type { RecordSourceChip } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { type MouseEvent, useMemo } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { useExternalLink } from '~/components/fields/use-external-link'
import { Tooltip } from '~/components/global/tooltip'
import { VisualIcon } from '~/components/icons/ui/visual-icon'

interface ConnectorSourceBadgeProps {
  /**
   * App-origin identity chips from the `RecordIdentity` index (replaces the
   * retired `EntityInstance.integrationSource`). The badge renders the first
   * chip that resolves to an installed app; empty/unresolved → nothing.
   */
  sources: RecordSourceChip[] | null | undefined
  /** The record the chips belong to — resolves the external link on click. */
  recordId: RecordId
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
 * the app isn't installed, so unmanaged rows pay nothing visually. When the
 * chosen chip is `linkable` the badge becomes an "Open in <app>" button.
 */
export function ConnectorSourceBadge({
  sources,
  recordId,
  variant,
  className,
}: ConnectorSourceBadgeProps) {
  const { appInstallations } = useAppsContext()
  const { open, prefetch } = useExternalLink(recordId)

  const resolved = useMemo(() => {
    if (!sources?.length) return null
    type App = (typeof appInstallations)[number]['app']
    let fallback: { chip: RecordSourceChip; app: App } | null = null
    for (const chip of sources) {
      const app = appInstallations.find(
        (i) => i.installationId === chip.appInstallationId || i.app.slug === chip.source
      )?.app
      if (!app) continue
      // A linkable chip wins over an earlier unlinked one from another app.
      if (chip.linkable) return { chip, app }
      fallback ??= { chip, app }
    }
    return fallback
  }, [sources, appInstallations])

  if (!resolved) return null

  const { chip, app } = resolved
  const label = app.title || 'a connected app'
  const iconId = app.avatarUrl ?? 'plug'
  const linkable = chip.linkable === true
  const tooltip = linkable ? `Open in ${label}` : `Synced from ${label}`

  const icon = (
    <VisualIcon
      value={iconId}
      fallbackIconId='plug'
      fit='contain'
      size='xs'
      className={variant === 'icon' ? className : undefined}
    />
  )
  const body =
    variant === 'icon' ? (
      icon
    ) : (
      <Badge variant='gray' size='sm' className={cn('gap-1', className)}>
        {icon}
        {label}
      </Badge>
    )

  if (!linkable) {
    return (
      <Tooltip content={tooltip} side='top'>
        {body}
      </Tooltip>
    )
  }

  // The row underneath opens the record on click; this one opens the app.
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    void open(chip.source, chip.connectionId)
  }
  const handlePrefetch = () => prefetch(chip.source, chip.connectionId)

  return (
    <Tooltip content={tooltip} side='top'>
      <button
        type='button'
        aria-label={tooltip}
        className='inline-flex shrink-0 cursor-pointer items-center'
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={handlePrefetch}
        onFocus={handlePrefetch}>
        {body}
      </button>
    </Tooltip>
  )
}
