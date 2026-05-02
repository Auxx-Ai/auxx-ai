// apps/web/src/components/kopilot/ui/messages/auxx-inline-link.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { isActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@auxx/ui/components/hover-card'
import { cn } from '@auxx/ui/lib/utils'
import { ExternalLink, FileText, type LucideIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { TaskBadge } from '~/components/tasks/ui/task-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'
import type { LinkSnapshot } from '../../stores/kopilot-store'

interface AuxxInlineLinkProps {
  href: string
  label: string
  /** Resolved snapshot from message.linkSnapshots */
  snapshot?: LinkSnapshot
}

/**
 * Inline `auxx://` chip rendered for `[label](auxx://...)` markdown links in
 * assistant messages. Each kind (record/thread/task/actor/doc) gets its own
 * click behavior + hover preview, all driven from the per-message
 * `linkSnapshots` map populated server-side.
 */
export function AuxxInlineLink({ href, label, snapshot }: AuxxInlineLinkProps) {
  const parsed = parseAuxxHref(href)
  if (!parsed) return <FallbackChip label={label} />

  switch (parsed.kind) {
    case 'record':
      return <RecordChip recordId={parsed.id as RecordId} />
    case 'thread':
      return <ThreadChip threadId={parsed.id} />
    case 'task':
      return <TaskChip taskId={parsed.id} />
    case 'actor':
      return isActorId(parsed.id) ? (
        <ActorChip actorId={parsed.id} />
      ) : (
        <FallbackChip label={label} />
      )
    case 'doc':
      return <DocChip slug={parsed.id} label={label} snapshot={asDocSnapshot(snapshot)} />
    default:
      return <FallbackChip label={label} />
  }
}

function parseAuxxHref(
  href: string
): { kind: 'record' | 'thread' | 'task' | 'doc' | 'actor'; id: string } | null {
  if (!href.startsWith('auxx://')) return null
  const rest = href.slice('auxx://'.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx === -1) return null
  const kind = rest.slice(0, slashIdx)
  const rawId = rest.slice(slashIdx + 1)
  if (!rawId) return null
  if (
    kind !== 'record' &&
    kind !== 'thread' &&
    kind !== 'task' &&
    kind !== 'doc' &&
    kind !== 'actor'
  )
    return null
  return { kind, id: normalizeId(kind, rawId) }
}

/**
 * Lenient id normalization to absorb the model emitting an extra prefix
 * segment.
 *
 * Observed model mistake (gpt-5.4-nano):
 *   `auxx://record/contacts:<defId>:<instId>`
 * The model prepends the entity slug (`contacts`, `companies`, …) before the
 * real `<defId>:<instId>` pair. We strip it by keeping the last two
 * colon-separated segments — the canonical RecordId shape.
 *
 * Same idea for actors: `auxx://actor/<workspace>:user:<id>` collapses to
 * `user:<id>` if the trailing two segments form a valid actor type+id pair.
 *
 * Other kinds carry single-segment ids and are passed through untouched.
 */
function normalizeId(kind: string, id: string): string {
  if (kind === 'record') {
    const parts = id.split(':')
    if (parts.length > 2) return parts.slice(-2).join(':')
    return id
  }
  if (kind === 'actor') {
    const parts = id.split(':')
    if (parts.length > 2) {
      const last = parts[parts.length - 1]!
      // Pick the rightmost user/group marker to anchor the id.
      for (let i = parts.length - 2; i >= 0; i--) {
        const seg = parts[i]
        if (seg === 'user' || seg === 'group') return `${seg}:${last}`
      }
    }
    return id
  }
  return id
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

function RecordChip({ recordId }: { recordId: RecordId }) {
  return (
    <span className='inline-flex align-baseline'>
      <RecordBadge recordId={recordId} variant='link' link={true} size='sm' />
    </span>
  )
}

// ===== Thread =====

function ThreadChip({ threadId }: { threadId: string }) {
  const searchParams = useSearchParams()

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    params.set('threadId', threadId)
    window.history.pushState(null, '', `?${params.toString()}`)
  }

  return (
    <button type='button' onClick={handleClick} className='inline-flex align-baseline'>
      <ThreadBadge threadId={threadId} variant='link' size='sm' />
    </button>
  )
}

// ===== Task =====

function TaskChip({ taskId }: { taskId: string }) {
  return (
    <span className='inline-flex align-baseline'>
      <TaskBadge taskId={taskId} size='sm' />
    </span>
  )
}

// ===== Actor =====

function ActorChip({ actorId }: { actorId: ActorId }) {
  return (
    <span className='inline-flex align-baseline'>
      <ActorBadge actorId={actorId} variant='link' size='sm' />
    </span>
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
