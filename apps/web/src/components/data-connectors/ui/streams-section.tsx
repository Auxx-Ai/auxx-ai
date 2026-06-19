// apps/web/src/components/data-connectors/ui/streams-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Layers, Plus, Table2, Trash2 } from 'lucide-react'
import { useResources } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>
type Stream = NonNullable<ReturnType<typeof api.dataConnector.listStreams.useQuery>['data']>[number]

interface StreamsSectionProps {
  connector: Connector
  /** Drill into a stream's config panel (NavStack push). */
  onSelect: (streamId: string) => void
}

/** Row summarizing one fetch + the defs it lands in. */
function StreamRow({
  stream,
  onSelect,
  onDelete,
}: {
  stream: Stream
  onSelect: () => void
  onDelete: () => void
}) {
  const { getResourceById } = useResources()
  const defLabels = stream.mappings
    .map((m) => (m.entityDefinitionId ? getResourceById(m.entityDefinitionId)?.label : null))
    .filter(Boolean) as string[]

  return (
    <TreeRow
      icon={<Table2 className='size-4' />}
      title={stream.streamKey ?? 'Untitled stream'}
      secondary={defLabels.length > 0 ? `→ ${defLabels.join(' · ')}` : 'no targets yet'}
      onToggleOpen={onSelect}
      rowClassName='cursor-pointer'
      trailing={
        <TreeRowButton variant='destructive' tooltipText='Delete stream' onClick={onDelete}>
          <Trash2 />
        </TreeRowButton>
      }
    />
  )
}

/**
 * Streams section — the list of fetches (each fans out to N target defs). A
 * `Section` (scroll-spy primitive) with Add in `actions`; Add creates a blank,
 * unnamed stream and drills straight into its config panel (named inline in the
 * detail bar — mirrors the agent Procedures section). Each row drills into the
 * stream config panel. See plans/data-connectors/claude/05-frontend.md §4.
 */
export function StreamsSection({ connector, onSelect }: StreamsSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const rows = streams.data ?? []

  const addStream = api.dataConnector.addStream.useMutation({
    onSuccess: (stream) => {
      void utils.dataConnector.listStreams.invalidate({ id: connector.id })
      onSelect(stream.id)
    },
    onError: (e) => toastError({ title: 'Could not add stream', description: e.message }),
  })

  const removeStream = api.dataConnector.removeStream.useMutation({
    onSuccess: () => void utils.dataConnector.listStreams.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not delete stream', description: e.message }),
  })

  const handleDelete = async (stream: Stream) => {
    const confirmed = await confirm({
      title: `Delete stream "${stream.streamKey ?? 'Untitled stream'}"?`,
      description:
        'This removes the stream and all its mappings. Synced records stay in your entities but stop updating. This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeStream.mutate({ streamId: stream.id })
  }

  return (
    <Section
      title='Streams'
      icon={<Layers className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      collapsible={false}
      description='Each stream is one fetch that maps to one or more entity definitions.'
      actions={
        <Button
          variant='ghost'
          size='xs'
          loading={addStream.isPending}
          onClick={() => addStream.mutate({ id: connector.id })}>
          <Plus />
          Add stream
        </Button>
      }>
      {streams.isLoading ? (
        <EmptySection title='Loading... streams' loading className='mx-3' />
      ) : rows.length === 0 ? (
        <div className='px-3 py-2'>
          <EmptySection
            icon={<Layers />}
            title='No streams yet'
            description='Add a stream to fetch records and map them into your entities.'
          />
        </div>
      ) : (
        <div className='flex flex-col ps-2 pe-4'>
          {rows.map((stream) => (
            <StreamRow
              key={stream.id}
              stream={stream}
              onSelect={() => onSelect(stream.id)}
              onDelete={() => void handleDelete(stream)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog />
    </Section>
  )
}
