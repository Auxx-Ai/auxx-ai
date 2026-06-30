// apps/web/src/components/data-connectors/ui/setup-streams-overview.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { Check, ChevronRight, CircleAlert, Table2 } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useResources } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import type { StreamReadiness } from '../hooks/use-setup-progress'
import { useConnectorDraftStore } from '../stores/connector-draft-store'
import { InstallOwnedDefs } from './install-owned-defs'
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
  // The number of draft-enabled streams — drives the "keep ≥1 enabled" guard so the
  // last remaining stream can't be toggled off (mirrors the backend nothing-to-sync guard).
  const enabledCount = useConnectorDraftStore(
    (s) => s.draft.streams.filter((st) => st.enabled).length
  )

  return (
    <div className='flex flex-col gap-1.5 px-1 py-1'>
      {/* App connector with owned record types not yet created — install them up front
          so the owned mappings bind to real defs (v6). Self-hides once all are bound. */}
      <InstallOwnedDefs connector={connector} />
      {streams.map((stream) => (
        <StreamOverviewRow
          key={stream.id}
          connector={connector}
          stream={stream}
          readiness={readinessById[stream.id] ?? 'needs-mapping'}
          enabledCount={enabledCount}
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
  enabledCount,
  expanded,
  onToggle,
}: {
  connector: Connector
  stream: Stream
  readiness: StreamReadiness
  enabledCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const { getResourceById } = useResources()
  // Reflect the buffered draft so the toggle reacts live and the gate (which reads
  // `enabled` off the draft) updates as the user flips streams (§3.1.E).
  const setStreamEnabled = useConnectorDraftStore((s) => s.setStreamEnabled)
  const draftEnabled = useConnectorDraftStore(
    (s) => s.draft.streams.find((d) => d.id === stream.id)?.enabled ?? stream.enabled
  )
  // Keep ≥1 stream enabled — the off-toggle on the last enabled stream is locked.
  const isLastEnabled = draftEnabled && enabledCount <= 1

  const defLabels = stream.mappings
    .map((m) => (m.entityDefinitionId ? getResourceById(m.entityDefinitionId)?.label : null))
    .filter(Boolean) as string[]

  // The Switch renders its own <button>, so it can't nest inside the row's expand
  // <button> (invalid DOM). Keep them siblings in a flex container instead.
  const toggle = (
    <Switch
      size='xs'
      checked={draftEnabled}
      disabled={isLastEnabled}
      onCheckedChange={(enabled) => setStreamEnabled(stream.id, enabled)}
    />
  )

  return (
    <div className={cn('rounded-lg border bg-background', !draftEnabled && 'opacity-60')}>
      <div className='flex items-center gap-3 px-3 py-2.5'>
        <button
          type='button'
          onClick={onToggle}
          className='flex min-w-0 flex-1 items-center gap-3 text-left'>
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
        </button>
        {!draftEnabled ? (
          <Badge variant='outline' size='sm' className='shrink-0 text-muted-foreground'>
            Off
          </Badge>
        ) : readiness === 'ready' ? (
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
        {isLastEnabled ? (
          <Tooltip content='At least one stream must stay enabled.'>
            <span className='shrink-0'>{toggle}</span>
          </Tooltip>
        ) : (
          <span className='shrink-0'>{toggle}</span>
        )}
      </div>

      {expanded && draftEnabled && (
        <div className='border-t px-1 pb-1'>
          <StreamConfigPanel connector={connector} stream={stream} view='map' scroll={false} />
        </div>
      )}
    </div>
  )
}
