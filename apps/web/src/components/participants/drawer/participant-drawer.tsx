// apps/web/src/components/participants/drawer/participant-drawer.tsx
'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Mail, MessageSquare, Phone, UserPlus } from 'lucide-react'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { ThreadVisitCard } from '~/components/drawers/cards/thread-visit-card'
import { useDrawerContext } from '~/components/drawers/drawer-context'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useParticipant } from '~/components/threads/hooks'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'

interface ParticipantDrawerProps {
  participantId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Drawer for a Participant that has no linked Contact yet.
 *
 * When the participant *does* have a linked contact (`entityInstanceId` is
 * set), the drawer auto-redirects to the contact drawer by swapping the URL
 * params (`?participantId=` → `?contactId=`). Otherwise it renders a slim
 * detail view with a "Create Contact" action.
 */
export function ParticipantDrawer({ participantId, open, onOpenChange }: ParticipantDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((s) => s.dockedWidth)
  const setDockedWidth = useDockStore((s) => s.setDockedWidth)

  const [, setParticipantIdParam] = useQueryState('participantId', { defaultValue: '' })
  const [, setContactIdParam] = useQueryState('contactId', { defaultValue: '' })

  // When promoting from a chat thread, hand the source thread to the server so
  // it can copy the visitor's claimed name/email + last-known geo.
  const drawerContext = useDrawerContext()
  const sourceThreadId = drawerContext?.kind === 'thread' ? drawerContext.threadId : undefined

  const { participant, isLoading, isNotFound } = useParticipant({
    participantId,
    enabled: open && !!participantId,
  })

  // Auto-redirect: once we know the participant has a linked contact, swap
  // params to open the richer contact drawer instead.
  React.useEffect(() => {
    if (!open || !participant?.entityInstanceId) return
    const contactId = participant.entityInstanceId
    void setParticipantIdParam('')
    void setContactIdParam(contactId)
  }, [open, participant?.entityInstanceId, setParticipantIdParam, setContactIdParam])

  const ensureContact = api.participant.ensureContact.useMutation({
    onSuccess: ({ entityInstanceId }) => {
      void setParticipantIdParam('')
      void setContactIdParam(entityInstanceId)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create contact', description: error.message })
    },
  })

  const handleClose = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleCreateContact = React.useCallback(() => {
    if (!participantId) return
    ensureContact.mutate({ participantId, sourceThreadId })
  }, [participantId, sourceThreadId, ensureContact])

  if (!open || !participantId) return null

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={800}
      title='Participant'>
      <div className='flex flex-col h-full overflow-hidden'>
        <DrawerHeader
          icon={<EntityIcon iconId='circle-user' color='neutral' className='size-6' />}
          title='Participant'
          actions={<DockToggleButton />}
          onClose={handleClose}
        />

        {isNotFound ? (
          <div className='flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground'>
            Participant not found.
          </div>
        ) : (
          <div className='flex-1 overflow-y-auto'>
            <ParticipantCard
              displayName={participant?.displayName ?? null}
              identifier={participant?.identifier ?? null}
              identifierType={participant?.identifierType ?? null}
              initials={participant?.initials ?? null}
              isLoading={isLoading && !participant}
            />

            <div className='px-3 py-3 border-b'>
              <Button
                variant='info'
                size='sm'
                className='w-full'
                loading={ensureContact.isPending}
                loadingText='Creating contact...'
                disabled={!participant || ensureContact.isPending}
                onClick={handleCreateContact}>
                <UserPlus />
                Create Contact
              </Button>
              <p className='mt-2 text-xs text-muted-foreground'>
                Promote this participant to a contact to assign owners, add notes, and track
                conversations across channels.
              </p>
            </div>

            {/* Visit facts when this drawer's participant is the chat visitor */}
            <ThreadVisitCard participantId={participantId} />
          </div>
        )}
      </div>
    </DockableDrawer>
  )
}

/**
 * Top card showing participant identity (name, identifier, channel icon).
 */
function ParticipantCard({
  displayName,
  identifier,
  identifierType,
  initials,
  isLoading,
}: {
  displayName: string | null
  identifier: string | null
  identifierType: 'EMAIL' | 'PHONE' | 'CHAT_VISITOR' | null
  initials: string | null
  isLoading: boolean
}) {
  const IdentifierIcon =
    identifierType === 'PHONE' ? Phone : identifierType === 'CHAT_VISITOR' ? MessageSquare : Mail

  return (
    <div className='flex gap-3 py-3 px-3 flex-row items-center justify-start border-b'>
      <Avatar className='size-10'>
        <AvatarFallback className='text-sm'>
          {isLoading ? <Skeleton className='size-10 rounded-full' /> : (initials ?? '?')}
        </AvatarFallback>
      </Avatar>
      <div className='flex flex-col align-start w-full min-w-0'>
        <div className='text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate'>
          {isLoading ? <Skeleton className='h-6 w-60 mb-1' /> : (displayName ?? 'Unknown')}
        </div>
        <div className='flex items-center gap-1.5 text-xs text-muted-foreground min-w-0'>
          {isLoading ? (
            <Skeleton className='h-4 w-48' />
          ) : (
            <>
              <IdentifierIcon className='size-3.5 shrink-0' />
              <span className='truncate'>{identifier ?? '—'}</span>
              <span className='ms-1 px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase tracking-wide shrink-0'>
                Not a contact
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
