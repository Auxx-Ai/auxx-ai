// apps/web/src/components/data-connectors/ui/connector-setup-stepper.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@auxx/ui/components/stepper'
import { toastError } from '@auxx/ui/components/toast'
import { Check, Clock, FlaskConical, Layers, Play, Plug, Waypoints } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import {
  deriveSetupProgress,
  deriveStreamReadiness,
  type SetupStepId,
  type StreamReadiness,
} from '../hooks/use-setup-progress'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { ConnectionSection } from './connection-section'
import { ConnectorSaveBar } from './connector-save-bar'
import { ScheduleSection } from './schedule-section'
import { SetupStreamsOverview } from './setup-streams-overview'
import { StreamConfigPanel } from './stream-config-panel'
import { StreamSample } from './stream-sample'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

interface StepDef {
  id: SetupStepId
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const STEPS: StepDef[] = [
  {
    id: 'connect',
    title: 'Connect',
    description: 'Authorize the connection this connector uses to make requests.',
    icon: Plug,
  },
  {
    id: 'sample',
    title: 'Pull a sample',
    description: 'Fetch a few real records to see what the source returns.',
    icon: FlaskConical,
  },
  {
    id: 'map',
    title: 'Map fields',
    description: 'Choose where each source field lands in your entities.',
    icon: Waypoints,
  },
  {
    id: 'schedule',
    title: 'Schedule',
    description: 'Sync manually or on a schedule — you can change this anytime.',
    icon: Clock,
  },
  {
    id: 'run',
    title: 'Run first sync',
    description: 'Start the first import. Live progress shows in the runs panel.',
    icon: Play,
  },
]

interface ConnectorSetupStepperProps {
  connector: Connector
}

/**
 * Guided first-run setup — the `pending` render mode of the connector detail view
 * (create-sync-flow-plan §2). A gated vertical stepper that mounts the SAME section
 * components the flat editor uses (`ConnectionSection`, `StreamConfigPanel`,
 * `ScheduleSection`) against the live connector, so there is zero duplicate save
 * logic. Each step's "done" is derived from persisted state (no `step` column); the
 * terminal "Run first sync" CTA fires `syncNow`, flipping the connector out of
 * `pending` so the view collapses to the flat tabbed editor and the loop closes.
 */
export function ConnectorSetupStepper({ connector }: ConnectorSetupStepperProps) {
  const utils = api.useUtils()
  const streamsQuery = api.dataConnector.listStreams.useQuery({ id: connector.id })
  const streams = useMemo(() => streamsQuery.data ?? [], [streamsQuery.data])
  const primaryStream = streams[0] ?? null

  // A catalog-supplied schema (app connectors always; templates that ship one)
  // means there's nothing to "pull a sample" for — the source shape arrived at
  // create time. Drop that step; instead offer an optional live preview inside
  // Connect so the user can still confirm the connection returns real data.
  // `schemaSource === 'catalog'` is the stable signal — a user-pulled sample
  // stamps 'inferred', so this never flips mid-setup.
  const catalogSchema =
    primaryStream?.schemaSource === 'catalog' && primaryStream.sourceSchema != null

  const steps = useMemo(
    () => (catalogSchema ? STEPS.filter((s) => s.id !== 'sample') : STEPS),
    [catalogSchema]
  )
  const stepOrder = useMemo(() => steps.map((s) => s.id), [steps])

  const progress = deriveSetupProgress(connector, streams)

  // Per-stream readiness drives the Map step's overview badges + its `every`-stream gate.
  const readinessById = useMemo<Record<string, StreamReadiness>>(
    () => Object.fromEntries(streams.map((s) => [s.id, deriveStreamReadiness(s)])),
    [streams]
  )

  // Gating: can the user advance past this step? Schedule is always satisfiable
  // (Manual is a valid terminal state), so it never blocks the flow.
  const doneById: Record<SetupStepId, boolean> = {
    connect: progress.connect,
    sample: progress.sample,
    map: progress.map,
    schedule: true,
    run: false, // Terminal action, never "done" while still pending.
  }

  // Visual completion (filled indicator + check + filled rail). Distinct from
  // gating: Schedule isn't shown completed until the user actually reaches it —
  // otherwise it renders as a dark, done-looking step while still on step 1.
  // Passing-completed (`idx < activeIdx`) is added per-step in the render.
  const completedById: Record<SetupStepId, boolean> = {
    connect: progress.connect,
    sample: progress.sample,
    map: progress.map,
    schedule: false,
    run: false,
  }

  const { syncNow, isSyncing, finishSetup, isFinishing } = useConnectorMutations()

  const addStream = api.dataConnector.addStream.useMutation({
    onSuccess: () => void utils.dataConnector.listStreams.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not add stream', description: e.message }),
  })

  // Active (expanded) step. Defaults to the first incomplete step; the user can
  // click any unlocked step header to jump back to it.
  const [active, setActive] = useState<SetupStepId>(
    () => stepOrder.find((id) => !doneById[id]) ?? 'run'
  )

  // Guard: if the active step was filtered out (sample drops once streams load),
  // fall back to the first incomplete step in the current order.
  const current = stepOrder.includes(active)
    ? active
    : (stepOrder.find((id) => !doneById[id]) ?? stepOrder[stepOrder.length - 1])

  // A step is unlocked once every step before it is done.
  const isUnlocked = (id: SetupStepId) => {
    const idx = stepOrder.indexOf(id)
    return stepOrder.slice(0, idx).every((prior) => doneById[prior])
  }

  const goNext = (id: SetupStepId) => {
    const next = stepOrder[stepOrder.indexOf(id) + 1]
    if (next) setActive(next)
  }

  const renderBody = (id: SetupStepId) => {
    switch (id) {
      case 'connect':
        return (
          <>
            <ConnectionSection connector={connector} />
            {catalogSchema && progress.connect && primaryStream && (
              <ConnectPreview connector={connector} stream={primaryStream} />
            )}
          </>
        )
      case 'sample':
        if (!primaryStream)
          return <NoStreamPrompt addStream={addStream} connectorId={connector.id} />
        return (
          <StreamConfigPanel
            connector={connector}
            stream={primaryStream}
            view='configure'
            scroll={false}
          />
        )
      case 'map':
        if (streams.length === 0)
          return (
            <p className='px-1 py-3 text-sm text-muted-foreground'>
              Add a stream first — the source schema is what you map against.
            </p>
          )
        return (
          <SetupStreamsOverview
            connector={connector}
            streams={streams}
            readinessById={readinessById}
          />
        )
      case 'schedule':
        return <ScheduleSection connector={connector} />
      case 'run':
        return (
          <div className='flex flex-col gap-3 px-1 py-2'>
            <EmptySection
              icon={<Play />}
              title='Ready to sync'
              description={
                progress.canRun
                  ? 'Run the first import now, or finish setup and sync later.'
                  : 'Finish Connect and Map fields above to enable syncing.'
              }
            />
            <div className='flex items-center gap-2'>
              <Button
                loading={isSyncing}
                loadingText='Starting…'
                disabled={!progress.canRun}
                onClick={() => void syncNow(connector.id)}>
                <Play />
                Run first sync
              </Button>
              <Button
                variant='outline'
                loading={isFinishing}
                disabled={!progress.canRun}
                onClick={() => void finishSetup(connector.id)}>
                Finish without syncing
              </Button>
            </div>
          </div>
        )
    }
  }

  // The footer advance control for a step (Run uses the body CTA instead).
  const renderFooter = (id: SetupStepId) => {
    if (id === 'run') return null
    const blocked = !doneById[id]
    const hint: Partial<Record<SetupStepId, string>> = {
      connect: 'Connect an account to continue.',
      sample: 'Run a test fetch and use its shape as the schema to continue.',
      map: 'Map at least one field to continue.',
    }
    return (
      <div className='mt-3 flex items-center gap-3'>
        <Button size='sm' variant='outline' disabled={blocked} onClick={() => goNext(id)}>
          Continue
        </Button>
        {blocked && hint[id] && <span className='text-xs text-muted-foreground'>{hint[id]}</span>}
      </div>
    )
  }

  const activeNumber = stepOrder.indexOf(current) + 1

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='h-full' scrollbarClassName='w-1.5' noFade>
        <Stepper
          value={activeNumber}
          orientation='vertical'
          onValueChange={(n) => {
            const id = stepOrder[n - 1]
            if (id && isUnlocked(id)) setActive(id)
          }}
          className='mx-auto flex w-full max-w-3xl flex-col px-4 py-6'>
          {steps.map((step, idx) => {
            // Visually completed = genuinely done, or already passed (an earlier step).
            const completed = completedById[step.id] || idx < stepOrder.indexOf(current)
            const isActive = current === step.id
            const Icon = step.icon
            const isLast = idx === steps.length - 1
            return (
              <StepperItem
                key={step.id}
                step={idx + 1}
                completed={completed}
                disabled={!isUnlocked(step.id)}
                className='w-full not-last:pb-6'>
                <StepperTrigger className='items-start gap-3 text-left'>
                  <StepperIndicator
                    asChild
                    className='bg-primary-100 text-primary-500 data-[state=active]:bg-primary-700 data-[state=active]:text-primary-50 data-[state=completed]:bg-primary-700 data-[state=completed]:text-primary-50'>
                    {completed ? <Check className='size-4' /> : <Icon className='size-4' />}
                  </StepperIndicator>
                  <div className='mt-0.5 flex flex-col items-start'>
                    <StepperTitle className='font-semibold'>{step.title}</StepperTitle>
                    <StepperDescription className='text-xs'>{step.description}</StepperDescription>
                  </div>
                </StepperTrigger>

                {!isLast && (
                  <StepperSeparator className='bg-primary-200 group-data-[state=completed]/step:bg-primary-700' />
                )}

                {isActive && (
                  <div className='mt-3 ml-9 w-[calc(100%-2.25rem)] rounded-lg border bg-background p-1'>
                    {renderBody(step.id)}
                    <div className='px-1 pb-1'>{renderFooter(step.id)}</div>
                  </div>
                )}
              </StepperItem>
            )
          })}
        </Stepper>
      </ScrollArea>
      <ConnectorSaveBar />
    </div>
  )
}

/**
 * Optional live preview for catalog connectors (app/template) — the schema already
 * arrived from the catalog, so this only confirms the connection returns real
 * records before the first sync (the value the dropped "Pull a sample" step gave).
 * Failures surface via the shared `sampleFetch` error toast.
 */
function ConnectPreview({ connector, stream }: { connector: Connector; stream: Stream }) {
  const { sampleFetch, isSampling } = useStreamMutations(connector.id)
  const [sample, setSample] = useState<{ response: unknown; recordCount: number } | null>(null)

  const run = async () => {
    try {
      setSample(await sampleFetch({ id: connector.id, streamKey: stream.streamKey }))
    } catch {
      // sampleFetch already surfaces the failure via toast.
    }
  }

  return (
    <div className='mt-2 flex flex-col gap-2 border-t px-1 pt-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex flex-col'>
          <span className='text-sm font-medium'>Preview records</span>
          <span className='text-xs text-muted-foreground'>
            Optional — confirm the connection returns real data before the first sync.
          </span>
        </div>
        <Button
          size='sm'
          variant='outline'
          loading={isSampling}
          loadingText='Fetching…'
          onClick={() => void run()}>
          <FlaskConical />
          {sample ? 'Refresh' : 'Preview'}
        </Button>
      </div>
      {sample && <StreamSample sample={sample} />}
    </div>
  )
}

/** Custom REST starts with no streams — create the first one to pull a sample. */
function NoStreamPrompt({
  addStream,
  connectorId,
}: {
  addStream: ReturnType<typeof api.dataConnector.addStream.useMutation>
  connectorId: string
}) {
  return (
    <div className='flex flex-col gap-3 px-1 py-2'>
      <EmptySection
        icon={<Layers />}
        title='No stream yet'
        description='A stream is one fetch (e.g. /orders). Add one to pull a sample and map its fields.'
      />
      <div>
        <Button
          size='sm'
          variant='outline'
          loading={addStream.isPending}
          onClick={() => addStream.mutate({ id: connectorId })}>
          <Layers />
          Add a stream
        </Button>
      </div>
    </div>
  )
}
