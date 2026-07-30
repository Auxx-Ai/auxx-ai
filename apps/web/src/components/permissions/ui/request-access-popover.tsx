// apps/web/src/components/permissions/ui/request-access-popover.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import { LockKeyhole, Pencil, Plus } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { RequestAccessState } from '~/components/permissions/hooks/use-request-access'

/** The strings that name the domain. Everything else in the shell is domain-free. */
export interface RequestAccessCopy {
  /** Trigger label and popover header before anything is asked — e.g. "Request access". */
  trigger: string
  /** Trigger label and popover header once one is outstanding — e.g. "Access requested". */
  pendingTrigger: string
  /** Placeholder for the disclosed note field. */
  notePlaceholder: string
}

export interface RequestAccessPopoverProps extends Omit<RequestAccessState, 'isLoading'> {
  copy: RequestAccessCopy
  /**
   * "Sarah Chen (inbox manager)" / "Sarah Chen and 2 others (inbox managers)".
   *
   * Composed by the CALLER, because the noun is domain vocabulary — mail says
   * "inbox manager", the record lane says something else — and a `domain` prop
   * switched inside here would be two implementations wearing one name.
   */
  approverSummary?: string | null
  /**
   * The footer's left edge, opposite the actions. Receives a `close` for the
   * popover, because a footer that opens a dialog (mail's access-levels guide)
   * must dismiss the popover first — two stacked overlays fight for focus.
   *
   * ⚠ Render anything the close should NOT unmount — a dialog especially — as a
   * SIBLING of this component, not inside the slot. The slot lives inside
   * `PopoverContent`, which Radix unmounts on close.
   */
  footer?: (close: () => void) => ReactNode
  /**
   * `inline` is a labelled button in a banner or action row; `icon` is a lock for
   * a header slot; `menu-item` is a row inside an already-open dropdown menu.
   *
   * `menu-item` prevents the menu's own `select`, so the dropdown stays open
   * behind the popover rather than unmounting the trigger the popover is
   * anchored to.
   */
  variant?: 'inline' | 'icon' | 'menu-item'
  /**
   * Notified whenever the popover opens or closes — **the lazy-preflight seam**
   * (plan v3/04 §8.5 / D6).
   *
   * The shell keeps owning the open state, so a lane that does not care passes
   * nothing. The record lane does care: `_access === 'read'` is the *common*
   * state, so a preflight fired on mount would run on every drawer open and every
   * detail-page load for that whole population, to decide a label. Its hook gates
   * the query on this instead.
   */
  onOpenChange?: (open: boolean) => void
}

function initials(name: string | null): string {
  return (name ?? '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * Ask for more access to one thing, and watch the ask (plan v3 04 §8.1).
 *
 * Domain-agnostic chrome only: the popover shell, the disclosed note, the
 * approver stack, the pending status view and the Send/Cancel/Withdraw footer.
 * Every string that names a domain arrives in {@link RequestAccessCopy}, every
 * fact arrives as a prop from that lane's hook, and anything else the lane needs
 * goes in the `footer` slot. **Nothing mail- or record-specific may be imported
 * here** — needing such an import is the signal it belongs in a wrapper.
 *
 * Renders nothing when the viewer has nothing to ask for. A refusal that names a
 * lever is spoken instead of hidden (plan 42 §5.3) — a worker seat especially,
 * because no permission change lifts it and a dead button would imply one might.
 */
export function RequestAccessPopover({
  eligible,
  refusalCopy,
  pending,
  approvers,
  approverSummary,
  subjectLabel,
  send,
  withdraw,
  isSending,
  isWithdrawing,
  copy,
  footer,
  variant = 'inline',
  onOpenChange,
}: RequestAccessPopoverProps) {
  const [open, setOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  /** Every open/close path goes through here, so a lane cannot miss one. */
  const setOpenAndNotify = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  if (!eligible) {
    // A refusal is worth saying in a banner or an action row, where there is room
    // for a sentence. In a header's icon slot there is not, and a tooltip nobody
    // hovers is not communication — so that mount stays silent.
    if (refusalCopy && variant === 'inline') {
      return <span className='text-muted-foreground text-xs'>{refusalCopy}</span>
    }
    return null
  }

  const label = pending ? copy.pendingTrigger : copy.trigger
  const trimmedNote = note.trim()

  /**
   * The disclosed note (plan 42 §6.2), following the `line-rows.tsx` precedent: the
   * toggle reveals and autofocuses the field and switches its own label. A WRITTEN
   * note is never hidden again — collapsing it would silently drop text the user
   * typed, so the toggle re-focuses instead of closing once there is content.
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
    setOpenAndNotify(false)
  }

  const trigger =
    variant === 'icon' ? (
      <Button variant='ghost' size='icon' className='rounded-full hover:bg-foreground/10'>
        <LockKeyhole />
        <span className='sr-only'>{label}</span>
      </Button>
    ) : variant === 'menu-item' ? (
      // `onSelect` is prevented so the host dropdown does NOT close: closing it
      // unmounts this trigger, and Radix anchors the popover to it.
      <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
        <LockKeyhole />
        {label}
      </DropdownMenuItem>
    ) : (
      <Button variant='outline' size='sm'>
        {label}
      </Button>
    )

  return (
    <Popover open={open} onOpenChange={setOpenAndNotify}>
      <PopoverTrigger asChild>
        {variant === 'icon' ? (
          <div>
            <Tooltip content={label}>{trigger}</Tooltip>
          </div>
        ) : (
          trigger
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        <div className='border-b px-3 py-2'>
          <span className='font-medium text-sm'>{label}</span>
        </div>

        <div className='space-y-2 px-3 py-2'>
          {/* Composed on the SERVER, so a viewer who cannot read the target still
              gets a usable label rather than an empty string — mail's `metadata`
              lens is the case that forced it (plan 42 §6.2). */}
          {subjectLabel ? <p className='text-sm leading-5'>{subjectLabel}</p> : null}

          {/* Naming the approver is load-bearing: it is the difference between
              "sent into the void" and "Sarah will see this". Resolved on the
              server — the client never reconstructs who holds authority. */}
          {approverSummary ? (
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
              <span className='text-muted-foreground text-xs'>{approverSummary}</span>
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
                  placeholder={copy.notePlaceholder}
                  rows={2}
                  maxLength={2000}
                  disabled={isSending}
                  className='text-sm'
                />
              ) : null}
            </>
          )}
        </div>

        <div
          className={cn(
            'flex items-center gap-2 border-t px-3 py-2',
            footer ? 'justify-between' : 'justify-end'
          )}>
          {footer?.(() => setOpenAndNotify(false))}
          {pending ? (
            <Button
              variant='outline'
              size='sm'
              loading={isWithdrawing}
              loadingText='Withdrawing...'
              onClick={() => {
                withdraw()
                setOpenAndNotify(false)
              }}>
              Withdraw
            </Button>
          ) : (
            <div className='flex items-center gap-2'>
              <Button variant='ghost' size='sm' onClick={() => setOpenAndNotify(false)}>
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
  )
}
