// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-sharing.tsx
'use client'
import { SnippetSharingType as SnippetSharingTypeEnum } from '@auxx/database/enums'
import type { SnippetSharingType } from '@auxx/database/types'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
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
import { Plus, Trash, UserIcon, Users2Icon, UsersIcon } from 'lucide-react'
import React from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { api } from '~/trpc/react'

interface ShareItem {
  /** userId for members, groupId for groups */
  id: string
  type: 'group' | 'member'
  name: string
  permission: 'VIEW' | 'EDIT'
  icon?: string
}

interface SnippetSharingProps {
  snippetId?: string
  initialSharingType: SnippetSharingType
  /** Staged shares for a new snippet (used only when snippetId is absent) */
  initialShares?: Array<{
    granteeType: 'group' | 'user'
    granteeId: string
    permission: 'VIEW' | 'EDIT'
  }>
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
  initialShares,
  open,
  onOpenChange,
  onSave,
}: SnippetSharingProps) {
  const [sharingType, setSharingType] = React.useState<SnippetSharingType>(initialSharingType)
  const [selectedItems, setSelectedItems] = React.useState<ShareItem[]>([])

  const { data: groupsData } = api.entityGroup.list.useQuery()
  const { data: membersData } = api.member.all.useQuery({})
  const { data: snippetData } = api.snippet.byId.useQuery(
    { id: snippetId || '' },
    { enabled: !!snippetId }
  )

  // Hydrate shares from a common source shape (server shares or staged shares)
  const hydrateShares = React.useCallback(
    (
      shares: Array<{
        granteeType: 'group' | 'user'
        granteeId: string
        permission: string
      }>
    ): ShareItem[] => {
      const items: ShareItem[] = []
      for (const share of shares) {
        const permission = share.permission.toUpperCase() as 'VIEW' | 'EDIT'

        if (share.granteeType === 'group') {
          const group = groupsData?.find((g) => g.id === share.granteeId)
          if (group) {
            items.push({
              id: group.id,
              type: 'group',
              name: group.displayName || 'Group',
              permission,
            })
          }
        } else {
          // Legacy fallback: older rows may have stored member.id instead of userId
          const member = membersData?.members?.find(
            (m) => m.userId === share.granteeId || m.id === share.granteeId
          )
          if (member) {
            items.push({
              id: member.userId,
              type: 'member',
              name: member.user.name || member.user.email || 'Unknown',
              permission,
              icon: member.user.image || undefined,
            })
          }
        }
      }
      return items
    },
    [groupsData, membersData?.members]
  )

  // Initialize state for existing snippets
  React.useEffect(() => {
    if (!snippetData?.snippet) return
    const { snippet } = snippetData
    setSharingType(snippet.sharingType as SnippetSharingType)
    setSelectedItems(snippet.shares?.length ? hydrateShares(snippet.shares) : [])
  }, [snippetData, hydrateShares])

  // Initialize state for new snippets from staged shares — run once when lookups are ready
  const hasSeededRef = React.useRef(false)
  React.useEffect(() => {
    if (hasSeededRef.current || snippetId) return
    if (!initialShares || initialShares.length === 0) {
      hasSeededRef.current = true
      return
    }
    if (!groupsData || !membersData?.members) return
    setSelectedItems(hydrateShares(initialShares))
    hasSeededRef.current = true
  }, [snippetId, initialShares, groupsData, membersData?.members, hydrateShares])

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSelectedItems([])
    }
  }, [open])

  // Build ActorId[] for the picker from the current selection
  const pickerValue = React.useMemo<ActorId[]>(
    () =>
      selectedItems.map((item) => toActorId(item.type === 'member' ? 'user' : 'group', item.id)),
    [selectedItems]
  )

  // Translate ActorPicker selection back into ShareItem[], preserving permissions for existing items
  const handlePickerChange = (nextIds: ActorId[]) => {
    const byActorId = new Map<string, ShareItem>(
      selectedItems.map((item) => [
        toActorId(item.type === 'member' ? 'user' : 'group', item.id),
        item,
      ])
    )
    const next: ShareItem[] = []
    for (const actorId of nextIds) {
      const existing = byActorId.get(actorId)
      if (existing) {
        next.push(existing)
        continue
      }
      const { type, id } = parseActorId(actorId)
      if (type === 'group') {
        const group = groupsData?.find((g) => g.id === id)
        if (!group) continue
        next.push({
          id: group.id,
          type: 'group',
          name: group.displayName || 'Group',
          permission: 'VIEW',
        })
      } else {
        const member = membersData?.members?.find((m) => m.userId === id)
        if (!member) continue
        next.push({
          id: member.userId,
          type: 'member',
          name: member.user.name || member.user.email || 'Unknown',
          permission: 'VIEW',
          icon: member.user.image || undefined,
        })
      }
    }
    setSelectedItems(next)
  }

  const removeItem = (id: string) => {
    setSelectedItems(selectedItems.filter((item) => item.id !== id))
  }

  const updateItemPermission = (id: string, permission: 'VIEW' | 'EDIT') => {
    setSelectedItems(selectedItems.map((item) => (item.id === id ? { ...item, permission } : item)))
  }

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

          {/* Custom sharing - unified picker */}
          {sharingType === SnippetSharingTypeEnum.GROUPS && (
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <label className='text-sm font-medium'>Selected Groups & Members</label>
                <ActorPicker value={pickerValue} onChange={handlePickerChange} target='both' multi>
                  <Button variant='outline' size='sm'>
                    <Plus />
                    Add
                  </Button>
                </ActorPicker>
              </div>

              {selectedItems.length === 0 ? (
                <div className='text-sm text-gray-500'>No groups or members selected</div>
              ) : (
                <div className='space-y-2'>
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
                          <SelectTrigger size='sm' className='w-24'>
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
