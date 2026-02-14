'use client'
import { SnippetSharingType as SnippetSharingTypeEnum } from '@auxx/database/enums'
import type { SnippetSharingType } from '@auxx/database/types'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { PlusIcon, SearchIcon, Trash, UserIcon, Users2Icon, UsersIcon } from 'lucide-react'
// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-sharing.tsx
import React from 'react'
import { api } from '~/trpc/react'

interface ShareItem {
  id: string
  type: 'group' | 'member'
  name: string
  permission: 'VIEW' | 'EDIT'
  icon?: string
}
interface SnippetSharingProps {
  snippetId?: string
  initialSharingType: SnippetSharingType
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (
    sharingType: SnippetSharingType,
    shares?: Array<{
      granteeType: 'group' | 'user'
      granteeId: string
      permission: 'VIEW' | 'EDIT'
    }>
  ) => void
}
export function SnippetSharing({
  snippetId,
  initialSharingType,
  open,
  onOpenChange,
  onSave,
}: SnippetSharingProps) {
  const [sharingType, setSharingType] = React.useState<SnippetSharingType>(initialSharingType)
  const [selectedItems, setSelectedItems] = React.useState<ShareItem[]>([])
  const [memberSearchTerm, setMemberSearchTerm] = React.useState('')
  const [groupSearchTerm, setGroupSearchTerm] = React.useState('')
  // Fetch groups (using new entityGroup API)
  const { data: groupsData } = api.entityGroup.list.useQuery()
  // Fetch members
  const { data: membersData } = api.member.all.useQuery({})
  // Fetch existing snippet shares if editing
  const { data: snippetData } = api.snippet.byId.useQuery(
    { id: snippetId || '' },
    { enabled: !!snippetId }
  )

  // Initialize state when snippet data loads
  React.useEffect(() => {
    if (!snippetData?.snippet) return

    const { snippet } = snippetData
    setSharingType(snippet.sharingType as SnippetSharingType)

    if (!snippet.shares || snippet.shares.length === 0) {
      setSelectedItems([])
      return
    }

    // Map ResourceAccessInfo to ShareItem using groupsData and membersData
    const shareItems: ShareItem[] = []

    for (const share of snippet.shares) {
      // Permission is lowercase in ResourceAccess ('view'/'edit'), uppercase in UI
      const permission = share.permission.toUpperCase() as 'VIEW' | 'EDIT'

      if (share.granteeType === 'group') {
        const group = groupsData?.find((g) => g.id === share.granteeId)
        if (group) {
          shareItems.push({
            id: share.granteeId,
            type: 'group',
            name: group.displayName || 'Group',
            permission,
          })
        }
      } else if (share.granteeType === 'user') {
        const member = membersData?.members?.find(
          (m) => m.userId === share.granteeId || m.id === share.granteeId
        )
        if (member) {
          shareItems.push({
            id: member.id,
            type: 'member',
            name: member.user.name || member.user.email || 'Unknown',
            permission,
            icon: member.user.image || undefined,
          })
        }
      }
    }

    setSelectedItems(shareItems)
  }, [snippetData, groupsData, membersData?.members])

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSelectedItems([])
      setMemberSearchTerm('')
      setGroupSearchTerm('')
    }
  }, [open])

  const filteredGroups = React.useMemo(() => {
    if (!groupsData) return []
    return groupsData.filter(
      (group) =>
        !selectedItems.some((item) => item.type === 'group' && item.id === group.id) &&
        (groupSearchTerm
          ? group.displayName?.toLowerCase().includes(groupSearchTerm.toLowerCase())
          : true)
    )
  }, [groupsData, selectedItems, groupSearchTerm])
  // Filter members
  const filteredMembers = React.useMemo(() => {
    if (!membersData?.members) return []
    return membersData.members.filter(
      (member) =>
        !selectedItems.some((item) => item.type === 'member' && item.id === member.id) &&
        (memberSearchTerm
          ? member.user.name?.toLowerCase().includes(memberSearchTerm.toLowerCase()) ||
            member.user.email?.toLowerCase().includes(memberSearchTerm.toLowerCase())
          : true)
    )
  }, [membersData?.members, selectedItems, memberSearchTerm])
  // Add group to selection
  const addGroup = (group: (typeof groupsData)[0]) => {
    const metadata = (group.metadata as { memberCount?: number }) || {}
    setSelectedItems([
      ...selectedItems,
      { id: group.id, type: 'group', name: group.displayName || 'Group', permission: 'VIEW' },
    ])
  }
  // Add member to selection
  const addMember = (member: (typeof membersData.members)[0]) => {
    setSelectedItems([
      ...selectedItems,
      {
        id: member.id,
        type: 'member',
        name: member.user.name || member.user.email || 'Unknown',
        permission: 'VIEW',
        icon: member.user.image || undefined,
      },
    ])
  }
  // Remove item from selection
  const removeItem = (id: string) => {
    setSelectedItems(selectedItems.filter((item) => item.id !== id))
  }
  // Update item permission
  const updateItemPermission = (id: string, permission: 'VIEW' | 'EDIT') => {
    setSelectedItems(selectedItems.map((item) => (item.id === id ? { ...item, permission } : item)))
  }
  // Handle save
  const handleSave = () => {
    let shares
    if (sharingType === SnippetSharingTypeEnum.GROUPS) {
      shares = selectedItems.map((item) => ({
        granteeType: item.type === 'group' ? ('group' as const) : ('user' as const),
        granteeId: item.id,
        permission: item.permission,
      }))
    }
    onSave(sharingType, shares)
  }

  // Compute disabled state for submit
  const isSubmitDisabled =
    sharingType === SnippetSharingTypeEnum.GROUPS && selectedItems.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh]' size='md' position='tc'>
        <DialogHeader className='mb-4'>
          <DialogTitle>Snippet Sharing Settings</DialogTitle>
          <DialogDescription>Control who can view and edit this snippet</DialogDescription>
        </DialogHeader>

        <div className='flex-1 space-y-6 overflow-auto px-1'>
          {/* Sharing Type Selection */}
          <div className='space-y-2 flex flex-col'>
            <label className='text-sm font-medium'>Sharing Type</label>
            <RadioGroup
              value={sharingType}
              onValueChange={(value) => setSharingType(value as SnippetSharingType)}
              className='grid gap-2 sm:grid-cols-2'>
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.PRIVATE}
                label='Private'
                icon={<UserIcon />}
                description='Only you can access'
              />
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.ORGANIZATION}
                label='Organization'
                icon={<UsersIcon />}
                description='Everyone in organization can access'
              />
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.GROUPS}
                label='Custom'
                icon={<Users2Icon />}
                description='Share with specific groups and members'
              />
            </RadioGroup>
          </div>

          {/* Custom sharing - Groups and Members selection */}
          {sharingType === SnippetSharingTypeEnum.GROUPS && (
            <div className='space-y-4'>
              {/* Selected items */}
              <div>
                <label className='text-sm font-medium'>Selected Groups & Members</label>
                {selectedItems.length === 0 ? (
                  <div className='mt-2 text-sm text-gray-500'>No groups or members selected</div>
                ) : (
                  <div className='mt-2 space-y-2'>
                    {selectedItems.map((item) => (
                      <div
                        key={item.id}
                        className='flex items-center justify-between rounded-2xl border p-1'>
                        <div className='flex items-center'>
                          {item.type === 'group' ? (
                            <Users2Icon size={18} className='mr-2' />
                          ) : (
                            <Avatar className='mr-2 size-8 border'>
                              <AvatarImage src={item.icon} />
                              <AvatarFallback>{item.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                          )}
                          <span className='text-sm'>{item.name}</span>
                          <Badge variant='outline' className='ml-2 px-1 text-xs'>
                            {item.type === 'group' ? 'Group' : 'Member'}
                          </Badge>
                        </div>
                        <div className='flex items-center space-x-2'>
                          <Select
                            defaultValue={item.permission}
                            onValueChange={(value) =>
                              updateItemPermission(item.id, value as 'VIEW' | 'EDIT')
                            }>
                            <SelectTrigger size='sm' className=' w-24'>
                              <SelectValue placeholder='Permission' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='VIEW'>Can View</SelectItem>
                              <SelectItem value='EDIT'>Can Edit</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant='destructive-hover'
                            size='icon'
                            className='rounded-full'
                            onClick={() => removeItem(item.id)}>
                            <Trash />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Groups section */}
              <div className='space-y-2'>
                <label className='text-sm font-medium'>Add Groups</label>
                <div className='relative'>
                  <SearchIcon
                    size={16}
                    className='absolute left-3 top-1/2 -translate-y-1/2 transform text-gray-400'
                  />
                  <Input
                    placeholder='Search groups...'
                    value={groupSearchTerm}
                    onChange={(e) => setGroupSearchTerm(e.target.value)}
                    className='pl-9'
                  />
                </div>

                <div className='max-h-40 space-y-2 overflow-y-auto'>
                  {filteredGroups.length === 0 ? (
                    <div className='py-4 text-center text-gray-500 text-sm'>
                      {groupSearchTerm
                        ? 'No groups match your search'
                        : 'No available groups to add'}
                    </div>
                  ) : (
                    filteredGroups.map((group) => {
                      const metadata = (group.metadata as { memberCount?: number }) || {}
                      const memberCount = metadata.memberCount ?? 0
                      return (
                        <div
                          key={group.id}
                          className='flex cursor-pointer items-center justify-between rounded-2xl border p-1 hover:bg-gray-50 dark:hover:bg-gray-800'
                          onClick={() => addGroup(group)}>
                          <div className='flex items-center'>
                            <Users2Icon size={18} className='mr-2' />
                            <div className='flex flex-row gap-2'>
                              <div className='text-sm'>{group.displayName}</div>
                              <div className='text-xs text-gray-500'>
                                {memberCount} member{memberCount !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <Button variant='ghost' size='icon' className='rounded-full'>
                            <PlusIcon />
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Members section */}
              <div className='space-y-2'>
                <label className='text-sm font-medium'>Add Members</label>
                <div className='relative'>
                  <SearchIcon
                    size={16}
                    className='absolute left-3 top-1/2 -translate-y-1/2 transform text-gray-400'
                  />
                  <Input
                    placeholder='Search members...'
                    value={memberSearchTerm}
                    onChange={(e) => setMemberSearchTerm(e.target.value)}
                    className='pl-9'
                  />
                </div>

                <div className='max-h-40 space-y-2 overflow-y-auto'>
                  {filteredMembers.length === 0 ? (
                    <div className='py-4 text-center text-gray-500 text-sm'>
                      {memberSearchTerm
                        ? 'No members match your search'
                        : 'No available members to add'}
                    </div>
                  ) : (
                    filteredMembers.map((member) => (
                      <div
                        key={member.id}
                        className='flex cursor-pointer items-center justify-between rounded-2xl border p-1 hover:bg-gray-50 dark:hover:bg-gray-800'
                        onClick={() => addMember(member)}>
                        <div className='flex items-center'>
                          <Avatar className='mr-2 size-8 border'>
                            <AvatarImage src={member.user.image || undefined} />
                            <AvatarFallback>
                              {member.user.name?.charAt(0) || member.user.email?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className='flex flex-row gap-2'>
                            <div className='text-sm'>{member.user.name || member.user.email}</div>
                            <Badge variant='outline' className='px-1 text-xs'>
                              {member.role}
                            </Badge>
                          </div>
                        </div>
                        <Button variant='ghost' size='icon' className='rounded-full'>
                          <PlusIcon size={16} />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSave}
            variant='outline'
            size='sm'
            disabled={isSubmitDisabled}
            data-dialog-submit>
            Save Sharing Settings <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
