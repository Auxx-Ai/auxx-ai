'use client'
// /app/(protected)/app/settings/groups/_components/groups-list.tsx
import { useState } from 'react'
import { api } from '~/trpc/react'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { InputSearch } from '@auxx/ui/components/input-search'
import { MoreVertical, PlusCircle, Users } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@auxx/ui/components/empty'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'
interface GroupsListProps {
  onGroupSelect?: (groupId: string) => void
  onEditGroup?: (groupId: string) => void
  onCreateGroup?: () => void
  onDeleteGroup?: (groupId: string) => void
  selectedGroupId?: string
}

export function GroupsList({
  onGroupSelect,
  onEditGroup,
  onCreateGroup,
  onDeleteGroup,
  selectedGroupId,
}: GroupsListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const { data, isLoading } = api.group.all.useQuery()
  const groups = data?.groups || []

  const filteredGroups = searchQuery
    ? groups.filter((group) => group.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <div className="relative flex-1">
          <InputSearch
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="max-width-[200px] ml-4">
          <Button variant="outline" size="sm" onClick={onCreateGroup}>
            <PlusCircle />
            Create Group
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          // Loading skeletons
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl border py-2 px-3">
              <div className="flex flex-row items-center gap-3">
                <Skeleton className="size-8 rounded-lg shrink-0" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-8 w-8 rounded-full border-2 border-background" />
                  ))}
                </div>
                <Skeleton className="h-7 w-7 rounded" />
              </div>
            </div>
          ))
        ) : filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No groups found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery
                    ? 'Try adjusting your search terms'
                    : 'Create your first group to organize your team'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          // Group cards
          filteredGroups.map((group) => {
            const properties = (group.properties as Record<string, any>) || {}
            const emoji = properties.emoji || '👥'
            const color = properties.color || '#4f46e5'
            const memberCount = group._count?.members || 0
            const members = group.members || []

            return (
              <div
                key={group.id}
                className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200"
                onClick={() => onGroupSelect?.(group.id)}>
                <div className="flex flex-row items-center gap-3">
                  <div className="size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0">
                    {emoji}
                  </div>

                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{group.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {memberCount} {memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {members.slice(0, 4).map((member) => (
                      <Tooltip key={member.id} content={member.user.name || member.user.email}>
                        <Avatar className="border-2 border-background size-8">
                          <AvatarImage
                            src={member.user.image || undefined}
                            alt={member.user.name || ''}
                          />
                          <AvatarFallback className="text-sm">
                            {getInitials(member.user.name || 'User')}
                          </AvatarFallback>
                        </Avatar>
                      </Tooltip>
                    ))}
                    {memberCount > 4 && (
                      <Tooltip content={`${memberCount - 4} more members`}>
                        <Avatar className="border-2 border-background bg-muted">
                          <AvatarFallback>+{memberCount - 4}</AvatarFallback>
                        </Avatar>
                      </Tooltip>
                    )}
                  </div>

                  {(onEditGroup || onDeleteGroup) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon-sm">
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onEditGroup && (
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              onEditGroup(group.id)
                            }}>
                            Edit Group
                          </DropdownMenuItem>
                        )}
                        {onDeleteGroup && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteGroup(group.id)
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
          })
        )}
      </div>
    </div>
  )
}
