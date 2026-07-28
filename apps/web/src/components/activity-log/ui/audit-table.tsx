// apps/web/src/components/activity-log/ui/audit-table.tsx
// Dense, monospace, sticky-header audit table with cursor-driven "Load More",
// mirroring the App Logs page. Parameterized by a `columns` flag that toggles the
// super-admin-only Organization + Visibility columns. Renders three states:
// rows / loading / empty — same anatomy as the logs page.

'use client'

import { toActorId } from '@auxx/types/actor'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { format } from 'date-fns'
import { Bot, Cog, FileSearch, KeyRound, Plug } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { LoadingSpinner } from '~/components/global/loading-content'
import { ActorBadge, actorBadgeVariants } from '~/components/resources/ui/actor-badge'
import type { AuditLogRow } from '../types'
import { getCategoryBadge } from './audit-badges'

/** Fallback display for actor types that have no resolvable ActorId form. */
const ACTOR_FALLBACK: Record<string, { icon: typeof Cog; label: string }> = {
  admin: { icon: Cog, label: 'Support' },
  api: { icon: KeyRound, label: 'API' },
  integration: { icon: Plug, label: 'Integration' },
}

/**
 * Renders a row's actor. `user`/`system` resolve to <ActorBadge> (name + avatar);
 * `admin`/`api`/`integration` (and null) have no ActorId form, so they render as a
 * labeled icon badge.
 */
function AuditActor({ row }: { row: AuditLogRow }) {
  const resolvable = row.actorType === 'user' || row.actorType === 'system'

  if (resolvable && row.actorId) {
    return (
      <div className='inline-flex items-center max-w-full'>
        <ActorBadge actorId={toActorId('user', row.actorId)} size='sm' />
      </div>
    )
  }

  const fallback = ACTOR_FALLBACK[row.actorType] ?? { icon: Bot, label: row.actorType }
  const Icon = fallback.icon
  return (
    <div className='inline-flex items-center max-w-full'>
      <div className={actorBadgeVariants({ size: 'sm' })}>
        <Avatar className='size-3' data-slot='actor-icon'>
          <AvatarFallback className='bg-neutral-200 dark:bg-neutral-700'>
            <Icon data-slot='actor-fallback-icon' />
          </AvatarFallback>
        </Avatar>
        <span data-slot='actor-display'>{fallback.label}</span>
      </div>
    </div>
  )
}

interface AuditTableProps {
  rows: AuditLogRow[]
  isLoading: boolean
  /** Whether the next page is currently being fetched (drives the Load More spinner). */
  isLoadingMore?: boolean
  hasMore: boolean
  onLoadMore: () => void
  /** `'org'` hides the Organization + Visibility columns; `'admin'` shows them. */
  columns: 'org' | 'admin'
  /** Drives the empty-state copy (search vs. no-events). */
  hasActiveSearch?: boolean
  onRowClick?: (row: AuditLogRow) => void
}

/** Shorten an id to its last 6 chars for dense display. */
function shortId(id: string | null) {
  return id ? `…${id.slice(-6)}` : '—'
}

export function AuditTable({
  rows,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  columns,
  hasActiveSearch,
  onRowClick,
}: AuditTableProps) {
  const isAdmin = columns === 'admin'

  if (rows.length === 0) {
    if (isLoading) return <LoadingSpinner />
    return (
      <EmptyState
        icon={FileSearch}
        title='No events found'
        description={
          hasActiveSearch
            ? 'No loaded events match your search. Try clearing the search or widening the date range.'
            : 'No audit events for the selected filters. Try expanding the date range.'
        }
      />
    )
  }

  return (
    <div className='flex flex-col flex-1 overflow-auto w-full'>
      <table
        className={`caption-bottom text-sm table-fixed w-full ${
          isAdmin ? 'min-w-[1240px]' : 'min-w-[1040px]'
        }`}>
        <TableHeader className='sticky top-0 bg-background z-10'>
          <TableRow>
            <TableHead className='w-[300px]'>When</TableHead>
            {isAdmin && <TableHead className='w-[110px]'>Org</TableHead>}
            <TableHead className='w-[220px]'>Action</TableHead>
            <TableHead className='w-[160px]'>Actor</TableHead>
            <TableHead className='min-w-[240px]'>Target</TableHead>
            <TableHead className='w-[120px]'>IP</TableHead>
            {isAdmin && <TableHead className='w-[90px]'>Visibility</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const badge = getCategoryBadge(row.category)
            return (
              <TableRow
                key={row.id}
                className={onRowClick ? 'cursor-pointer' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}>
                <TableCell className='font-mono text-xs'>
                  <div className='flex items-center gap-2'>
                    <Badge variant={badge.variant} size='xs' className='shrink-0'>
                      {badge.label}
                    </Badge>
                    <span className='whitespace-nowrap'>
                      {format(new Date(row.createdAt), 'MMM dd, HH:mm:ss')}
                    </span>
                  </div>
                </TableCell>
                {isAdmin && (
                  <TableCell className='font-mono text-xs text-muted-foreground w-[110px]'>
                    {row.organizationId ? shortId(row.organizationId) : 'Platform'}
                  </TableCell>
                )}
                <TableCell className='font-mono text-xs w-[220px]'>
                  <div className='break-words'>{row.action}</div>
                </TableCell>
                <TableCell className='w-[160px] overflow-hidden'>
                  <AuditActor row={row} />
                </TableCell>
                <TableCell className='font-mono text-xs overflow-hidden'>
                  <div className='break-words'>
                    {row.targetType ? (
                      <>
                        <span className='text-muted-foreground'>{row.targetType}</span>{' '}
                        {shortId(row.targetId)}
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                </TableCell>
                <TableCell className='font-mono text-xs text-muted-foreground w-[120px]'>
                  {row.ipAddress ?? '—'}
                </TableCell>
                {isAdmin && (
                  <TableCell className='w-[90px]'>
                    <Badge variant={row.visibility === 'internal' ? 'amber' : 'zinc'} size='xs'>
                      {row.visibility}
                    </Badge>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </table>

      {hasMore && (
        <div className='flex justify-center py-4'>
          <Button
            variant='outline'
            onClick={onLoadMore}
            loading={isLoadingMore}
            loadingText='Loading…'>
            Load More
          </Button>
        </div>
      )}
    </div>
  )
}
