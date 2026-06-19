// apps/web/src/components/data-connectors/ui/connector-detail-tabs.tsx
'use client'

import { NavStack, NavStackBar, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Clock, Layers, Plug } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useScrollSpy } from '~/hooks/use-scroll-spy'
import { api } from '~/trpc/react'
import { ConnectorEditsProvider } from '../hooks/use-connector-edits'
import { ConnectionSection } from './connection-section'
import { ConnectorSaveBar } from './connector-save-bar'
import { ScheduleSection } from './schedule-section'
import { StreamConfigPanel } from './stream-config-panel'
import { StreamDetailBar } from './stream-detail-bar'
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

interface ConnectorDetailTabsProps {
  connector: Connector
  /** On mobile (no dock) the Runs panel is appended as a tab/section. */
  mobileRunsPanel?: React.ReactNode
}

/**
 * Connector detail body — a `NavStack` whose root is a scroll-spy column of
 * Connection / Streams / Schedule sections under a sticky Tabs strip, and whose
 * `stream` drill edits a stream's schema/mappings. The connector source config is
 * inlined in the Connection section; a mapping's calc expression is edited in a
 * dialog (in the mapping tree), not a pushed drill. Modeled on `agent-detail-tabs`
 * and shares the `useScrollSpy` hook.
 * See plans/data-connectors/claude/05-frontend.md §2.
 */
export function ConnectorDetailTabs({ connector, mobileRunsPanel }: ConnectorDetailTabsProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'connection' })
  const [selectedStreamId, setSelectedStreamId] = useQueryState('stream')

  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const selectedStream = useMemo(
    () => (streams.data ?? []).find((s) => s.id === selectedStreamId) ?? null,
    [streams.data, selectedStreamId]
  )

  // Stack: root → stream. The formula editor is now a dialog (in the mapping
  // tree), not a pushed drill; the connector source config is inlined in the
  // Connection section.
  const stack = !selectedStreamId ? ['root'] : ['root', 'stream']

  const { scrollContainerRef, assignRef, scrollToSection } = useScrollSpy<ConnectorTab>({
    sections: CONNECTOR_TABS,
    active: (tab as ConnectorTab) ?? 'connection',
    onActiveChange: setTab,
    remountKey: `${selectedStreamId}`,
    spyBuffer: SPY_BUFFER,
    scrollBuffer: SCROLL_BUFFER,
  })

  const handleTabChange = useCallback(
    (value: string) => {
      void setSelectedStreamId(null)
      setTab(value)
      scrollToSection(value as ConnectorTab)
    },
    [setTab, setSelectedStreamId, scrollToSection]
  )

  const handleStackChange = useCallback(
    (next: string[]) => {
      if (next.length <= 1) void setSelectedStreamId(null)
    },
    [setSelectedStreamId]
  )

  const streamBar = selectedStream ? (
    <StreamDetailBar
      connectorId={connector.id}
      streamId={selectedStream.id}
      streamKey={selectedStream.streamKey}
    />
  ) : null

  return (
    <ConnectorEditsProvider>
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
              <div className='relative h-full'>
                <ScrollArea
                  viewportRef={scrollContainerRef}
                  className='h-full'
                  scrollbarClassName='w-1.5 z-20'
                  noFade>
                  <div ref={assignRef('connection')}>
                    <ConnectionSection connector={connector} />
                  </div>
                  <div ref={assignRef('streams')}>
                    <StreamsSection
                      connector={connector}
                      onSelect={(id) => setSelectedStreamId(id)}
                    />
                  </div>
                  <div ref={assignRef('schedule')}>
                    <ScheduleSection connector={connector} />
                  </div>

                  {mobileRunsPanel && <div className='h-[60vh]'>{mobileRunsPanel}</div>}

                  <div className='h-[40vh]' />
                </ScrollArea>
                <ConnectorSaveBar />
              </div>
            </NavStackPanel>

            <NavStackPanel
              value='stream'
              className='h-full bg-neutral-100 dark:bg-background'
              bar={streamBar}>
              {selectedStream ? (
                <StreamConfigPanel connector={connector} stream={selectedStream} />
              ) : null}
            </NavStackPanel>
          </NavStackPanels>
        </NavStack>
      </div>
    </ConnectorEditsProvider>
  )
}
