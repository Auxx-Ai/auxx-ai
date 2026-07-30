// apps/web/src/components/inbox/ui/inbox-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ListCard, type ListCardMenuItem, type ListCardStatus } from '@auxx/ui/components/list-card'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import type { RouterOutputs } from '~/trpc/react'

const DETAIL_BASE = '/app/settings/inbox'

/** Scoped inbox row returned by `inbox.settingsList`. */
export type SettingsInboxItem = RouterOutputs['inbox']['settingsList'][number]

/** Corner status dot (tone + tooltip) from the inbox status field. */
function inboxStatus(status: SettingsInboxItem['status']): ListCardStatus {
  switch (status) {
    case 'ACTIVE':
      return { tone: 'good', label: 'Active' }
    case 'PAUSED':
      return { tone: 'warning', label: 'Paused' }
    case 'ARCHIVED':
      return { tone: 'muted', label: 'Archived' }
    default:
      return { tone: 'muted', label: status ?? 'Unknown' }
  }
}

/** Access label from the org-wide floor lens. */
function getAccessDisplay(defaultLens: SettingsInboxItem['defaultLens']): string {
  switch (defaultLens) {
    case 'none':
      return 'Restricted'
    case 'identity':
      return 'Subject only'
    case 'metadata':
      return 'Activity only'
    default:
      return 'All members'
  }
}

interface InboxCardProps {
  inbox: SettingsInboxItem
  /** Entity-def icon/color fallbacks from `useResource('inbox')`. */
  resourceIcon?: string
  resourceColor?: string
  onEdit: (inbox: SettingsInboxItem) => void
  onDelete: (inbox: SettingsInboxItem) => void
  deletePending?: boolean
}

/**
 * One inbox tile: record icon, name + type subtitle, a status dot, and an access
 * badge in the footer. The three-dot menu carries Edit and Delete; the body links
 * to the inbox detail route.
 */
export function InboxCard({
  inbox,
  resourceIcon,
  resourceColor,
  onEdit,
  onDelete,
  deletePending,
}: InboxCardProps) {
  const menuItems: ListCardMenuItem[] = []
  if (inbox.canManage) {
    menuItems.push({
      label: 'Edit',
      icon: <PencilIcon />,
      onClick: () => onEdit(inbox),
    })
  }
  if (inbox.canDelete) {
    menuItems.push({
      label: 'Delete',
      icon: <Trash2Icon />,
      destructive: true,
      disabled: deletePending,
      onClick: () => onDelete(inbox),
    })
  }

  return (
    <ListCard
      media={
        <RecordIcon iconId={resourceIcon ?? 'inbox'} color={resourceColor ?? 'gray'} size='lg' />
      }
      title={inbox.name}
      subtitle={inbox.isPersonal ? 'Personal inbox' : 'Shared inbox'}
      status={inboxStatus(inbox.status)}
      description={inbox.description ?? undefined}
      descriptionLines={2}
      badges={
        <Badge variant='gray'>
          {inbox.isPersonal ? 'Personal' : getAccessDisplay(inbox.defaultLens)}
        </Badge>
      }
      href={`${DETAIL_BASE}/${inbox.id}`}
      menuItems={menuItems.length > 0 ? menuItems : undefined}
    />
  )
}
