// apps/web/src/components/data-connectors/ui/connector-detail-tabs.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { NavStack, NavStackBar, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { CircleHelp, Clock, Layers, Plug } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { useScrollSpy } from '~/hooks/use-scroll-spy'
import { api } from '~/trpc/react'
import { useConnectorCommit } from '../hooks/use-connector-commit'
import { useConnectorDraftSync } from '../hooks/use-connector-draft-sync'
import { ConnectionSection } from './connection-section'
import { ConnectorSaveBar } from './connector-save-bar'
import { ConnectorSetupStepper } from './connector-setup-stepper'
import { asConnectorStatus } from './connector-status'
import { ScheduleSection } from './schedule-section'
import { StreamConfigPanel } from './stream-config-panel'
import { StreamDetailBar } from './stream-detail-bar'
import { StreamGuideDialog } from './stream-guide-dialog'
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
  /** Pending mapping-edit re-sync banner — pinned directly under the tabs strip. */
  resyncBanner?: React.ReactNode
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
export function ConnectorDetailTabs({
  connector,
  mobileRunsPanel,
  resyncBanner,
}: ConnectorDetailTabsProps) {
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'connection' })
  const [selectedStreamId, setSelectedStreamId] = useQueryState('stream')
  const [guideOpen, setGuideOpen] = useState(false)

  // Branch the guide copy on connector kind (05c §7), matching `StreamConfigPanel`:
  // app-kind connectors don't expose the request/pagination controls the guide explains.
  const isGenericRest = connector.definitionKind !== 'app'

  const streams = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const selectedStream = useMemo(
    () => (streams.data ?? []).find((s) => s.id === selectedStreamId) ?? null,
    [streams.data, selectedStreamId]
  )

  // The unified saving model (plans/data-connectors/v4): one draft store seeded from
  // these queries drives every editor, and a single `commit()` flushes it. A `pending`
  // connector (first-run setup) autosaves on a debounce; any other status is manual
  // (the floating save bar). Mounted once here so BOTH the stepper and the flat editor
  // share the draft. Replaces the old `ConnectorEditsProvider` registry.
  const isPending = asConnectorStatus(connector.status) === 'pending'
  const commit = useConnectorCommit()
  useConnectorDraftSync({ connector, streams: streams.data, autoSave: isPending, commit })

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
      isGenericRest={isGenericRest}
    />
  ) : null

  // A `pending` connector is in first-run setup → render the guided stepper. Any
  // other status renders today's flat tabbed editor. Both mount the identical
  // section components against the identical mutations (create-sync-flow-plan §2).
  if (isPending) {
    return <ConnectorSetupStepper connector={connector} />
  }

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
                  <Button
                    variant='ghost'
                    size='xs'
                    className='ml-auto'
                    onClick={() => setGuideOpen(true)}>
                    <CircleHelp />
                    Guide
                  </Button>
                </TabsList>
              </Tabs>
            }>
            <div className='flex h-full flex-col'>
              {resyncBanner}
              <div className='relative min-h-0 flex-1'>
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
            </div>
          </NavStackPanel>

          <NavStackPanel
            value='stream'
            className='h-full bg-neutral-100 dark:bg-background'
            bar={streamBar}>
            {/* `relative` so the floating save bar anchors to this panel — the
                  root panel's bar is offscreen while drilled into a stream. */}
            <div className='relative h-full'>
              {selectedStream ? (
                <StreamConfigPanel connector={connector} stream={selectedStream} />
              ) : null}
              <ConnectorSaveBar />
            </div>
          </NavStackPanel>
        </NavStackPanels>
      </NavStack>
      {guideOpen && (
        <StreamGuideDialog
          open={guideOpen}
          onOpenChange={setGuideOpen}
          isGenericRest={isGenericRest}
        />
      )}
    </div>
  )
}
