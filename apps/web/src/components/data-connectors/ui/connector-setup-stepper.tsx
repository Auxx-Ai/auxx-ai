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
import { deriveSetupProgress, type SetupStepId } from '../hooks/use-setup-progress'
import { ConnectionSection } from './connection-section'
import { ConnectorSaveBar } from './connector-save-bar'
import { ScheduleSection } from './schedule-section'
import { StreamConfigPanel } from './stream-config-panel'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

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

const STEP_ORDER = STEPS.map((s) => s.id)

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

  const progress = deriveSetupProgress(connector, streams)

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

  const { syncNow, isSyncing } = useConnectorMutations()

  const addStream = api.dataConnector.addStream.useMutation({
    onSuccess: () => void utils.dataConnector.listStreams.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not add stream', description: e.message }),
  })

  // Active (expanded) step. Defaults to the first incomplete step; the user can
  // click any unlocked step header to jump back to it.
  const [active, setActive] = useState<SetupStepId>(
    () => STEP_ORDER.find((id) => !doneById[id]) ?? 'run'
  )

  // A step is unlocked once every step before it is done.
  const isUnlocked = (id: SetupStepId) => {
    const idx = STEP_ORDER.indexOf(id)
    return STEP_ORDER.slice(0, idx).every((prior) => doneById[prior])
  }

  const goNext = (id: SetupStepId) => {
    const next = STEP_ORDER[STEP_ORDER.indexOf(id) + 1]
    if (next) setActive(next)
  }

  const renderBody = (id: SetupStepId) => {
    switch (id) {
      case 'connect':
        return <ConnectionSection connector={connector} />
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
        if (!primaryStream)
          return (
            <p className='px-1 py-3 text-sm text-muted-foreground'>
              Pull a sample first — the source schema is what you map against.
            </p>
          )
        return (
          <StreamConfigPanel
            connector={connector}
            stream={primaryStream}
            view='map'
            scroll={false}
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
                  ? 'Run the first import now. You can keep editing while it runs.'
                  : 'Finish Connect and Map fields above to enable the first sync.'
              }
            />
            <div>
              <Button
                loading={isSyncing}
                loadingText='Starting…'
                disabled={!progress.canRun}
                onClick={() => void syncNow(connector.id)}>
                <Play />
                Run first sync
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

  const activeNumber = STEP_ORDER.indexOf(active) + 1

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <ScrollArea className='h-full' scrollbarClassName='w-1.5' noFade>
        <Stepper
          value={activeNumber}
          orientation='vertical'
          onValueChange={(n) => {
            const id = STEP_ORDER[n - 1]
            if (id && isUnlocked(id)) setActive(id)
          }}
          className='mx-auto flex w-full max-w-3xl flex-col px-4 py-6'>
          {STEPS.map((step, idx) => {
            // Visually completed = genuinely done, or already passed (an earlier step).
            const completed = completedById[step.id] || idx < STEP_ORDER.indexOf(active)
            const isActive = active === step.id
            const Icon = step.icon
            const isLast = idx === STEPS.length - 1
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
