// apps/web/src/components/sequences/ui/list/sequence-card.tsx
'use client'

import type { SequenceStatus } from '@auxx/lib/sequences/client'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { ListCard } from '@auxx/ui/components/list-card'
import { FileText, SendHorizonal, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '~/hooks/use-confirm'
import { SEQUENCE_STATUS_META } from './sequence-status-meta'

/** A sequence row as returned by `sequence.list`. */
export interface SequenceCardData {
  id: string
  name: string
  description?: string | null
  status: SequenceStatus
  publishedAt: Date | string | null
  hasUnpublishedChanges: boolean
  createdAt: Date | string
  updatedAt: Date | string
}

interface SequenceCardProps {
  sequence: SequenceCardData
  onDelete: (id: string) => void
}

/**
 * A single sequence card in the list grid — mirrors `ConnectorCard`'s shape
 * (status dot + badge, last-updated subtitle, Open/Delete menu). Links into
 * the sequence detail route on click.
 */
export function SequenceCard({ sequence, onDelete }: SequenceCardProps) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const meta = SEQUENCE_STATUS_META[sequence.status]
  const href = `/app/workflows/sequences/${sequence.id}`
  const open = () => router.push(href)

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete sequence?',
      description:
        'This deletes the sequence and its steps. Sequences with active runs cannot be deleted until those runs exit.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) onDelete(sequence.id)
  }

  const wrap = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <>
      <ConfirmDialog />
      <ListCard
        href={href}
        ariaLabel={sequence.name}
        title={sequence.name}
        icon={<SendHorizonal className='size-4' />}
        status={{ tone: meta.tone, label: meta.label }}
        subtitle={<LastUpdated timestamp={sequence.updatedAt} prefix='Updated' />}
        description={sequence.description ?? undefined}
        descriptionLines={sequence.description ? 1 : 0}
        badges={
          <>
            <Badge variant={meta.badgeVariant} size='sm' className='shrink-0'>
              {meta.label}
            </Badge>
            {sequence.hasUnpublishedChanges && sequence.publishedAt && (
              <Badge variant='outline' size='sm' className='shrink-0'>
                Unpublished changes
              </Badge>
            )}
          </>
        }
        menu={
          <>
            <DropdownMenuItem onClick={wrap(open)}>
              <FileText />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem variant='destructive' onClick={wrap(() => void handleDelete())}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        }
      />
    </>
  )
}

/** Fallback icon for empty states / placeholders. */
export const SequenceFallbackIcon = SendHorizonal
