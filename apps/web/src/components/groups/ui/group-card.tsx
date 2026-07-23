// apps/web/src/components/groups/ui/group-card.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import type { GroupMember } from '@auxx/types/groups'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { ListCard } from '@auxx/ui/components/list-card'
import { SimpleTooltip as Tooltip } from '@auxx/ui/components/tooltip'
import { Lock } from 'lucide-react'
import {
  useBulkMode,
  useIsPending,
  useIsSelected,
  useListSelection,
  usePendingLabel,
} from '~/components/list-selection'
import { getGroupMetadata, getInitials, getMemberDisplayInfo } from '../utils'

interface GroupCardProps {
  group: EntityInstanceEntity
  /** Members to display as an avatar stack (optional). */
  members?: GroupMember[]
  /** Open the group detail page — fired on row click when not bulk-selecting. */
  onSelect?: (groupId: string) => void
  onDelete?: (groupId: string) => void
}

/** One row in the Groups tab — emoji, name, member count, avatar stack, menu. */
export function GroupCard({ group, members = [], onSelect, onDelete }: GroupCardProps) {
  const metadata = getGroupMetadata(group)
  const emoji = metadata.icon || '👥'
  const memberCount = metadata.memberCount ?? 0

  const bulkMode = useBulkMode()
  const selected = useIsSelected(group.id)
  const pending = useIsPending(group.id)
  const pendingLabel = usePendingLabel()
  const toggle = useListSelection((s) => s.toggle)

  const trailing =
    members.length > 0 ? (
      <div className='flex -space-x-2'>
        {members.slice(0, 4).map((member) => {
          const display = getMemberDisplayInfo(member)
          return (
            <Tooltip key={member.id} content={display.name}>
              <Avatar className='size-7 border-2 border-background'>
                <AvatarImage src={display.image || undefined} alt={display.name} />
                <AvatarFallback className='text-xs'>{getInitials(display.name)}</AvatarFallback>
              </Avatar>
            </Tooltip>
          )
        })}
        {memberCount > 4 && (
          <Tooltip content={`${memberCount - 4} more members`}>
            <Avatar className='size-7 border-2 border-background bg-muted'>
              <AvatarFallback className='text-xs'>+{memberCount - 4}</AvatarFallback>
            </Avatar>
          </Tooltip>
        )}
      </div>
    ) : undefined

  const menuItems = onDelete
    ? [{ label: 'Delete Group', destructive: true, onClick: () => onDelete(group.id) }]
    : undefined

  return (
    <ListCard
      layout='row'
      icon={<span className='text-base leading-none'>{emoji}</span>}
      title={group.displayName}
      badges={
        metadata.visibility === 'private' ? (
          <Lock className='size-3 text-muted-foreground' />
        ) : undefined
      }
      subtitle={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}
      trailing={trailing}
      menuItems={menuItems}
      selectable
      selecting={bulkMode}
      selected={selected}
      onSelectChange={(_, e) => toggle(group.id, { shiftKey: e.shiftKey })}
      pending={pending}
      pendingLabel={pendingLabel}
      onClick={() => onSelect?.(group.id)}
      ariaLabel={group.displayName ?? 'Group'}
    />
  )
}
