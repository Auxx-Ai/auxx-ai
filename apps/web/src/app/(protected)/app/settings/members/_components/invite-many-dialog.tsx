// apps/web/src/app/(protected)/app/settings/members/_components/invite-many-dialog.tsx
'use client'

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
import { toastError } from '@auxx/ui/components/toast'
import { Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import {
  InviteEmailEditor,
  type InviteEmailEditorHandle,
  isValidInviteEmail,
} from './invite-email-editor'
import {
  defaultInviteProfile,
  InviteProfileSelect,
  roleLabel,
  seatClassLabel,
  useInvitableProfiles,
} from './invite-profile-select'

/** One line of the post-send report, as `member.inviteBatch` returns it. */
interface InviteResult {
  email: string
  success: boolean
  message?: string
  error?: string
}

interface InviteManyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Address carried over from the single-invite popover, if any. */
  initialEmail?: string
  /** Profile carried over from the single-invite popover, if any. */
  initialProfileId?: string
}

/**
 * Bulk invite: paste a list of addresses, pick one profile for all of them.
 *
 * Every address is a chip, so an unusable one is visible (warning icon) before
 * sending rather than coming back as a server error. Sending is blocked while
 * any chip is invalid — a batch that silently drops entries is worse than one
 * that refuses. The result list stays open afterwards because partial failure
 * is the normal case here (already a member, invitation pending, seat cap).
 */
export function InviteManyDialog({
  open,
  onOpenChange,
  initialEmail,
  initialProfileId,
}: InviteManyDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const editorRef = useRef<InviteEmailEditorHandle>(null)
  const [entries, setEntries] = useState<string[]>([])
  const [permissionProfileId, setPermissionProfileId] = useState<string | undefined>(undefined)
  const [results, setResults] = useState<InviteResult[] | null>(null)

  const { profiles } = useInvitableProfiles()
  const selectedProfile = profiles.find((profile) => profile.id === permissionProfileId)

  // Never carry a previous run into a fresh open.
  useEffect(() => {
    if (!open) return
    setEntries(initialEmail ? [initialEmail] : [])
    setPermissionProfileId(initialProfileId)
    setResults(null)
  }, [open, initialEmail, initialProfileId])

  // Start on the Member baseline once the profile list arrives.
  useEffect(() => {
    if (permissionProfileId || profiles.length === 0) return
    const fallback = defaultInviteProfile(profiles)
    if (fallback) setPermissionProfileId(fallback.id)
  }, [permissionProfileId, profiles])

  const inviteBatch = api.member.inviteBatch.useMutation({
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })

  const isPending = inviteBatch.isPending
  const invalidCount = entries.filter((entry) => !isValidInviteEmail(entry)).length
  const validCount = entries.length - invalidCount
  const canSend = entries.length > 0 && invalidCount === 0 && !isPending

  const handleSend = async () => {
    // Commit whatever is still half-typed, so it is judged like every other
    // entry instead of being dropped on send.
    const all = editorRef.current?.flush() ?? entries
    setEntries(all)
    if (all.length === 0 || all.some((entry) => !isValidInviteEmail(entry))) return

    try {
      const sent = await inviteBatch.mutateAsync({
        invites: all.map((email) => ({
          // No `role`: the profile declares both the seat class and the rank it
          // confers, so the server derives both from it (plan 21 §2.a.3).
          email,
          permissionProfileId: permissionProfileId ?? null,
        })),
      })
      setResults(sent)
      // The Members list is client-fetched, so invalidate rather than relying on
      // router.refresh (which only re-runs server components).
      utils.member.invitations.invalidate()
      utils.member.activeCount.invalidate()
      router.refresh()
    } catch {
      // Error is surfaced by the mutation's onError toast
    }
  }

  const sentCount = results?.filter((result) => result.success).length ?? 0
  const failedCount = (results?.length ?? 0) - sentCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Invite team members</DialogTitle>
          {results && (
            <DialogDescription>
              {sentCount} sent{failedCount > 0 && ` · ${failedCount} failed`}
            </DialogDescription>
          )}
        </DialogHeader>

        {results ? (
          <div className='flex max-h-80 flex-col gap-1.5 overflow-y-auto'>
            {results.map((result) => (
              <div key={result.email} className='flex items-start gap-2 text-sm'>
                {result.success ? (
                  <Check className='mt-0.5 size-4 shrink-0 text-emerald-600' />
                ) : (
                  <X className='mt-0.5 size-4 shrink-0 text-destructive' />
                )}
                <span className='font-medium'>{result.email}</span>
                <span className='text-muted-foreground'>
                  {result.success ? (result.message ?? 'Invitation sent') : result.error}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <div className='space-y-1.5'>
              <p className='text-sm text-primary-600'>Send invite to</p>
              <InviteEmailEditor
                ref={editorRef}
                initialEmails={initialEmail ? [initialEmail] : undefined}
                onChange={setEntries}
                disabled={isPending}
              />
              {/* Always rendered, so adding the first address never shifts the
                  layout underneath it. */}
              <p className='text-xs text-muted-foreground'>
                {validCount} {validCount === 1 ? 'address' : 'addresses'}
                {invalidCount > 0 && (
                  <span className='text-destructive'>
                    {' '}
                    · {invalidCount} {invalidCount === 1 ? 'address needs' : 'addresses need'}{' '}
                    fixing
                  </span>
                )}
              </p>
            </div>

            {profiles.length > 0 && (
              <FieldPanel className='p-0'>
                <FieldPanelRow
                  title='Invite as'
                  type={BaseType.ENUM}
                  showIcon
                  description='Sets what these members can do. Its seat class and rank are what each invitation consumes and grants.'>
                  <InviteProfileSelect
                    value={permissionProfileId}
                    profiles={profiles}
                    onChange={(profile) => setPermissionProfileId(profile.id)}
                    disabled={isPending}
                  />
                </FieldPanelRow>
              </FieldPanel>
            )}

            {selectedProfile && (
              <p className='text-xs text-muted-foreground'>
                {seatClassLabel(selectedProfile.seat)} · {roleLabel(selectedProfile.role)} (what
                each invitation consumes and grants.)
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button
              data-dialog-submit
              size='sm'
              variant='outline'
              onClick={() => onOpenChange(false)}>
              Done <KbdSubmit variant='outline' size='sm' />
            </Button>
          ) : (
            <>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                data-dialog-submit
                size='sm'
                variant='outline'
                disabled={!canSend}
                loading={isPending}
                loadingText='Sending...'
                onClick={handleSend}>
                Send {entries.length > 1 ? `${entries.length} invitations` : 'invitation'}
                <KbdSubmit variant='outline' size='sm' />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
