// apps/web/src/components/inbox/ui/inbox-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { ListCard, type ListCardMenuItem, type ListCardStatus } from '@auxx/ui/components/list-card'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import type { InboxItem, InboxRecord } from '~/components/threads/hooks/use-inbox'

const DETAIL_BASE = '/app/settings/inbox'

/** Corner status dot (tone + tooltip) from the inbox status field. */
function inboxStatus(status: InboxItem['status']): ListCardStatus {
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
function getAccessDisplay(defaultLens: InboxItem['defaultLens']): string {
  switch (defaultLens) {
    case 'none':
      return 'Restricted'
    case 'subject':
      return 'Subject only'
    case 'metadata':
      return 'Activity only'
    default:
      return 'All members'
  }
}

interface InboxCardProps {
  inbox: InboxItem
  /** Raw record for the avatar (falls back to the entity-def icon/color). */
  record?: InboxRecord
  /** Entity-def icon/color fallbacks from `useResource('inbox')`. */
  resourceIcon?: string
  resourceColor?: string
  onEdit: (inbox: InboxItem) => void
  onDelete: (inbox: InboxItem) => void
  deletePending?: boolean
}

/**
 * One inbox tile: record icon, name + type subtitle, a status dot, and an access
 * badge in the footer. The three-dot menu carries Edit and Delete; the body links
 * to the inbox detail route.
 */
export function InboxCard({
  inbox,
  record,
  resourceIcon,
  resourceColor,
  onEdit,
  onDelete,
  deletePending,
}: InboxCardProps) {
  const menuItems: ListCardMenuItem[] = [
    {
      label: 'Edit',
      icon: <PencilIcon />,
      onClick: () => onEdit(inbox),
    },
    {
      label: 'Delete',
      icon: <Trash2Icon />,
      destructive: true,
      disabled: deletePending,
      onClick: () => onDelete(inbox),
    },
  ]

  return (
    <ListCard
      media={
        <RecordIcon
          avatarUrl={record?.avatarUrl}
          iconId={resourceIcon ?? 'inbox'}
          color={resourceColor ?? 'gray'}
          size='lg'
        />
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
      menuItems={menuItems}
    />
  )
}
