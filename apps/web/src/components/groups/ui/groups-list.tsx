// apps/web/src/components/groups/ui/groups-list.tsx
'use client'

import type { EntityInstanceEntity } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { PlusCircle, Users } from 'lucide-react'
import { useState } from 'react'
import { GroupItem } from './group-item'

/** Props for GroupsList component */
interface GroupsListProps {
  /** List of groups to display */
  groups: EntityInstanceEntity[]
  /** Whether data is loading */
  isLoading?: boolean
  /** Called when a group is selected */
  onSelect?: (groupId: string) => void
  /** Called when edit is clicked */
  onEdit?: (groupId: string) => void
  /** Called when create is clicked */
  onCreate?: () => void
  /** Called when delete is clicked */
  onDelete?: (groupId: string) => void
}

/**
 * List of groups with search and actions
 * Preserves existing UI design
 */
export function GroupsList({
  groups,
  isLoading = false,
  onSelect,
  onEdit,
  onCreate,
  onDelete,
}: GroupsListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredGroups = searchQuery
    ? groups.filter((group) => group.displayName?.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups

  return (
    <div className='space-y-4 flex-1 min-h-0 flex flex-col'>
      <div className='flex items-center'>
        <div className='relative flex-1'>
          <InputSearch
            placeholder='Search groups...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className='max-width-[200px] ml-4'>
          <Button variant='outline' size='sm' onClick={onCreate}>
            <PlusCircle />
            Create Group
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className='space-y-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='flex items-center justify-between rounded-2xl border py-2 px-3'>
              <div className='flex flex-row items-center gap-3'>
                <Skeleton className='size-8 rounded-lg shrink-0' />
                <div className='flex flex-col gap-1'>
                  <Skeleton className='h-4 w-28' />
                  <Skeleton className='h-3 w-16' />
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <div className='flex -space-x-2'>
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className='h-8 w-8 rounded-full border-2 border-background' />
                  ))}
                </div>
                <Skeleton className='h-7 w-7 rounded' />
              </div>
            </div>
          ))}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className='flex-1 flex flex-col items-center justify-center py-8'>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
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
        <div className='space-y-3'>
          {filteredGroups.map((group) => (
            <GroupItem
              key={group.id}
              group={group}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
