// apps/web/src/components/mail-permissions/ui/request-access-popover.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { formatDistanceToNowStrict } from 'date-fns'
import { LockKeyhole, Pencil, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useRequestAccess } from '~/components/mail-permissions/hooks/use-request-access'
import { Tooltip } from '../../global/tooltip'
import { AccessLevelsGuide } from './access-levels-guide'

function initials(name: string | null): string {
  return (name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/** "Sarah Chen (inbox manager)" / "Sarah Chen and 2 others (inbox managers)". */
function approverSummary(
  approvers: Array<{ name: string | null }>,
  approversAre: 'managers' | 'admins' | null
): string | null {
  if (approvers.length === 0) return null
  const first = approvers[0]?.name ?? 'A teammate'
  const noun =
    approversAre === 'admins'
      ? approvers.length > 1
        ? 'administrators'
        : 'administrator'
      : approvers.length > 1
        ? 'inbox managers'
        : 'inbox manager'
  const rest = approvers.length - 1
  return rest > 0 ? `${first} and ${rest} other ${noun}` : `${first} (${noun})`
}

/**
 * Ask for full access to one conversation (plan 42 §6.2).
 *
 * **Deliberately not a mode of `ThreadSharePopover`.** That popover's body is
 * `MailGranteeList` — other people, immediate persistence, no submit. This has one
 * implicit subject (me), no grantee list, and a submit-and-wait contract with a
 * pending state afterwards. The interaction contracts are opposites and almost
 * nothing in the body is common, so what is shared is the CHROME and the tier
 * vocabulary: the popover shell, the footer guide link, and `AccessLevelsGuide`.
 *
 * There is no lens picker — thread requests are hardcoded `full` (§0.2), which is
 * also what removes the Enterprise refusal case (§5.2). If a picker ever arrives it
 * goes through `LensSelect`, "the one tier picker every mail-permission surface
 * uses", rather than a second select.
 *
 * Renders nothing when the viewer has nothing to ask for. The two refusals that
 * name a lever are spoken instead (§5.3) — a worker seat especially, because no
 * permission change lifts it and a dead button would imply one might.
 */
export function RequestAccessPopover({
  threadId,
  variant = 'inline',
}: {
  threadId: string
  /** `inline` sits in the redaction banner; `icon` fills the header's share slot. */
  variant?: 'inline' | 'icon'
}) {
  const [open, setOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const {
    eligible,
    refusalCopy,
    pending,
    approvers,
    approversAre,
    subjectLabel,
    send,
    withdraw,
    isSending,
    isWithdrawing,
  } = useRequestAccess({ threadId })

  if (!eligible) {
    // A refusal is worth saying in the banner, where there is room for a sentence.
    // In the header's icon slot there is not, and a tooltip nobody hovers is not
    // communication — so that mount stays silent.
    if (refusalCopy && variant === 'inline') {
      return <span className='text-muted-foreground text-xs'>{refusalCopy}</span>
    }
    return null
  }

  const summary = approverSummary(approvers, approversAre)
  const trimmedNote = note.trim()

  /**
   * The disclosed note (§6.2), following the `line-rows.tsx` precedent: the toggle
   * reveals and autofocuses the field and switches its own label. A WRITTEN note is
   * never hidden again — collapsing it would silently drop text the user typed, so
   * the toggle re-focuses instead of closing once there is content.
   */
  const toggleNote = () => {
    if (!noteOpen) {
      setNoteOpen(true)
      requestAnimationFrame(() => noteRef.current?.focus())
      return
    }
    if (trimmedNote) {
      noteRef.current?.focus()
      return
    }
    setNoteOpen(false)
  }

  const handleSend = () => {
    send(trimmedNote || undefined)
    setOpen(false)
  }

  const trigger =
    variant === 'icon' ? (
      <Button variant='ghost' size='icon' className='rounded-full hover:bg-foreground/10'>
        <LockKeyhole />
        <span className='sr-only'>{pending ? 'Access requested' : 'Request access'}</span>
      </Button>
    ) : (
      <Button variant='outline' size='sm'>
        {pending ? 'Access requested' : 'Request access'}
      </Button>
    )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {variant === 'icon' ? (
            <div>
              <Tooltip content={pending ? 'Access requested' : 'Request access'}>{trigger}</Tooltip>
            </div>
          ) : (
            trigger
          )}
        </PopoverTrigger>
        <PopoverContent align='end' className='w-80 p-0'>
          <div className='border-b px-3 py-2'>
            <span className='font-medium text-sm'>
              {pending ? 'Access requested' : 'Request access'}
            </span>
          </div>

          <div className='space-y-2 px-3 py-2'>
            {/* Server-composed, so a `metadata` viewer gets inbox + participants +
                message count rather than an empty subject string (§6.2). */}
            {subjectLabel ? <p className='text-sm leading-5'>{subjectLabel}</p> : null}

            {/* Naming the approver is load-bearing: it is the difference between
                "sent into the void" and "Sarah will see this". Resolved on the
                server — the client never reconstructs inbox authority. */}
            {summary ? (
              <div className='flex items-center gap-2'>
                <span className='-space-x-2 flex items-center'>
                  {approvers.slice(0, 3).map((approver) => (
                    <Avatar key={approver.userId} className='size-5 border-2 border-background'>
                      <AvatarImage src={approver.image || undefined} alt={approver.name ?? ''} />
                      <AvatarFallback className='text-[9px]'>
                        {initials(approver.name)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                </span>
                <span className='text-muted-foreground text-xs'>{summary}</span>
              </div>
            ) : null}

            {pending ? (
              <p className='text-muted-foreground text-xs'>
                Requested {formatDistanceToNowStrict(pending.createdAt, { addSuffix: true })}
                {approvers.length > 0
                  ? ` · waiting on ${approvers[0]?.name ?? 'your team'}`
                  : ' · waiting for a decision'}
              </p>
            ) : (
              <>
                <button
                  type='button'
                  onClick={toggleNote}
                  className='flex items-center gap-1.5 text-muted-foreground text-xs underline-offset-2 hover:underline'>
                  {noteOpen && trimmedNote ? (
                    <Pencil className='size-3' />
                  ) : (
                    <Plus className='size-3' />
                  )}
                  {trimmedNote ? 'Edit note' : 'Add a note'}
                </button>
                {noteOpen ? (
                  <Textarea
                    ref={noteRef}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder='Why do you need access?'
                    rows={2}
                    maxLength={2000}
                    disabled={isSending}
                    className='text-sm'
                  />
                ) : null}
              </>
            )}
          </div>

          <div className='flex items-center justify-between gap-2 border-t px-3 py-2'>
            <button
              type='button'
              className='text-muted-foreground text-xs underline-offset-2 hover:underline'
              onClick={() => {
                setOpen(false)
                setGuideOpen(true)
              }}>
              Learn about access levels
            </button>
            {pending ? (
              <Button
                variant='outline'
                size='sm'
                loading={isWithdrawing}
                loadingText='Withdrawing...'
                onClick={() => {
                  withdraw()
                  setOpen(false)
                }}>
                Withdraw
              </Button>
            ) : (
              <div className='flex items-center gap-2'>
                <Button variant='ghost' size='sm' onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size='sm' loading={isSending} loadingText='Sending...' onClick={handleSend}>
                  Send
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}
