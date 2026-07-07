// apps/web/src/components/mail-permissions/ui/orphaned-inbox-banner.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActor } from '~/components/resources/hooks/use-actor'
import type { InboxItem } from '~/components/threads/hooks/use-inbox'
import { useInboxes } from '~/components/threads/hooks/use-inbox'
import { useConfirm } from '~/hooks/use-confirm'
import { useMembersGroups } from '~/hooks/use-members-groups'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'

/**
 * Admin banner on an ORPHANED personal inbox (mail-permissions §11.4) — the
 * owner left the org, sync is stopped, and an admin must decide: claim it
 * (convert into a normal restricted org inbox, admins gain full access) or
 * delete it (inbox + all its mail, destructive confirm). Renders nothing for
 * non-admins, non-personal inboxes, or while the owner is still a member.
 */
export function OrphanedPersonalInboxBanner({ inbox }: { inbox: InboxItem }) {
  const router = useRouter()
  const { isAdminOrOwner } = useUser()
  const { members, isLoading: membersLoading } = useMembersGroups()
  const { refresh } = useInboxes()
  const [confirm, ConfirmDialog] = useConfirm()

  const { actor: owner } = useActor({
    actorId: inbox.ownerUserId ? toActorId('user', inbox.ownerUserId) : null,
  })

  const claim = api.inbox.claimPersonal.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Error claiming inbox', description: error.message }),
  })
  const deletePersonal = api.inbox.deletePersonal.useMutation({
    onSuccess: () => {
      refresh()
      router.push('/app/settings/inbox')
    },
    onError: (error) => toastError({ title: 'Error deleting inbox', description: error.message }),
  })

  const orphaned =
    inbox.isPersonal &&
    !!inbox.ownerUserId &&
    !membersLoading &&
    !members.some((m) => m.userId === inbox.ownerUserId)

  if (!isAdminOrOwner || !orphaned) return null

  const ownerLabel = owner?.name ?? 'a former member'

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete personal inbox?',
      description:
        'This permanently deletes the inbox and ALL of its mail. The data was private to its owner and cannot be recovered.',
      confirmText: 'Delete inbox',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deletePersonal.mutate({ inboxId: inbox.id })
  }

  return (
    <>
      <Alert className='mb-4'>
        <UserRound />
        <AlertTitle>Orphaned personal inbox</AlertTitle>
        <AlertDescription>
          <p>
            This was {ownerLabel}&apos;s personal account and its owner is no longer a member.
            Syncing has stopped. Claim it to convert it into a shared restricted inbox, or delete it
            along with all of its mail.
          </p>
          <div className='mt-2 flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => claim.mutate({ inboxId: inbox.id })}
              loading={claim.isPending}
              loadingText='Claiming...'>
              Claim inbox
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='text-destructive hover:text-destructive'
              onClick={handleDelete}
              loading={deletePersonal.isPending}
              loadingText='Deleting...'>
              Delete inbox
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <ConfirmDialog />
    </>
  )
}
