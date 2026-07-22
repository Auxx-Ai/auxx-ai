// apps/web/src/components/data-export/ui/export-job-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  ListCard,
  type ListCardMenuItem,
  type ListCardStatusTone,
  renderBadgeChips,
} from '@auxx/ui/components/list-card'
import { toastError } from '@auxx/ui/components/toast'
import { formatRelativeTime } from '@auxx/utils/date'
import { formatBytes } from '@auxx/utils/file'
import { Ban, Download, HardDrive, Rows3, Trash } from 'lucide-react'
import { useResources } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

type ExportJob = RouterOutputs['dataExport']['list'][number]

interface ExportJobCardProps {
  job: ExportJob
  /** Delete the export job + its stored file (confirmed by the caller). */
  onDelete: () => void
  /** Cancel a still-running export. */
  onCancel: () => void
}

/** Export status → semantic {@link ListCardStatusTone}. */
function statusTone(status: ExportJob['status']): ListCardStatusTone {
  switch (status) {
    case 'completed':
      return 'good'
    case 'failed':
      return 'error'
    case 'canceled':
      return 'muted'
    case 'processing':
      return 'info'
    default:
      return 'muted'
  }
}

const EXPORT_TYPE_LABEL: Record<string, string> = {
  view: 'Current view',
  all: 'All records',
  selection: 'Selected records',
}

/**
 * One export job rendered with the shared {@link ListCard}. Completed jobs download on
 * click (presigned S3 URL) and expose Download / Delete; in-flight jobs animate their
 * processed/total counters and expose Cancel. See plans/exporter/04-history-page-plan.md.
 */
export function ExportJobCard({ job, onDelete, onCancel }: ExportJobCardProps) {
  const { getResourceById } = useResources()
  const getDownloadUrl = api.dataExport.getDownloadUrl.useMutation()

  const resource = getResourceById(job.entityDefinitionId)
  const isRunning = job.status === 'pending' || job.status === 'processing'
  const title = job.fileName ?? `${resource?.plural ?? 'Records'} export`

  const handleDownload = async () => {
    try {
      const { url } = await getDownloadUrl.mutateAsync({ id: job.id })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (error) {
      toastError({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Could not get download link',
      })
    }
  }

  const menuItems: ListCardMenuItem[] =
    job.status === 'completed'
      ? [
          { label: 'Download', icon: <Download />, onClick: () => void handleDownload() },
          { label: 'Delete', icon: <Trash />, onClick: onDelete, destructive: true },
        ]
      : isRunning
        ? [{ label: 'Cancel', icon: <Ban />, onClick: onCancel, destructive: true }]
        : [{ label: 'Delete', icon: <Trash />, onClick: onDelete, destructive: true }]

  const badges = isRunning
    ? renderBadgeChips([
        {
          icon: <Rows3 className='size-3' />,
          label: `${job.processedRecords.toLocaleString()} / ${job.totalRecords.toLocaleString()}`,
        },
      ])
    : renderBadgeChips([
        { icon: <Rows3 className='size-3' />, label: job.totalRecords.toLocaleString() },
        ...(job.fileSizeBytes
          ? [{ icon: <HardDrive className='size-3' />, label: formatBytes(job.fileSizeBytes) }]
          : []),
      ])

  return (
    <ListCard
      icon={<EntityIcon iconId={resource?.icon ?? 'file'} variant='muted' />}
      title={title}
      subtitle={`${EXPORT_TYPE_LABEL[job.exportType] ?? job.exportType} · ${formatRelativeTime(job.createdAt)}`}
      status={{ tone: statusTone(job.status), label: job.status }}
      headerEnd={
        job.format === 'pdf' ? (
          <Badge size='xs' variant='violet'>
            PDF
          </Badge>
        ) : undefined
      }
      badges={badges}
      menuItems={menuItems}
      onClick={job.status === 'completed' ? () => void handleDownload() : undefined}
    />
  )
}
