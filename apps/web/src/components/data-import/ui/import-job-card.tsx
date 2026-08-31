// apps/web/src/components/data-import/ui/import-job-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { formatRelativeTime } from '@auxx/utils/date'
import { Columns, MoreVertical, Rows3 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useResources } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'

type ImportJob = RouterOutputs['dataImport']['listJobs'][number]

/**
 * Status badge variant.
 *
 * `completed_with_errors` must never share `default` with `completed`: a run
 * that lost rows and one that did not are the two states this list exists to
 * tell apart.
 */
function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default'
    case 'completed_with_errors':
      return 'outline'
    case 'failed':
    case 'canceled':
      return 'destructive'
    case 'executing':
      return 'secondary'
    default:
      return 'outline'
  }
}

/** Human-readable status label — the raw enum value is not a UI string. */
function statusLabel(status: string): string {
  return status === 'completed_with_errors' ? 'completed with errors' : status
}

interface ImportJobCardProps {
  job: ImportJob
  /** Delete the import job (confirmed by the caller). */
  onDelete: () => void
}

/**
 * One past import job as a full-width horizontal row: entity icon, filename + resource
 * badge, "created by / columns / rows" meta, a status badge, and a Delete menu. Clicking
 * the row reopens the import wizard at the correct step.
 */
export function ImportJobCard({ job, onDelete }: ImportJobCardProps) {
  const router = useRouter()
  const { getResourceById } = useResources()

  const entityDefinitionId = job.importMapping.entityDefinitionId
  const resource = getResourceById(entityDefinitionId)
  const createdByName = job.createdBy?.name || job.createdBy?.email || 'Unknown'

  /** Import base path for the target resource. */
  const basePath = resource?.entityType
    ? `/app/${resource.apiSlug}`
    : resource
      ? `/app/custom/${resource.apiSlug}`
      : entityDefinitionId.length > 20
        ? `/app/custom/${entityDefinitionId}`
        : '/app'

  return (
    <div
      className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer'
      onClick={() => router.push(`${basePath}/import/${job.id}`)}>
      {/* Left: icon + info */}
      <div className='flex flex-row items-center gap-3'>
        <EntityIcon iconId={resource?.icon ?? 'file'} variant='muted' />

        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-medium'>{job.sourceFileName}</span>
            <Badge variant='outline' className='text-xs'>
              {resource?.plural ?? entityDefinitionId}
            </Badge>
          </div>

          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <span>
              Created by {createdByName} {formatRelativeTime(job.createdAt)}
            </span>
            <span className='text-muted-foreground/50'>|</span>
            <span className='flex items-center gap-1'>
              <Columns className='size-3' />
              {job.columnCount}
            </span>
            <span className='flex items-center gap-1'>
              <Rows3 className='size-3' />
              {job.rowCount}
            </span>
          </div>
        </div>
      </div>

      {/* Right: status + actions */}
      <div className='flex items-center gap-2'>
        <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>

        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant='ghost' size='icon-sm'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              variant='destructive'
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}>
              Delete Import
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
