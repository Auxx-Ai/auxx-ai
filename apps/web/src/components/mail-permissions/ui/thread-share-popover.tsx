// apps/web/src/components/mail-permissions/ui/thread-share-popover.tsx
'use client'

import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import type { ActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Info, Share2 } from 'lucide-react'
import { useState } from 'react'
import { useMailShare } from '~/components/mail-permissions/hooks/use-mail-share'
import { useRequestAccess } from '~/components/mail-permissions/hooks/use-request-access'
import { useActor } from '~/components/resources/hooks'
import { useInbox, useThread } from '~/components/threads/hooks'
import { Tooltip } from '../../global/tooltip'
import { AccessLevelsGuide } from './access-levels-guide'
import { GranularPermissionsGate, useGranularPermissionsGated } from './granular-permissions-gate'
import { MailGranteeList } from './mail-grantee-list'
import { RequestAccessPopover } from './request-access-popover'

/** A tiny stacked avatar for the share button's grantee cluster. */
function MiniActorAvatar({ actorId }: { actorId: ActorId }) {
  const { actor } = useActor({ actorId })
  const name = actor?.name ?? '?'
  return (
    <Avatar className='size-5 border-2 border-background'>
      <AvatarImage src={actor?.avatarUrl ?? undefined} alt={name} />
      <AvatarFallback className='text-[9px]'>
        {name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .substring(0, 2)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * Share button + popover for the thread header (UI plan §3): immediate-
 * persistence grantee list over `use-mail-share`, with the inherited-access
 * footer (inbox floor + assignee). Sharers are org admins and Managers of the
 * thread's inbox; everyone else sees a read-only list (button hidden for them
 * until the thread has explicit grants).
 */
export function ThreadSharePopover({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const { thread } = useThread({ threadId })
  const { inbox } = useInbox(thread?.inboxId)
  const gated = useGranularPermissionsGated()

  const recordId = toRecordId('thread', threadId)
  const { grants, unmanageableGrants, grant, changeLens, revoke } = useMailShare({ recordId })

  // `canShare` (org admin/owner, or Manager of this thread's inbox) lives in
  // `useRequestAccess` — it is half of the requester condition too, so plan 42 §6.1
  // moved the expression there rather than leaving a copy at each mount.
  const { canShare, myLens } = useRequestAccess({ threadId })

  const { actor: assignee } = useActor({ actorId: thread?.assigneeId ?? undefined })

  if (!thread) return null
  // Non-sharers only get the read-only list once the thread has explicit grants —
  // but plan 42 §6.1 mount 2 makes this the SECONDARY request slot rather than an
  // empty header: being unable to administer sharing is not the same as lacking read
  // access, so only a sub-`full` viewer gets the trigger here.
  if (!canShare && grants.length === 0) {
    return myLens !== 'read' ? <RequestAccessPopover threadId={threadId} variant='icon' /> : null
  }

  // `?? 'read'` covers an ABSENT floor; `LENS_LABELS[...]` covers an UNKNOWN one.
  // Both are needed: the floor is served from the `org:inboxes` cache verbatim, so
  // a blob written before a vocabulary rename holds a retired value (`full`,
  // `subject`) that is a string — non-null, so `??` sails past it — with no entry
  // in `LENS_LABELS`. That threw here. Same defence as `LensSelect`'s `safeValue`.
  const rawFloor = inbox?.defaultLens ?? 'read'
  const floor = LENS_LABELS[rawFloor] ? rawFloor : 'read'

  const button = (
    <Button variant='ghost' size='icon' className='rounded-full hover:bg-foreground/10'>
      {grants.length > 0 ? (
        <span className='-space-x-2 flex items-center'>
          {grants.slice(0, 2).map(({ actorId }) => (
            <MiniActorAvatar key={actorId} actorId={actorId} />
          ))}
          {grants.length > 2 && (
            <Avatar className='size-5 border-2 border-background bg-muted'>
              <AvatarFallback className='text-[9px]'>+{grants.length - 2}</AvatarFallback>
            </Avatar>
          )}
        </span>
      ) : (
        <Share2 />
      )}
      <span className='sr-only'>Share</span>
    </Button>
  )

  // Free-plan sharers get the tease; grantee-holders still see the list.
  if (gated && grants.length === 0) {
    return <GranularPermissionsGate className='shrink-0'>{button}</GranularPermissionsGate>
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className='shrink-0'>
            <Tooltip content='Share'>{button}</Tooltip>
          </div>
        </PopoverTrigger>
        <PopoverContent align='end' className='w-80 p-0'>
          <div className='border-b px-3 py-2'>
            <span className='font-medium text-sm'>Share conversation</span>
          </div>
          <div className='px-2 py-2'>
            <MailGranteeList
              grants={grants}
              onGrant={grant}
              onChangeLens={changeLens}
              onRevoke={revoke}
              disabled={!canShare || gated}
              unmanageableGrants={unmanageableGrants}
              emptyHint='Not shared with anyone yet.'
              stagedAdd
            />
          </div>
          <div className='space-y-1 border-t px-3 py-2 text-muted-foreground text-xs'>
            {floor !== 'none' && inbox && (
              <div className='flex items-center gap-1.5'>
                <Info className='size-3 shrink-0' />
                <span>
                  Everyone in {inbox.name} — {LENS_LABELS[floor].label.toLowerCase()}
                </span>
              </div>
            )}
            {assignee && (
              <div className='flex items-center gap-1.5'>
                <Info className='size-3 shrink-0' />
                <span>{assignee.name} (assignee) — full access</span>
              </div>
            )}
            <button
              type='button'
              className='underline-offset-2 hover:underline'
              onClick={() => {
                setOpen(false)
                setGuideOpen(true)
              }}>
              Learn about access levels
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
