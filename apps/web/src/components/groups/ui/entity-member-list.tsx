// apps/web/src/components/groups/ui/entity-member-list.tsx
'use client'

import { MemberType } from '@auxx/lib/groups/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Database, MoreVertical, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useGroupMembers, useGroupMutations } from '../hooks'

/** Props for EntityMemberList component */
interface EntityMemberListProps {
  /** Group ID */
  groupId: string
  /** Optional entity type filter */
  entityType?: string
  /** Whether user can manage members */
  canManage: boolean
}

/**
 * Entity members table component
 * Displays and manages entity (record) members of a group
 */
export function EntityMemberList({ groupId, entityType, canManage }: EntityMemberListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: members, isLoading, refetch } = useGroupMembers(groupId)
  const { removeMembers } = useGroupMutations()

  // Filter to only entity members
  const entityMembers = (members ?? []).filter(
    (m) => m.memberType === MemberType.entity && m.entity
  )

  /** Handle removing a member */
  const handleRemoveMember = async (entityId: string) => {
    const confirmed = await confirm({
      title: 'Remove Record?',
      description: 'Are you sure you want to remove this record from the group?',
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await removeMembers.mutateAsync({
          groupId,
          members: [{ type: MemberType.entity, id: entityId }],
        })
        toastSuccess({ title: 'Record removed from group' })
        refetch()
      } catch (error) {
        toastError({
          title: 'Error removing record',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  return (
    <div className='space-y-4'>
      {canManage && (
        <InputGroup>
          <InputGroupAddon align='inline-start'>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder='Search records...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton
              className='rounded-lg'
              variant='outline'
              size='xs'
              onClick={(e) => {
                e.preventDefault()
                // TODO: Open entity picker dialog
                toastError({ title: 'Entity picker not yet implemented' })
              }}>
              <Plus />
              Add Records
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}

      <div className='rounded-2xl border bg-card'>
        {isLoading ? (
          <div className='space-y-4 p-4'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='flex items-center space-x-4'>
                <Skeleton className='h-10 w-10 rounded' />
                <div className='space-y-2'>
                  <Skeleton className='h-4 w-40' />
                  <Skeleton className='h-3 w-28' />
                </div>
              </div>
            ))}
          </div>
        ) : entityMembers.length === 0 ? (
          <div className='py-8 text-center'>
            <Database className='mx-auto h-10 w-10 text-muted-foreground' />
            <p className='mt-2 text-muted-foreground'>No records in this group</p>
            {canManage && (
              <Button
                variant='outline'
                className='mt-4'
                onClick={(e) => {
                  e.preventDefault()
                  // TODO: Open entity picker dialog
                  toastError({ title: 'Entity picker not yet implemented' })
                }}>
                <Plus />
                Add Records
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className='hidden md:table-cell'>Type</TableHead>
                {canManage && <TableHead className='w-12'></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entityMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className='font-medium'>
                    {member.entity?.displayName || 'Unnamed Record'}
                  </TableCell>
                  <TableCell className='hidden md:table-cell text-muted-foreground'>
                    {member.entity?.entityDefinitionId || 'Unknown'}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='icon'>
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => handleRemoveMember(member.memberRefId)}>
                            Remove from Group
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ConfirmDialog />
    </div>
  )
}
