// apps/web/src/components/groups/ui/group-item.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import type { GroupMember } from '@auxx/types/groups'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { MoreVertical, Lock } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { getGroupMetadata, getMemberDisplayInfo, getInitials } from '../utils'

/** Props for GroupItem component */
interface GroupItemProps {
  /** The group EntityInstance */
  group: EntityInstanceEntity
  /** Members to display in avatars */
  members?: GroupMember[]
  /** Called when group is clicked */
  onSelect?: (groupId: string) => void
  /** Called when edit is clicked */
  onEdit?: (groupId: string) => void
  /** Called when delete is clicked */
  onDelete?: (groupId: string) => void
}

/**
 * Single group row display component
 * Preserves existing UI design with emoji, name, member count, and avatars
 */
export function GroupItem({ group, members = [], onSelect, onEdit, onDelete }: GroupItemProps) {
  const metadata = getGroupMetadata(group)
  const emoji = metadata.icon || '👥'
  const memberCount = metadata.memberCount ?? 0

  return (
    <div
      className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer"
      onClick={() => onSelect?.(group.id)}>
      <div className="flex flex-row items-center gap-3">
        <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
          {emoji}
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{group.displayName}</span>
            {metadata.visibility === 'private' && <Lock className="h-3 w-3 text-muted-foreground" />}
          </div>
          <span className="text-xs text-muted-foreground">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {members.slice(0, 4).map((member) => {
            const display = getMemberDisplayInfo(member)
            return (
              <Tooltip key={member.id} content={display.name}>
                <Avatar className="border-2 border-background size-8">
                  <AvatarImage src={display.image || undefined} alt={display.name} />
                  <AvatarFallback className="text-sm">{getInitials(display.name)}</AvatarFallback>
                </Avatar>
              </Tooltip>
            )
          })}
          {memberCount > 4 && (
            <Tooltip content={`${memberCount - 4} more members`}>
              <Avatar className="border-2 border-background bg-muted">
                <AvatarFallback>+{memberCount - 4}</AvatarFallback>
              </Avatar>
            </Tooltip>
          )}
        </div>

        {(onEdit || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit(group.id)
                  }}>
                  Edit Group
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(group.id)
                    }}>
                    Delete Group
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
