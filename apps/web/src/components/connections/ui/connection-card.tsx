// apps/web/src/components/connections/ui/connection-card.tsx
'use client'

import { Link2, Pencil, RefreshCw, Trash, TriangleAlert } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AppListCard, type AppListCardMenuItem } from '~/components/apps/ui/app-list-card'
import type { RouterOutputs } from '~/trpc/react'

/** A single connection row as projected by `connections.list`. */
export type ConnectionRow = RouterOutputs['connections']['list'][number]

interface ConnectionCardProps {
  connection: ConnectionRow
  /** Resolved visual-ref icon (app logo, provider lucide icon, or a fallback). */
  iconId: string
  /** Human provider/app label shown under the title. */
  subtitle: string
  /** Open the connection's edit dialog (rename + reconnect/key). Hidden when absent. */
  onAction?: () => void
  /** Label for the primary action — defaults to "Edit". */
  actionLabel?: string
  /** Remove the connection. */
  onDelete: () => void
}

/**
 * One connection rendered with the shared {@link AppListCard} — the same card the
 * apps/MCP grid uses. The three-dot menu carries Edit + Delete; clicking the card body
 * opens the edit dialog. See plans/connections/unify-connection-definition.md §15.
 */
export function ConnectionCard({
  connection,
  iconId,
  subtitle,
  onAction,
  actionLabel = 'Edit',
  onDelete,
}: ConnectionCardProps) {
  const title = connection.label ?? connection.name
  const expired = connection.status === 'expired'
  // A channel binds this credential — deleting it would orphan the channel, so delete is blocked.
  const usedByChannel = connection.usedByChannel
  const scopeLabel = connection.scope === 'user' ? 'Personal' : 'Workspace'
  const description = connection.createdBy?.name
    ? `${scopeLabel} · added by ${connection.createdBy.name}`
    : `${scopeLabel} connection`

  const menuItems: AppListCardMenuItem[] = []
  if (onAction) {
    menuItems.push({
      label: actionLabel,
      icon: actionLabel === 'Edit' ? <Pencil /> : <RefreshCw />,
      onClick: onAction,
    })
  }
  menuItems.push({
    label: usedByChannel ? 'In use by a channel' : 'Delete',
    icon: <Trash />,
    onClick: onDelete,
    destructive: true,
    disabled: Boolean(usedByChannel),
  })

  const badges = [
    ...(usedByChannel ? [{ label: 'In use', icon: <Link2 className='size-3' /> }] : []),
    ...(expired
      ? [{ label: 'Expired', icon: <TriangleAlert className='size-3 text-amber-600' /> }]
      : []),
  ]

  return (
    <AppListCard
      title={title}
      subtitle={subtitle}
      description={description}
      icon={<AppIcon iconId={iconId} size='sm' />}
      badges={badges.length > 0 ? badges : undefined}
      onClick={onAction}
      menuItems={menuItems}
    />
  )
}
