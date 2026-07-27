// apps/web/src/app/(protected)/app/settings/members/_components/invite-popover.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { Plus, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { InviteManyDialog } from './invite-many-dialog'
import {
  defaultInviteProfile,
  InviteProfileSelect,
  roleLabel,
  seatClassLabel,
  useInvitableProfiles,
} from './invite-profile-select'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface InviteFormProps {
  children?: ReactNode
}

/** Popover for inviting a team member: email + the profile the invitation binds. */
export default function InviteFormPopover({ children }: InviteFormProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  /** Optional: with no profiles readable the invitation binds nothing and the
   * member resolves to the system template for their role (§1.3). */
  const [permissionProfileId, setPermissionProfileId] = useState<string | undefined>(undefined)
  const [manyOpen, setManyOpen] = useState(false)
  /** Snapshot handed to the bulk dialog — kept as state so it stays stable
   * while the dialog is open, even as the popover resets behind it. */
  const [carried, setCarried] = useState<{ email?: string; profileId?: string }>({})

  const { profiles } = useInvitableProfiles()
  const selectedProfile = profiles.find((profile) => profile.id === permissionProfileId)

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setEmail('')
      setPermissionProfileId(undefined)
    }
  }, [open])

  // Start on the Member baseline once the profile list arrives.
  useEffect(() => {
    if (permissionProfileId || profiles.length === 0) return
    const fallback = defaultInviteProfile(profiles)
    if (fallback) setPermissionProfileId(fallback.id)
  }, [permissionProfileId, profiles])

  const inviteUser = api.member.invite.useMutation({
    onSuccess: () => {
      setOpen(false)
      // The Members list is client-fetched, so invalidate rather than relying on
      // router.refresh (which only re-runs server components).
      utils.member.invitations.invalidate()
      utils.member.activeCount.invalidate()
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })

  const isPending = inviteUser.isPending
  const canSubmit = EMAIL_PATTERN.test(email.trim()) && !isPending

  const handleSubmit = async () => {
    if (!canSubmit) return
    await inviteUser
      .mutateAsync({
        email: email.trim(),
        // No `role`: the profile declares both the seat class and the rank it
        // confers (plan 21 §2.a.3), so the server derives both from it and caps
        // against them. The input default (`USER`) only matters for the
        // no-profile fallback (§1.3).
        permissionProfileId: permissionProfileId ?? null,
      })
      .catch(() => {
        // Error is surfaced by the mutation's onError toast
      })
  }

  /** Hand the popover's work to the bulk dialog instead of discarding it. */
  const openInviteMany = () => {
    const typed = email.trim().toLowerCase()
    setCarried({ email: typed || undefined, profileId: permissionProfileId })
    setOpen(false)
    setManyOpen(true)
  }

  const defaultTrigger = (
    <Button variant='outline' size='icon'>
      <Plus className='h-4 w-4' />
      <span className='sr-only'>Invite Team Member</span>
    </Button>
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
        <PopoverContent className='w-96' side='bottom' align='end'>
          <div className='space-y-3'>
            <h4 className='text-sm font-semibold'>Invite Team Member</h4>

            <FieldPanel className='p-0'>
              <FieldPanelRow
                title='Email'
                type={BaseType.EMAIL}
                showIcon
                isRequired
                description='The email address of the person you want to invite'>
                <FieldInputAdapter
                  fieldType={FieldType.EMAIL}
                  value={email}
                  onChange={(val) => setEmail((val as string) ?? '')}
                  placeholder='colleague@example.com'
                  disabled={isPending}
                />
              </FieldPanelRow>

              {profiles.length > 0 && (
                <FieldPanelRow
                  title='Profile'
                  type={BaseType.ENUM}
                  showIcon
                  description='Sets what this member can do. Its seat class and rank are what the invitation consumes and grants.'>
                  {/* Not a FieldInputAdapter select: profile options carry a
                    per-option description (seat class + rank copy) that the
                    generic select input cannot render. */}
                  <InviteProfileSelect
                    value={permissionProfileId}
                    profiles={profiles}
                    onChange={(profile) => setPermissionProfileId(profile.id)}
                    disabled={isPending}
                  />
                </FieldPanelRow>
              )}
            </FieldPanel>

            {selectedProfile && (
              <p className='text-xs text-muted-foreground'>
                {seatClassLabel(selectedProfile.seat)} · {roleLabel(selectedProfile.role)} (what
                this invitation consumes and grants.)
              </p>
            )}

            <div className='flex items-center justify-between gap-2'>
              <Button variant='outline' size='xs' onClick={openInviteMany} disabled={isPending}>
                <Users />
                Invite many
              </Button>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  size='xs'
                  onClick={() => setOpen(false)}
                  disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  variant='outline'
                  size='xs'
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  loading={isPending}
                  loadingText='Sending...'>
                  Send Invitation
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <InviteManyDialog
        open={manyOpen}
        onOpenChange={setManyOpen}
        initialEmail={carried.email}
        initialProfileId={carried.profileId}
      />
    </>
  )
}
