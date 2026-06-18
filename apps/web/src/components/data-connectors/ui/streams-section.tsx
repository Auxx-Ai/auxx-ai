// apps/web/src/components/data-connectors/ui/streams-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import TreeRow from '@auxx/ui/components/tree-row'
import { Layers, Plus, Table2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { useTargetDefs } from '../hooks/use-target-defs'
import { AddStreamDialog } from './add-stream-dialog'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>
type Stream = NonNullable<ReturnType<typeof api.dataConnector.listStreams.useQuery>['data']>[number]

interface StreamsSectionProps {
  connector: Connector
  /** Drill into a stream's config panel (NavStack push). */
  onSelect: (streamId: string) => void
}

/** Row summarizing one fetch + the defs it lands in. */
function StreamRow({ stream, onSelect }: { stream: Stream; onSelect: () => void }) {
  const { byId } = useTargetDefs()
  const mappings = api.dataConnector.listMappings.useQuery({ streamId: stream.id })
  const defLabels = (mappings.data ?? [])
    .map((m) => byId.get(m.entityDefinitionId)?.label)
    .filter(Boolean) as string[]

  return (
    <TreeRow
      icon={<Table2 className='size-4' />}
      title={stream.streamKey}
      secondary={defLabels.length > 0 ? `→ ${defLabels.join(' · ')}` : 'no targets yet'}
      onToggleOpen={onSelect}
      rowClassName='cursor-pointer'
    />
  )
}

/**
 * Streams section — the list of fetches (each fans out to N target defs). A
 * `Section` (scroll-spy primitive) with Add in `actions`; Add forks by connector
 * kind: catalog → declared-stream picker; generic-rest → blank named stream. Each
 * row drills into the stream config panel. See plans/data-connectors/claude/05-frontend.md §4.
 */
export function StreamsSection({ connector, onSelect }: StreamsSectionProps) {
  const [addOpen, setAddOpen] = useState(false)
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

  return (
    <Section
      title='Streams'
      icon={<Layers className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      collapsible={false}
      description='Each stream is one fetch that maps to one or more entity definitions.'
      actions={
        <Button variant='ghost' size='xs' onClick={() => setAddOpen(true)}>
          <Plus />
          Add stream
        </Button>
      }>
      {streams.isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : rows.length === 0 ? (
        <div className='px-3 py-2'>
          <EmptySection
            icon={<Layers className='size-5' />}
            title='No streams yet'
            description='Add a stream to fetch records and map them into your entities.'
          />
        </div>
      ) : (
        <div className='flex flex-col ps-2 pe-4'>
          {rows.map((stream) => (
            <StreamRow key={stream.id} stream={stream} onSelect={() => onSelect(stream.id)} />
          ))}
        </div>
      )}

      <AddStreamDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        connector={connector}
        onCreate={(streamKey) => addStream.mutate({ id: connector.id, streamKey })}
        creating={addStream.isPending}
      />
    </Section>
  )
}
