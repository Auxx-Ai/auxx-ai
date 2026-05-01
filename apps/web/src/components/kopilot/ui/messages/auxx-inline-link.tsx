// apps/web/src/components/kopilot/ui/messages/auxx-inline-link.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@auxx/ui/components/hover-card'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  FileText,
  type LucideIcon,
  Mail,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { RecordHoverCard } from '~/components/resources/ui/record-hover-card'
import type { LinkSnapshot } from '../../stores/kopilot-store'

interface AuxxInlineLinkProps {
  href: string
  label: string
  /** Resolved snapshot from message.linkSnapshots */
  snapshot?: LinkSnapshot
}

/**
 * Inline `auxx://` chip rendered for `[label](auxx://...)` markdown links in
 * assistant messages. Each kind (record/thread/task/doc) gets its own click
 * behavior + hover preview, all driven from the per-message `linkSnapshots`
 * map populated server-side.
 */
export function AuxxInlineLink({ href, label, snapshot }: AuxxInlineLinkProps) {
  const parsed = parseAuxxHref(href)
  if (!parsed) return <FallbackChip label={label} />

  switch (parsed.kind) {
    case 'record':
      return <RecordChip recordId={parsed.id} label={label} />
    case 'thread':
      return <ThreadChip threadId={parsed.id} label={label} snapshot={asThreadSnapshot(snapshot)} />
    case 'task':
      return <TaskChip taskId={parsed.id} label={label} snapshot={asTaskSnapshot(snapshot)} />
    case 'doc':
      return <DocChip slug={parsed.id} label={label} snapshot={asDocSnapshot(snapshot)} />
    default:
      return <FallbackChip label={label} />
  }
}

function parseAuxxHref(
  href: string
): { kind: 'record' | 'thread' | 'task' | 'doc'; id: string } | null {
  if (!href.startsWith('auxx://')) return null
  const rest = href.slice('auxx://'.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx === -1) return null
  const kind = rest.slice(0, slashIdx)
  const id = rest.slice(slashIdx + 1)
  if (!id) return null
  if (kind !== 'record' && kind !== 'thread' && kind !== 'task' && kind !== 'doc') return null
  return { kind, id }
}

interface ChipProps {
  label: string
  icon?: LucideIcon
  className?: string
}

function ChipBody({ label, icon: Icon, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 align-baseline text-xs font-medium ring-1 ring-inset transition-colors',
        className
      )}>
      {Icon && (
        <span className='self-center'>
          <Icon className='size-3' />
        </span>
      )}
      <span className='truncate'>{label}</span>
    </span>
  )
}

function FallbackChip({ label }: { label: string }) {
  return <ChipBody label={label} className='bg-muted/50 text-foreground ring-border' />
}

// ===== Record =====

function RecordChip({ recordId, label }: { recordId: string; label: string }) {
  return (
    <RecordHoverCard recordId={recordId}>
      <span className='cursor-pointer'>
        <ChipBody
          label={label}
          className='bg-primary/10 text-primary ring-primary/20 hover:bg-primary/15'
        />
      </span>
    </RecordHoverCard>
  )
}

// ===== Thread =====

function asThreadSnapshot(
  snapshot: LinkSnapshot | undefined
):
  | { threadId: string; subject: string | null; sender?: string; lastMessageAt: string | null }
  | undefined {
  if (!snapshot || !('threadId' in snapshot)) return undefined
  return snapshot
}

function ThreadChip({
  threadId,
  label,
  snapshot,
}: {
  threadId: string
  label: string
  snapshot?: {
    threadId: string
    subject: string | null
    sender?: string
    lastMessageAt: string | null
  }
}) {
  const searchParams = useSearchParams()

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    window.history.pushState(null, '', `?${params.toString()}`)
  }

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button type='button' onClick={handleClick} className='inline-flex'>
          <ChipBody
            label={label}
            icon={Mail}
            className='bg-blue-500/10 text-blue-700 ring-blue-500/20 hover:bg-blue-500/15 dark:text-blue-300'
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className='w-72 p-3'>
        {snapshot ? (
          <div className='space-y-1'>
            <div className='font-medium text-sm'>{snapshot.subject ?? '(no subject)'}</div>
            {snapshot.sender && (
              <div className='text-muted-foreground text-xs'>{snapshot.sender}</div>
            )}
            {snapshot.lastMessageAt && (
              <div className='text-muted-foreground text-xs'>
                {formatDistanceToNowStrict(new Date(snapshot.lastMessageAt), {
                  addSuffix: true,
                })}
              </div>
            )}
          </div>
        ) : (
          <div className='text-muted-foreground text-xs'>Thread {threadId}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

// ===== Task =====

function asTaskSnapshot(
  snapshot: LinkSnapshot | undefined
):
  | { taskId: string; title: string; deadline: string | null; completedAt: string | null }
  | undefined {
  if (!snapshot || !('taskId' in snapshot)) return undefined
  return snapshot
}

function TaskChip({
  taskId,
  label,
  snapshot,
}: {
  taskId: string
  label: string
  snapshot?: { taskId: string; title: string; deadline: string | null; completedAt: string | null }
}) {
  const completed = !!snapshot?.completedAt
  const Icon = completed ? CheckCircle2 : CircleDot

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className='inline-flex cursor-default'>
          <ChipBody
            label={label}
            icon={Icon}
            className={cn(
              'ring-inset',
              completed
                ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
                : 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300'
            )}
          />
        </span>
      </HoverCardTrigger>
      <HoverCardContent className='w-72 p-3'>
        {snapshot ? (
          <div className='space-y-1'>
            <div className='font-medium text-sm'>{snapshot.title}</div>
            {snapshot.deadline && (
              <div className='text-muted-foreground text-xs'>
                Due {formatDistanceToNowStrict(new Date(snapshot.deadline), { addSuffix: true })}
              </div>
            )}
            {completed && snapshot.completedAt && (
              <Badge variant='outline' className='text-[10px] uppercase'>
                Completed
              </Badge>
            )}
          </div>
        ) : (
          <div className='text-muted-foreground text-xs'>Task {taskId}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

// ===== Doc =====

function asDocSnapshot(
  snapshot: LinkSnapshot | undefined
): { slug: string; title: string; description?: string; url?: string } | undefined {
  if (!snapshot || !('slug' in snapshot)) return undefined
  return snapshot
}

function DocChip({
  slug,
  label,
  snapshot,
}: {
  slug: string
  label: string
  snapshot?: { slug: string; title: string; description?: string; url?: string }
}) {
  const url = snapshot?.url
  const trigger = (
    <ChipBody
      label={label}
      icon={FileText}
      className='bg-violet-500/10 text-violet-700 ring-violet-500/20 hover:bg-violet-500/15 dark:text-violet-300'
    />
  )

  const triggerNode = url ? (
    <a href={url} target='_blank' rel='noreferrer' className='inline-flex'>
      {trigger}
    </a>
  ) : (
    <span className='inline-flex cursor-default'>{trigger}</span>
  )

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{triggerNode}</HoverCardTrigger>
      <HoverCardContent className='w-72 p-3'>
        {snapshot ? (
          <div className='space-y-1'>
            <div className='flex items-center gap-1 font-medium text-sm'>
              {snapshot.title}
              {url && <ExternalLink className='size-3 text-muted-foreground' />}
            </div>
            {snapshot.description && (
              <div className='line-clamp-3 text-muted-foreground text-xs'>
                {snapshot.description}
              </div>
            )}
          </div>
        ) : (
          <div className='text-muted-foreground text-xs'>Doc {slug}</div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
