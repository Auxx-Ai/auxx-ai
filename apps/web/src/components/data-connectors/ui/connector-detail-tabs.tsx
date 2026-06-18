// apps/web/src/components/data-connectors/ui/connector-detail-tabs.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  NavStack,
  NavStackBar,
  NavStackPanel,
  NavStackPanels,
  useNavStack,
} from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { ChevronLeft, ChevronRight, Clock, Layers, Plug } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useScrollSpy } from '~/hooks/use-scroll-spy'
import { api } from '~/trpc/react'
import { useSourcePaths } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { ConnectionSection } from './connection-section'
import { FieldCalcPanel } from './field-calc-panel'
import { ScheduleSection } from './schedule-section'
import { SourceConfigPanel } from './source-config-panel'
import { StreamConfigPanel } from './stream-config-panel'
import { StreamsSection } from './streams-section'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

const CONNECTOR_TABS = ['connection', 'streams', 'schedule'] as const
type ConnectorTab = (typeof CONNECTOR_TABS)[number]

const TAB_LABELS: Record<ConnectorTab, string> = {
  connection: 'Connection',
  streams: 'Streams',
  schedule: 'Schedule',
}
const TAB_ICONS: Record<ConnectorTab, React.ComponentType<{ className?: string }>> = {
  connection: Plug,
  streams: Layers,
  schedule: Clock,
}

const SPY_BUFFER = 8
const SCROLL_BUFFER = 0

/**
 * Shared-bar content for a pushed drill level (`source` / `stream` / `field`).
 * Carries the iOS-style back affordance — a `ChevronLeft` that pops the stack,
 * plus an optional back-crumb to the parent level — mirroring the agent
 * `ProcedureDetailBar`. Rendered by `<NavStackBar>`, so it lives inside the
 * `<NavStack>` provider and can call `useNavStack`.
 */
function DrillBar({ title, crumb }: { title: string; crumb?: string }) {
  const { pop } = useNavStack()
  return (
    <div className='flex h-9 items-center gap-2 px-2'>
      <Button variant='ghost' size='icon-xs' className='rounded-md' onClick={() => pop()}>
        <ChevronLeft />
      </Button>
      {crumb && (
        <>
          <button
            type='button'
            onClick={() => pop()}
            className='max-w-[140px] shrink-0 truncate text-sm text-muted-foreground hover:text-foreground'>
            {crumb}
          </button>
          <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
        </>
      )}
      <span className='truncate text-sm font-medium'>{title}</span>
    </div>
  )
}

interface ConnectorDetailTabsProps {
  connector: Connector
  /** On mobile (no dock) the Runs panel is appended as a tab/section. */
  mobileRunsPanel?: React.ReactNode
}

/**
 * Connector detail body — a `NavStack` whose root is a scroll-spy column of
 * Connection / Streams / Schedule sections under a sticky Tabs strip, and whose
 * drill panels edit the connector source config (`source`), a stream's
 * schema/mappings (`stream`), or a field's calc expression (`field`). Modeled on
 * `agent-detail-tabs` and shares the `useScrollSpy` hook.
 * See plans/data-connectors/claude/05-frontend.md §2.
 */
export function ConnectorDetailTabs({ connector, mobileRunsPanel }: ConnectorDetailTabsProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'connection' })
  const [selectedStreamId, setSelectedStreamId] = useQueryState('stream')
  const [sourceOpen, setSourceOpen] = useQueryState('source')
  // The field drill encodes `mappingId:fieldKey`.
  const [field, setField] = useQueryState('field')

  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const selectedStream = useMemo(
    () => (streams.data ?? []).find((s) => s.id === selectedStreamId) ?? null,
    [streams.data, selectedStreamId]
  )
  const sourcePaths = useSourcePaths(selectedStream?.sourceSchema as Record<string, unknown> | null)

  // Stack: root → (source | stream) → field. `source` and `stream` are siblings
  // at depth 1; only the stream drill nests a `field` drill.
  const stack = sourceOpen
    ? ['root', 'source']
    : !selectedStreamId
      ? ['root']
      : !field
        ? ['root', 'stream']
        : ['root', 'stream', 'field']

  const { scrollContainerRef, assignRef, scrollToSection } = useScrollSpy<ConnectorTab>({
    sections: CONNECTOR_TABS,
    active: (tab as ConnectorTab) ?? 'connection',
    onActiveChange: setTab,
    remountKey: `${sourceOpen}:${selectedStreamId}:${field}`,
    spyBuffer: SPY_BUFFER,
    scrollBuffer: SCROLL_BUFFER,
  })

  const handleTabChange = useCallback(
    (value: string) => {
      void setSourceOpen(null)
      void setSelectedStreamId(null)
      void setField(null)
      setTab(value)
      scrollToSection(value as ConnectorTab)
    },
    [setTab, setSourceOpen, setSelectedStreamId, setField, scrollToSection]
  )

  const handleStackChange = useCallback(
    (next: string[]) => {
      if (next.length <= 1) {
        void setSourceOpen(null)
        void setSelectedStreamId(null)
        void setField(null)
      } else if (next.length === 2) {
        void setField(null)
      }
    },
    [setSourceOpen, setSelectedStreamId, setField]
  )

  // Field drill target.
  const [fieldMappingId, fieldKey] = (field ?? '').split(':')
  const fieldMappings = api.dataConnector.listMappings.useQuery(
    { streamId: selectedStreamId ?? '' },
    { enabled: !!selectedStreamId && !!field }
  )
  const fieldMapping = (fieldMappings.data ?? []).find((m) => m.id === fieldMappingId)
  const fieldExpression =
    (fieldMapping?.fieldMappings as Record<string, { expression: string }> | undefined)?.[
      fieldKey ?? ''
    ]?.expression ?? ''
  // Optimistic field-mapping write against listMappings (shared with the tree).
  const { setFieldMappings } = useStreamMutations(connector.id)

  const sourceBar = (
    <DrillBar
      title={connector.type.startsWith('app:') ? 'Connector settings' : 'Request configuration'}
    />
  )
  const streamBar = selectedStream ? <DrillBar title={selectedStream.streamKey} /> : null
  const fieldBar = <DrillBar title='Formula' crumb={selectedStream?.streamKey} />

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <NavStack
        stack={stack}
        onStackChange={handleStackChange}
        className='flex min-h-0 flex-1 flex-col'>
        <NavStackBar className='shrink-0 border-b bg-primary-150' />
        <NavStackPanels className='min-h-0 flex-1'>
          <NavStackPanel
            value='root'
            className='h-full bg-neutral-100 dark:bg-background'
            bar={
              <Tabs value={tab} onValueChange={handleTabChange}>
                <TabsList className='w-full justify-start rounded-none bg-transparent px-2'>
                  {CONNECTOR_TABS.map((value) => {
                    const Icon = TAB_ICONS[value]
                    return (
                      <TabsTrigger key={value} value={value} variant='outline'>
                        <Icon />
                        {TAB_LABELS[value]}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </Tabs>
            }>
            <ScrollArea
              viewportRef={scrollContainerRef}
              className='h-full'
              scrollbarClassName='w-1.5 z-20'
              noFade>
              <div ref={assignRef('connection')}>
                <ConnectionSection connector={connector} onOpenSource={() => setSourceOpen('1')} />
              </div>
              <div ref={assignRef('streams')}>
                <StreamsSection connector={connector} onSelect={(id) => setSelectedStreamId(id)} />
              </div>
              <div ref={assignRef('schedule')}>
                <ScheduleSection connector={connector} />
              </div>

              {mobileRunsPanel && <div className='h-[60vh]'>{mobileRunsPanel}</div>}

              <div className='h-[40vh]' />
            </ScrollArea>
          </NavStackPanel>

          <NavStackPanel
            value='source'
            className='h-full bg-neutral-100 dark:bg-background'
            bar={sourceBar}>
            <SourceConfigPanel connector={connector} />
          </NavStackPanel>

          <NavStackPanel
            value='stream'
            className='h-full bg-neutral-100 dark:bg-background'
            bar={streamBar}>
            {selectedStream ? (
              <StreamConfigPanel
                connector={connector}
                stream={selectedStream}
                onPromoteField={(mappingId, key) => setField(`${mappingId}:${key}`)}
              />
            ) : null}
          </NavStackPanel>

          <NavStackPanel
            value='field'
            className='h-full bg-neutral-100 dark:bg-background'
            bar={fieldBar}>
            {fieldMapping && fieldKey ? (
              <FieldCalcPanel
                fieldLabel={fieldKey}
                expression={fieldExpression}
                sourcePaths={sourcePaths}
                onSave={(expression, sourceFields) => {
                  const existing = (fieldMapping.fieldMappings ?? {}) as Record<
                    string,
                    { expression: string; sourceFields: Record<string, string> }
                  >
                  if (selectedStreamId)
                    void setFieldMappings(selectedStreamId, fieldMapping.id, {
                      ...existing,
                      [fieldKey]: { expression, sourceFields },
                    })
                  void setField(null)
                }}
              />
            ) : null}
          </NavStackPanel>
        </NavStackPanels>
      </NavStack>
    </div>
  )
}
