// apps/build/src/app/(portal)/[slug]/settings/members/_components/member-list.tsx

'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { formatDistanceToNow } from 'date-fns'
import { Clock, Mail, MoreHorizontal, Send, Shield, Trash2, UserCircle2 } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

type Member = {
  id: string
  userId: string
  emailAddress: string
  accessLevel: string
  createdAt: Date
  userName: string | null
  userImage: string | null
}

type Invite = {
  id: string
  emailAddress: string
  accessLevel: string
  failedToSend: boolean | null
  createdAt: Date
  updatedAt: Date
}

interface MemberListProps {
  developerSlug: string
  currentUserId: string
  currentMemberAccessLevel: string
  members: Member[]
  invites: Invite[]
  searchQuery: string
}

export function MemberList({
  developerSlug,
  currentUserId,
  currentMemberAccessLevel,
  members,
  invites,
  searchQuery,
}: MemberListProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [roleEditMemberId, setRoleEditMemberId] = useState<string | null>(null)
  const [roleEditValue, setRoleEditValue] = useState<string>('member')

  const isAdmin = currentMemberAccessLevel === 'admin'

  const removeMember = api.members.remove.useMutation({
    onSuccess: () => utils.members.list.invalidate({ developerSlug }),
    onError: (error) =>
      toastError({ title: 'Failed to remove member', description: error.message }),
  })

  const updateAccessLevel = api.members.updateAccessLevel.useMutation({
    onSuccess: () => {
      setRoleEditMemberId(null)
      utils.members.list.invalidate({ developerSlug })
    },
    onError: (error) =>
      toastError({ title: 'Failed to update access level', description: error.message }),
  })

  const cancelInvitation = api.members.cancelInvitation.useMutation({
    onSuccess: () => utils.members.list.invalidate({ developerSlug }),
    onError: (error) =>
      toastError({ title: 'Failed to cancel invitation', description: error.message }),
  })

  const resendInvitation = api.members.resendInvitation.useMutation({
    onSuccess: () => utils.members.list.invalidate({ developerSlug }),
    onError: (error) =>
      toastError({ title: 'Failed to resend invitation', description: error.message }),
  })

  const handleRemoveMember = async (member: Member) => {
    const confirmed = await confirm({
      title: 'Remove member?',
      description: `Are you sure you want to remove ${member.userName || member.emailAddress} from this account?`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      removeMember.mutate({ developerSlug, memberId: member.id })
    }
  }

  const handleCancelInvite = async (invite: Invite) => {
    const confirmed = await confirm({
      title: 'Cancel invitation?',
      description: `Are you sure you want to cancel the invitation to ${invite.emailAddress}?`,
      confirmText: 'Cancel invitation',
      cancelText: 'Keep',
      destructive: true,
    })
    if (confirmed) {
      cancelInvitation.mutate({ developerSlug, inviteId: invite.id })
    }
  }

  const query = searchQuery.toLowerCase()
  const filteredMembers = members.filter(
    (m) =>
      !query ||
      m.emailAddress.toLowerCase().includes(query) ||
      m.userName?.toLowerCase().includes(query)
  )
  const filteredInvites = invites.filter(
    (i) => !query || i.emailAddress.toLowerCase().includes(query)
  )

  const getInitials = (name?: string | null, email?: string | null) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2)
    }
    return email?.[0]?.toUpperCase() || '?'
  }

  const getAccessLevelIcon = (level: string) => {
    return level === 'admin' ? <Shield className='size-3' /> : <UserCircle2 className='size-3' />
  }

  return (
    <div className='space-y-6'>
      {/* Active Members */}
      {filteredMembers.length > 0 && (
        <div className='space-y-2'>
          <div className='text-sm font-medium text-muted-foreground'>
            Members ({filteredMembers.length})
          </div>
          <div className='space-y-1'>
            {filteredMembers.map((member) => {
              const isCurrentUser = member.userId === currentUserId
              const isEditingRole = roleEditMemberId === member.id

              return (
                <div
                  key={member.id}
                  className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
                  <div className='flex items-center gap-3'>
                    <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
                      <Avatar className='h-7 w-7 rounded-none shadow-none'>
                        <AvatarFallback className='rounded-none bg-transparent'>
                          {getInitials(member.userName, member.emailAddress)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className='flex flex-col'>
                      <div className='text-sm font-medium flex items-center gap-1'>
                        <span>{member.userName || 'Unnamed User'}</span>
                        {isCurrentUser && (
                          <span className='text-xs text-muted-foreground'>(you)</span>
                        )}
                        {isEditingRole ? (
                          <div className='ml-1 flex items-center gap-1'>
                            <Select
                              value={roleEditValue}
                              onValueChange={(v) => setRoleEditValue(v)}>
                              <SelectTrigger className='h-6 w-24 text-xs'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='member'>Member</SelectItem>
                                <SelectItem value='admin'>Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant='ghost'
                              size='icon-xs'
                              onClick={() => {
                                updateAccessLevel.mutate({
                                  developerSlug,
                                  memberId: member.id,
                                  accessLevel: roleEditValue as 'admin' | 'member',
                                })
                              }}
                              loading={updateAccessLevel.isPending}
                              disabled={roleEditValue === member.accessLevel}>
                              Save
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon-xs'
                              onClick={() => setRoleEditMemberId(null)}>
                              ✕
                            </Button>
                          </div>
                        ) : (
                          <Badge variant='user' className='ml-1' size='xs'>
                            {getAccessLevelIcon(member.accessLevel)}
                            <span className='capitalize'>{member.accessLevel}</span>
                          </Badge>
                        )}
                      </div>
                      <div className='text-muted-foreground text-xs flex items-center gap-1'>
                        <Mail className='size-3' />
                        <span>{member.emailAddress}</span>
                      </div>
                    </div>
                  </div>

                  {isAdmin && !isCurrentUser && !isEditingRole && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon-sm'>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={() => {
                            setRoleEditMemberId(member.id)
                            setRoleEditValue(member.accessLevel)
                          }}>
                          Change role
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => handleRemoveMember(member)}>
                          Remove member
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pending Invitations */}
      {filteredInvites.length > 0 && (
        <div className='space-y-2'>
          <div className='text-sm font-medium text-muted-foreground'>
            Pending invitations ({filteredInvites.length})
          </div>
          <div className='space-y-1'>
            {filteredInvites.map((invite) => (
              <div
                key={invite.id}
                className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
                <div className='flex items-center gap-3'>
                  <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0 opacity-60'>
                    <Avatar className='h-7 w-7 rounded-none shadow-none opacity-60'>
                      <AvatarFallback className='rounded-none bg-transparent'>
                        {getInitials(undefined, invite.emailAddress)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className='flex flex-col'>
                    <div className='text-sm font-medium flex items-center gap-1'>
                      <span>{invite.emailAddress}</span>
                      <Badge variant='user' className='ml-1' size='xs'>
                        <Clock className='size-3' />
                        <span>Pending {invite.accessLevel}</span>
                      </Badge>
                      {invite.failedToSend && (
                        <Badge variant='destructive' size='xs'>
                          Failed
                        </Badge>
                      )}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      Invited {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon-sm'>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={() =>
                          resendInvitation.mutate({ developerSlug, inviteId: invite.id })
                        }
                        disabled={resendInvitation.isPending}>
                        <Send />
                        Resend invitation
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => handleCancelInvite(invite)}>
                        <Trash2 />
                        Cancel invitation
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredMembers.length === 0 && filteredInvites.length === 0 && (
        <div className='text-center text-sm text-muted-foreground py-8'>
          {searchQuery ? 'No members or invitations match your search.' : 'No members found.'}
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}
