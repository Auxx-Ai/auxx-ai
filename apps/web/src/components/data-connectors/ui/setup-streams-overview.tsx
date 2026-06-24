// apps/web/src/components/data-connectors/ui/setup-streams-overview.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronRight, CircleAlert, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useResources } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import type { StreamReadiness } from '../hooks/use-setup-progress'
import { StreamConfigPanel } from './stream-config-panel'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

interface SetupStreamsOverviewProps {
  connector: Connector
  streams: Stream[]
  /** Per-stream readiness (drives the row badge), keyed by stream id. */
  readinessById: Record<string, StreamReadiness>
}

/**
 * The Map step body — a multi-stream overview (multi-stream-setup-plan §3). Lists
 * EVERY stream an app/template connector ships (not just `streams[0]`), each with its
 * target defs and a readiness badge, each expandable in place into the existing
 * `StreamConfigPanel view='map'` — so the user sees the full scope of what they're
 * about to sync and can finish a stranded contributing mapping inline. One row open at
 * a time; the stepper supplies the surrounding scroll + back-affordance.
 */
export function SetupStreamsOverview({
  connector,
  streams,
  readinessById,
}: SetupStreamsOverviewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className='flex flex-col gap-1.5 px-1 py-1'>
      {streams.map((stream) => (
        <StreamOverviewRow
          key={stream.id}
          connector={connector}
          stream={stream}
          readiness={readinessById[stream.id] ?? 'needs-mapping'}
          expanded={expandedId === stream.id}
          onToggle={() => setExpandedId((id) => (id === stream.id ? null : stream.id))}
        />
      ))}
    </div>
  )
}

function StreamOverviewRow({
  connector,
  stream,
  readiness,
  expanded,
  onToggle,
}: {
  connector: Connector
  stream: Stream
  readiness: StreamReadiness
  expanded: boolean
  onToggle: () => void
}) {
  const { getResourceById } = useResources()
  const defLabels = stream.mappings
    .map((m) => (m.entityDefinitionId ? getResourceById(m.entityDefinitionId)?.label : null))
    .filter(Boolean) as string[]

  return (
    <div className='rounded-lg border bg-background'>
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-center gap-3 px-3 py-2.5 text-left'>
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <Table2 className='size-4 shrink-0 text-muted-foreground' />
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm font-medium'>
            {stream.streamKey ?? 'Untitled stream'}
          </span>
          <span className='truncate text-xs text-muted-foreground'>
            {defLabels.length > 0 ? `→ ${defLabels.join(' · ')}` : 'no targets yet'}
          </span>
        </div>
        {readiness === 'ready' ? (
          <Badge variant='outline' size='sm' className='shrink-0'>
            <Check />
            Ready
          </Badge>
        ) : (
          <Badge variant='amber' size='sm' className='shrink-0'>
            <CircleAlert />
            Needs mapping
          </Badge>
        )}
      </button>

      {expanded && (
        <div className='border-t px-1 pb-1'>
          <StreamConfigPanel connector={connector} stream={stream} view='map' scroll={false} />
        </div>
      )}
    </div>
  )
}
