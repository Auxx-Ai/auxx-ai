// apps/web/src/components/data-connectors/ui/connector-removed-upstream-list.tsx
'use client'

import { LastUpdated } from '@auxx/ui/components/last-updated'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Archive, Check, Unplug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getRecordLink, toRecordId, useResources } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'

type RemovedUpstreamItem = RouterOutputs['dataConnector']['listRemovedUpstream'][number]

interface ConnectorRemovedUpstreamSectionProps {
  connectorId: string
  /** The connector's display name, for the confirm copy. */
  connectorName: string
}

/**
 * "Gone upstream" (v12.1 Phase 5b): the records whose upstream copy the last crawl
 * could not find and which the connector left live for a human to decide
 * (`mark_deleted`, or an `archive` the mint degrade softened). Renders nothing until
 * there is something to decide. Each row links to the record and offers the two
 * answers: archive it, or keep it as a record of its own (which unbinds it, so the
 * next crawl cannot flag it again).
 */
export function ConnectorRemovedUpstreamSection({
  connectorId,
  connectorName,
}: ConnectorRemovedUpstreamSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const list = api.dataConnector.listRemovedUpstream.useQuery({ id: connectorId })
  const rows = list.data ?? []

  const refresh = () => {
    void utils.dataConnector.listRemovedUpstream.invalidate({ id: connectorId })
    void utils.dataConnector.getStatus.invalidate({ id: connectorId })
  }
  const archiveRecord = api.dataConnector.archiveRemovedUpstream.useMutation({
    onSuccess: refresh,
    onError: (e) => toastError({ title: 'Could not archive record', description: e.message }),
  })
  const keepRecord = api.dataConnector.keepRemovedUpstream.useMutation({
    onSuccess: refresh,
    onError: (e) => toastError({ title: 'Could not keep record', description: e.message }),
  })
  // The row whose action is in flight; both buttons on it disable.
  const busyItemId = archiveRecord.isPending
    ? archiveRecord.variables?.itemId
    : keepRecord.isPending
      ? keepRecord.variables?.itemId
      : null

  if (rows.length === 0) return null

  const labelOf = (item: RemovedUpstreamItem) => item.displayName ?? item.externalId

  const handleArchive = async (item: RemovedUpstreamItem) => {
    const ok = await confirm({
      title: `Archive "${labelOf(item)}"?`,
      description:
        'The upstream record is gone. Archiving hides this record across Auxx. Do this ' +
        'only if it was really deleted at the source.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) archiveRecord.mutate({ id: connectorId, itemId: item.id })
  }

  const handleKeep = async (item: RemovedUpstreamItem) => {
    const ok = await confirm({
      title: `Keep "${labelOf(item)}"?`,
      description:
        `The record stays exactly as it is, but ${connectorName} stops syncing it: the ` +
        'link to the upstream record is removed, so future syncs neither update nor ' +
        'archive it.',
      confirmText: 'Keep record',
      cancelText: 'Cancel',
    })
    if (ok) keepRecord.mutate({ id: connectorId, itemId: item.id })
  }

  return (
    <Section
      title='Gone upstream'
      icon={<Unplug className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      collapsible={false}
      description='Records the last sync could not find at the source. Archive each one, or keep it as a record of its own.'>
      <ConfirmDialog />
      {rows.map((item) => (
        <RemovedUpstreamRow
          key={item.id}
          item={item}
          busy={busyItemId === item.id}
          onArchive={() => void handleArchive(item)}
          onKeep={() => void handleKeep(item)}
        />
      ))}
    </Section>
  )
}

function RemovedUpstreamRow({
  item,
  busy,
  onArchive,
  onKeep,
}: {
  item: RemovedUpstreamItem
  busy: boolean
  onArchive: () => void
  onKeep: () => void
}) {
  const router = useRouter()
  const { getResourceById } = useResources()
  const resource = getResourceById(item.entityDefinitionId)
  const href = resource
    ? getRecordLink(toRecordId(item.entityDefinitionId, item.entityInstanceId), resource)
    : null

  return (
    <TreeRow
      icon={<Unplug className='size-4' />}
      title={item.displayName ?? item.externalId}
      description={`Upstream id ${item.externalId}`}
      secondary={
        <span className='flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground'>
          {resource?.label ?? null}
          <LastUpdated timestamp={item.removedUpstreamAt} prefix='Flagged' />
        </span>
      }
      onToggleOpen={href ? () => router.push(href) : undefined}
      rowClassName={href ? 'cursor-pointer hover:bg-primary-100' : 'hover:bg-primary-100'}
      actions={
        <div className='flex items-center gap-1'>
          <TreeRowButton tooltipText='Keep record' disabled={busy} onClick={onKeep}>
            <Check />
          </TreeRowButton>
          <TreeRowButton
            variant='destructive'
            tooltipText='Archive record'
            disabled={busy}
            onClick={onArchive}>
            <Archive />
          </TreeRowButton>
        </div>
      }
    />
  )
}
