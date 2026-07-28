// apps/web/src/components/global/notifications/ui/items/suggestion-row.tsx
'use client'

import type { ProposedAction, StoredBundle } from '@auxx/lib/approvals'
import { toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  MoreHorizontal,
  SquareArrowOutUpRight,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BlockCardActionButton, StatusIndicator } from '~/components/kopilot/ui/blocks/block-card'
import { LearnedArticlePreview } from '~/components/learned/ui/learned-article-preview'
import { useRecordEditorStore } from '~/components/records/record-editor-store'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { api, type RouterOutputs } from '~/trpc/react'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRecord } from '../notification-chips'
import { NotificationRow } from '../notification-row'

/**
 * `NonNullable` because `Result.ok` is a plain boolean getter that does not narrow
 * the union, so every `approvals` procedure infers `… | undefined` on its output.
 * Structurally this is exactly `RouterOutputs['approvals']['list']['items'][number]`.
 */
type SuggestionBundle = NonNullable<RouterOutputs['approvals']['list']>['items'][number]
type ApproveResult = NonNullable<RouterOutputs['approvals']['approve']>

/** Live send held inside the undo window after an approve. */
interface SendingState {
  scheduledMessageId: string
  scheduledAt: Date
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One AI suggestion bundle, triaged inline in the notification panel's Approvals
 * tab. No read state, no delete — dismiss and snooze are the vocabulary, and a
 * delete would recreate the orphan path the architecture avoids.
 *
 * Approve does not drop the row: if the action chain scheduled a customer send,
 * the row flips in place to a countdown with an `Undo`, which is the only surface
 * left for the 5-minute send buffer. `onResolved` is deferred until that window
 * closes so the parent's refetch does not unmount the countdown.
 */
export function SuggestionRow({
  bundle,
  onResolved,
}: {
  bundle: SuggestionBundle
  onResolved: () => void
}) {
  const utils = api.useUtils()
  const router = useRouter()
  const closePanel = useNotificationPanelStore((state) => state.close)

  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<SendingState | null>(null)

  // `onResolved` is an inline arrow in every realistic caller, so holding it in a
  // ref keeps the expiry effect keyed on the countdown alone rather than re-firing
  // on every parent render.
  const onResolvedRef = useRef(onResolved)
  useEffect(() => {
    onResolvedRef.current = onResolved
  }, [onResolved])
  const resolve = useCallback(() => onResolvedRef.current(), [])

  const stored = bundle.bundle as StoredBundle
  const actions = stored.actions ?? []
  const summary = stored.summary ?? `${bundle.actionCount} action${plural(bundle.actionCount)}`
  const isStale = bundle.status !== 'FRESH'

  const recordId = toRecordId(bundle.entityDefinitionId, bundle.entityInstanceId)
  const href = useRecordLink(recordId)

  const approve = api.approvals.approve.useMutation({
    onSuccess: (result) => {
      const scheduled = findScheduledSend(result?.outcomes ?? [])
      // No send scheduled (a task, a memory article) → straight to done.
      if (!scheduled) {
        resolve()
        return
      }
      setSending(scheduled)
      setOpen(false)
    },
    onError: (error) => {
      toastError({
        title: error.data?.code === 'CONFLICT' ? 'Out of date' : 'Approve failed',
        description: error.message,
      })
      resolve()
    },
  })

  const reject = api.approvals.reject.useMutation({
    onSuccess: () => resolve(),
    onError: (error) => {
      toastError({ title: 'Dismiss failed', description: error.message })
      resolve()
    },
  })

  const snooze = api.approvals.snooze.useMutation({
    onSuccess: () => resolve(),
    onError: (error) => {
      toastError({ title: 'Snooze failed', description: error.message })
      resolve()
    },
  })

  const cancelSend = api.approvals.cancelPendingSend.useMutation({
    onSuccess: () => {
      void utils.approvals.listPending.invalidate()
      setSending(null)
      resolve()
    },
    onError: (error) => {
      const inFlight = error.data?.code === 'CONFLICT' && error.message === 'send_in_flight'
      toastError({
        title: 'Cancel failed',
        description: inFlight ? "Send in flight, can't cancel" : error.message,
      })
      void utils.approvals.listPending.invalidate()
      if (inFlight) {
        setSending(null)
        resolve()
      }
    },
  })

  // Countdown ticks client-side; the send job re-checks status at fire time, so
  // tab-throttling drift only affects the display.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!sending) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sending])

  const remainingMs = sending ? sending.scheduledAt.getTime() - now : 0
  const expired = Boolean(sending) && remainingMs <= 0
  useEffect(() => {
    if (expired) resolve()
  }, [expired, resolve])

  const pending = approve.isPending || reject.isPending || snooze.isPending
  const disabled = isStale || pending

  const openRecord = () => {
    if (href) {
      router.push(href)
    } else {
      useRecordEditorStore
        .getState()
        .openEditor({ entityDefinitionId: bundle.entityDefinitionId, recordId })
    }
    closePanel()
  }

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* size-7 + rounded-full so the trigger sits level with the h-7 pills. */}
        <Button
          variant='ghost'
          size='icon-sm'
          className='size-7 rounded-full'
          aria-label='Suggestion actions'>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-60'>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled || Boolean(sending)}>
            <Clock />
            Snooze
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='w-64'>
            {/* Dismissal is keyed to the entity's activity, so a snooze ends early
                the moment the customer replies. Say so — a bare duration lies. */}
            <DropdownMenuLabel className='font-normal text-muted-foreground text-xs'>
              Snooze until there's new activity, or at least:
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() =>
                snooze.mutate({ bundleId: bundle.id, snoozeUntil: new Date(Date.now() + DAY_MS) })
              }>
              Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                snooze.mutate({
                  bundleId: bundle.id,
                  snoozeUntil: new Date(Date.now() + 7 * DAY_MS),
                })
              }>
              Next week
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openRecord}>
          <SquareArrowOutUpRight />
          Open record
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const actionLabel = sending ? (
    <span className='pl-0.5 text-foreground/80 text-xs font-medium'>
      {expired ? 'Approved · Sending…' : `Approved · Sending in ${formatRemaining(remainingMs)}`}
    </span>
  ) : (
    <button
      type='button'
      onClick={() => setOpen((value) => !value)}
      className='flex h-7 cursor-pointer items-center gap-1 rounded-full pr-2 text-foreground/65 text-xs font-medium hover:bg-foreground/5'>
      <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      {open ? 'Hide details' : 'Details'}
    </button>
  )

  return (
    <NotificationRow
      id={bundle.id}
      createdAt={new Date(bundle.createdAt)}
      label='Suggestion'
      icon={<StatusIndicator status={sending ? 'approved' : 'pending'} />}
      subtitle={
        <>
          {bundle.actionCount} action{plural(bundle.actionCount)} ·{' '}
          <NotificationRecord recordId={recordId} size='sm' /> ·{' '}
          {formatDistanceToNow(new Date(bundle.computedForActivityAt), { addSuffix: true })}
        </>
      }
      actionLabel={actionLabel}
      actions={
        sending ? (
          <BlockCardActionButton
            label='Undo'
            primary
            disabled={expired || cancelSend.isPending}
            onClick={() => cancelSend.mutate({ scheduledMessageId: sending.scheduledMessageId })}
          />
        ) : (
          <>
            {overflow}
            <BlockCardActionButton
              label='Dismiss'
              disabled={disabled}
              onClick={() => reject.mutate({ bundleId: bundle.id })}
            />
            <BlockCardActionButton
              label='Approve'
              primary
              disabled={disabled}
              onClick={() => approve.mutate({ bundleId: bundle.id })}
            />
          </>
        )
      }
      expanded={
        <AnimatePresence initial={false}>
          {open && actions.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
              animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
              exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ overflow: 'hidden' }}>
              <ul className='flex flex-col gap-1.5 pt-2'>
                {actions.map((action) => (
                  <ActionRow key={action.localIndex} action={action} />
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      }>
      <span>{summary}</span>
      {isStale ? (
        <span className='mt-1.5 flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 text-muted-foreground text-xs leading-5'>
          <AlertTriangle className='size-3.5 shrink-0' />
          Out of date — the record changed since this was proposed
        </span>
      ) : null}
    </NotificationRow>
  )
}

/**
 * One proposed action, read-only. There is no per-action edit and no partial
 * approval — the bundle is approved or dismissed whole.
 */
function ActionRow({ action }: { action: ProposedAction }) {
  if (action.toolName === 'upsert_learned_article') {
    return (
      <li className='list-none'>
        <LearnedArticlePreview args={action.args} className='bg-muted/40' />
      </li>
    )
  }
  return (
    <li className='list-none text-foreground text-xs leading-5'>
      <span className='mr-2 font-mono text-muted-foreground'>{action.toolName}</span>
      <span>{action.summary}</span>
    </li>
  )
}

/**
 * `applySoftAction` writes `{ scheduledMessageId, scheduledAt }` into the outcome
 * of any action that promoted a Draft to a scheduled send, so the countdown reads
 * straight off the approve response — no refetch, no polling.
 */
function findScheduledSend(outcomes: ApproveResult['outcomes']): SendingState | null {
  for (const outcome of outcomes) {
    const scheduledMessageId = outcome.toolOutput?.scheduledMessageId
    const scheduledAt = outcome.toolOutput?.scheduledAt
    if (typeof scheduledMessageId === 'string' && typeof scheduledAt === 'string') {
      return { scheduledMessageId, scheduledAt: new Date(scheduledAt) }
    }
  }
  return null
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}
