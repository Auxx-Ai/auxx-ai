'use client'
// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-sharing.tsx
import React from 'react'
import { UserIcon, UsersIcon, Users2Icon, PlusIcon, XIcon, SearchIcon, Trash } from 'lucide-react'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { SnippetSharingType as SnippetSharingTypeEnum } from '@auxx/database/enums'
import { type SnippetSharingType } from '@auxx/database/types'

import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
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
      groupId?: string
      memberId?: string
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
  // Fetch groups
  const { data: groupsData } = api.group.all.useQuery()
  // Fetch members
  const { data: membersData } = api.organization.allMembers.useQuery({})
  // Fetch existing snippet shares if editing
  const { data: snippetData, isLoading: isLoadingSnippet } = api.snippet.byId.useQuery(
    { id: snippetId || '' },
    {
      enabled: !!snippetId,
      onSuccess: (data) => {
        // Initialize selected items from existing shares
        if (data?.snippet?.shares) {
          const shareItems: ShareItem[] = []
          data.snippet.shares.forEach((share) => {
            if (share.group) {
              shareItems.push({
                id: share.group.id,
                type: 'group',
                name: share.group.name,
                permission: share.permission as 'VIEW' | 'EDIT',
              })
            } else if (share.member?.user) {
              shareItems.push({
                id: share.member.id,
                type: 'member',
                name: share.member.user.name || share.member.user.email || 'Unknown',
                permission: share.permission as 'VIEW' | 'EDIT',
                icon: share.member.user.image || undefined,
              })
            }
          })
          setSelectedItems(shareItems)
          setSharingType(data.snippet.sharingType as SnippetSharingType)
        }
      },
    }
  )
  // Filter groups
  const filteredGroups = React.useMemo(() => {
    if (!groupsData?.groups) return []
    return groupsData.groups.filter(
      (group) =>
        !selectedItems.some((item) => item.type === 'group' && item.id === group.id) &&
        (groupSearchTerm ? group.name.toLowerCase().includes(groupSearchTerm.toLowerCase()) : true)
    )
  }, [groupsData?.groups, selectedItems, groupSearchTerm])
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
  const addGroup = (group: (typeof groupsData.groups)[0]) => {
    setSelectedItems([
      ...selectedItems,
      { id: group.id, type: 'group', name: group.name, permission: 'VIEW' },
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
    if (
      sharingType === SnippetSharingTypeEnum.GROUPS ||
      sharingType === SnippetSharingTypeEnum.MEMBERS
    ) {
      shares = selectedItems.map((item) => ({
        [item.type === 'group' ? 'groupId' : 'memberId']: item.id,
        permission: item.permission,
      }))
    }
    onSave(sharingType, shares)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh]" size="md" position="tc">
        <DialogHeader className="mb-4">
          <DialogTitle>Snippet Sharing Settings</DialogTitle>
          <DialogDescription>Control who can view and edit this snippet</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-auto px-1">
          {/* Sharing Type Selection */}
          <div className="space-y-2 flex flex-col">
            <label className="text-sm font-medium">Sharing Type</label>
            <RadioGroup
              value={sharingType}
              onValueChange={(value) => setSharingType(value as SnippetSharingType)}
              className="grid gap-2 sm:grid-cols-2">
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.PRIVATE}
                label="Private"
                icon={<UserIcon />}
                description="Only you can access"
              />
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.ORGANIZATION}
                label="Organization"
                icon={<UsersIcon />}
                description="Everyone in organization can access"
              />
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.GROUPS}
                label="Groups"
                icon={<Users2Icon />}
                description="Share with specific groups"
              />
              <RadioGroupItemCard
                value={SnippetSharingTypeEnum.MEMBERS}
                label="Members"
                icon={<UserIcon />}
                description="Share with specific members"
              />
            </RadioGroup>
          </div>

          {/* Group or Member selection */}
          {(sharingType === SnippetSharingTypeEnum.GROUPS ||
            sharingType === SnippetSharingTypeEnum.MEMBERS) && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">
                  {sharingType === SnippetSharingTypeEnum.GROUPS
                    ? 'Selected Groups'
                    : 'Selected Members'}
                </label>
                {selectedItems.length === 0 ? (
                  <div className="mt-2 text-sm text-gray-500">
                    No {sharingType === SnippetSharingTypeEnum.GROUPS ? 'groups' : 'members'}{' '}
                    selected
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-2xl border p-1">
                        <div className="flex items-center">
                          {item.type === 'group' ? (
                            <Users2Icon size={18} className="mr-2" />
                          ) : (
                            <Avatar className="mr-2 size-8 border">
                              <AvatarImage src={item.icon} />
                              <AvatarFallback>{item.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                          )}
                          <span className="text-sm">{item.name}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Select
                            defaultValue={item.permission}
                            onValueChange={(value) =>
                              updateItemPermission(item.id, value as 'VIEW' | 'EDIT')
                            }>
                            <SelectTrigger size="sm" className=" w-24">
                              <SelectValue placeholder="Permission" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="VIEW">Can View</SelectItem>
                              <SelectItem value="EDIT">Can Edit</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="destructive-hover"
                            size="icon"
                            className="rounded-full"
                            onClick={() => removeItem(item.id)}>
                            <Trash />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {sharingType === SnippetSharingTypeEnum.GROUPS && (
                <div className="space-y-4">
                  <div className="relative">
                    <SearchIcon
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 transform text-gray-400"
                    />
                    <Input
                      placeholder="Search groups..."
                      value={groupSearchTerm}
                      onChange={(e) => setGroupSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {filteredGroups.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        {groupSearchTerm
                          ? 'No groups match your search'
                          : 'No available groups to add'}
                      </div>
                    ) : (
                      filteredGroups.map((group) => (
                        <div
                          key={group.id}
                          className="flex cursor-pointer items-center justify-between rounded-2xl border p-1 hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => addGroup(group)}>
                          <div className="flex items-center">
                            <Users2Icon size={18} className="mr-2" />
                            <div className="flex flex-row gap-2">
                              <div className="text-sm">{group.name}</div>
                              <div className="text-xs text-gray-500">
                                {group._count.members} member
                                {group._count.members !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="rounded-full">
                            <PlusIcon />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {sharingType === SnippetSharingTypeEnum.MEMBERS && (
                <div className="space-y-4">
                  <div className="relative">
                    <SearchIcon
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 transform text-gray-400"
                    />
                    <Input
                      placeholder="Search members..."
                      value={memberSearchTerm}
                      onChange={(e) => setMemberSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {filteredMembers.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        {memberSearchTerm
                          ? 'No members match your search'
                          : 'No available members to add'}
                      </div>
                    ) : (
                      filteredMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex cursor-pointer items-center justify-between rounded-2xl border p-1 hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => addMember(member)}>
                          <div className="flex items-center">
                            <Avatar className="mr-2 size-8 border">
                              <AvatarImage src={member.user.image || undefined} />
                              <AvatarFallback>
                                {member.user.name?.charAt(0) || member.user.email?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-row gap-2">
                              <div className="text-sm">{member.user.name || member.user.email}</div>
                              <Badge variant="outline" className="px-1 text-xs">
                                {member.role}
                              </Badge>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="rounded-full">
                            <PlusIcon size={16} />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            disabled={
              (sharingType === SnippetSharingTypeEnum.GROUPS ||
                sharingType === SnippetSharingTypeEnum.MEMBERS) &&
              selectedItems.length === 0
            }>
            Save Sharing Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
