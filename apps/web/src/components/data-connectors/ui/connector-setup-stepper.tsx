// apps/web/src/components/data-connectors/ui/connector-setup-stepper.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
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
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { isMissing, readFieldNodes } from '~/components/global/schema-form'
import { api, type RouterOutputs } from '~/trpc/react'
import { useConnectorMutations } from '../hooks/use-connector-mutations'
import {
  deriveSetupProgress,
  deriveStreamReadiness,
  type ProgressConnectorRow,
  type ProgressStreamRow,
  type SetupStepId,
  type StreamReadiness,
} from '../hooks/use-setup-progress'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { useConnectorDraftStore, visibleMappings } from '../stores/connector-draft-store'
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

// Order matters: Schedule comes before "Pull a sample" because the sync behavior
// (manual / scheduled / webhook) shapes the stream's request — a webhook-steered
// stream's URL/params carry `{path}` placeholders resolved from the delivery, so the
// behavior must be picked before the request is configured/sampled.
const STEPS: StepDef[] = [
  {
    id: 'connect',
    title: 'Connect',
    description: 'Authorize the connection this connector uses to make requests.',
    icon: Plug,
  },
  {
    id: 'schedule',
    title: 'Schedule',
    description: 'Sync manually, on a schedule, or from a webhook — you can change this anytime.',
    icon: Clock,
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

  // Gate the stepper off the DRAFT — the client source of truth. The autosave commit
  // reconciles the draft in place and deliberately does NOT refetch getById/listStreams
  // (it would re-seed the draft mid-keystroke and erase what's being typed — the same
  // page-query-invalidate anti-pattern the agents editor avoids), so the server
  // `connector`/`streams` props now lag a commit behind. The draft never does, so a step
  // unlocks the instant its edit lands. Fall back to the server props until the store is
  // seeded (one render on mount) so nothing flashes locked.
  const draftSeeded = useConnectorDraftStore((s) => s.connectorId === connector.id)
  const draftConfig = useConnectorDraftStore((s) => s.draft.config)
  const draftStreams = useConnectorDraftStore((s) => s.draft.streams)
  const gatingStreams = useMemo<Array<ProgressStreamRow & { id: string }>>(() => {
    const source = draftSeeded
      ? draftStreams.map((s) => ({
          id: s.id,
          enabled: s.enabled,
          sourceSchema: s.sourceSchema,
          mappings: visibleMappings(s),
        }))
      : streams.map((s) => ({
          id: s.id,
          enabled: s.enabled,
          sourceSchema: s.sourceSchema as Record<string, unknown> | null,
          mappings: s.mappings as ProgressStreamRow['mappings'],
        }))
    return source
  }, [draftSeeded, draftStreams, streams])

  // The enabled streams (draft-backed once seeded) are the ones setup must satisfy —
  // a stream the org toggled off neither gates nor needs a sample. Step structure and
  // the Connect/Sample bodies key off these, not `streams[0]` (§3.3).
  const enabledStreams = useMemo(() => {
    const enabledById = new Map(draftStreams.map((s) => [s.id, s.enabled]))
    return streams.filter((s) => (draftSeeded ? (enabledById.get(s.id) ?? s.enabled) : s.enabled))
  }, [streams, draftStreams, draftSeeded])

  // The stream Connect previews / the Sample step configures. Prefer the first enabled
  // stream still lacking a catalog schema (the one a sample is actually for); else the
  // first enabled stream. Falls back to the whole list when nothing is enabled yet.
  const sampleStream =
    enabledStreams.find((s) => s.schemaSource !== 'catalog' || s.sourceSchema == null) ??
    enabledStreams[0] ??
    streams[0] ??
    null

  // A catalog-supplied schema (app connectors always; templates that ship one)
  // means there's nothing to "pull a sample" for — the source shape arrived at
  // create time. Drop that step only when EVERY enabled stream already carries a
  // catalog schema; a mix keeps Sample for the schema-less ones. `schemaSource ===
  // 'catalog'` is the stable signal — a user-pulled sample stamps 'inferred', so this
  // never flips mid-setup.
  const catalogSchema =
    enabledStreams.length > 0 &&
    enabledStreams.every((s) => s.schemaSource === 'catalog' && s.sourceSchema != null)

  const steps = useMemo(
    () => (catalogSchema ? STEPS.filter((s) => s.id !== 'sample') : STEPS),
    [catalogSchema]
  )
  const stepOrder = useMemo(() => steps.map((s) => s.id), [steps])

  // Connect requirements for an app connector (generic-rest ignores these): a credential
  // is required when the app exposes a connection definition, and the declared config
  // schema decides whether there's a settings form to fill. Both come from sources a pure
  // connector+streams read can't see, so we resolve them here and hand them to the hook.
  const { appInstallations } = useAppsContext()
  const requiresConnection = useMemo(() => {
    if (connector.definitionKind !== 'app') return false
    const slug = connector.type.startsWith('app:') ? connector.type.slice('app:'.length) : null
    const inst = appInstallations.find(
      (i) => i.installationId === connector.appInstallationId || i.app.slug === slug
    )
    return !!(inst?.connectionDefinitions?.user || inst?.connectionDefinitions?.organization)
  }, [connector.definitionKind, connector.type, connector.appInstallationId, appInstallations])

  const schemaQuery = api.dataConnector.connectorSchema.useQuery(
    { id: connector.id },
    { enabled: connector.definitionKind === 'app' }
  )
  const configFields = useMemo(
    () => readFieldNodes(schemaQuery.data?.configJsonSchema as Record<string, unknown> | null),
    [schemaQuery.data]
  )
  const requiredConfigSatisfied = useMemo(() => {
    const cfg = ((draftSeeded ? draftConfig : connector.config) ?? {}) as Record<string, unknown>
    return configFields.filter((f) => f.required).every((f) => !isMissing(cfg[f.key]))
  }, [configFields, draftSeeded, draftConfig, connector.config])

  const progressConnector: ProgressConnectorRow = {
    definitionKind: connector.definitionKind,
    config: (draftSeeded ? draftConfig : connector.config) as ProgressConnectorRow['config'],
    credentialId: connector.credentialId,
  }
  const progress = deriveSetupProgress(progressConnector, gatingStreams, {
    requiresConnection,
    hasConfigForm: configFields.length > 0,
    requiredConfigSatisfied,
  })

  // Per-stream readiness drives the Map step's overview badges + its `every`-stream gate.
  const readinessById = useMemo<Record<string, StreamReadiness>>(
    () => Object.fromEntries(gatingStreams.map((s) => [s.id, deriveStreamReadiness(s)])),
    [gatingStreams]
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
  // Connect is only pre-completed when it's trivial (nothing to authorize/configure);
  // otherwise it's the opening step and the passing rule (`idx < activeIdx`) marks it
  // done once the user advances past it — never a pre-filled check they didn't earn.
  // Passing-completed (`idx < activeIdx`) is added per-step in the render.
  const completedById: Record<SetupStepId, boolean> = {
    connect: progress.connectTrivial,
    sample: progress.sample,
    map: progress.map,
    schedule: false,
    run: false,
  }

  const { syncNow, sampleSync, isSyncing, finishSetup, isFinishing } = useConnectorMutations()

  // Terminal-step scope choice (trial-sync §5.1): sample a few of each stream first
  // (recommended for large sources — imports then pauses for review), or sync
  // everything now. Sample size is per-stream; 100 is a sensible default first look.
  const [runScope, setRunScope] = useState<'sample' | 'everything'>('sample')
  const [sampleSize, setSampleSize] = useState('100')

  const addStream = api.dataConnector.addStream.useMutation({
    onSuccess: () => void utils.dataConnector.listStreams.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not add stream', description: e.message }),
  })

  // Active (expanded) step. Opens on Connect unless it's trivially nothing-to-do
  // (then the first incomplete step) — so a connector that still needs a connection
  // or has settings to set never silently skips straight to "Run". The user can
  // click any unlocked step header to jump back.
  const [active, setActive] = useState<SetupStepId>(() =>
    progress.connectTrivial ? (stepOrder.find((id) => !doneById[id]) ?? 'run') : 'connect'
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
            {catalogSchema && progress.connect && sampleStream && (
              <ConnectPreview connector={connector} stream={sampleStream} />
            )}
          </>
        )
      case 'sample':
        if (!sampleStream)
          return <NoStreamPrompt addStream={addStream} connectorId={connector.id} />
        return (
          <StreamConfigPanel
            connector={connector}
            stream={sampleStream}
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
                  ? 'Sample a few records first, or sync everything now. You can also finish and sync later.'
                  : 'Finish Connect and Map fields above to enable syncing.'
              }
            />
            <RadioGroup
              value={runScope}
              onValueChange={(v) => setRunScope(v as 'sample' | 'everything')}
              className='gap-2'>
              <div className='flex items-start gap-2'>
                <RadioGroupItemCard
                  value='sample'
                  label='Sample first'
                  description='Import a few records of each stream, then pause so you can review them before importing the rest. Recommended for large sources.'
                  className='flex-1'
                  disabled={!progress.canRun}
                />
                <Select value={sampleSize} onValueChange={setSampleSize}>
                  <SelectTrigger size='sm' className='mt-1 w-20' disabled={runScope !== 'sample'}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='50'>50</SelectItem>
                    <SelectItem value='100'>100</SelectItem>
                    <SelectItem value='500'>500</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <RadioGroupItemCard
                value='everything'
                label='Sync everything'
                description='Import all records now. The first run can take a while for large sources.'
                disabled={!progress.canRun}
              />
            </RadioGroup>
            <div className='flex items-center gap-2'>
              <Button
                loading={isSyncing}
                variant='outline'
                size='sm'
                loadingText='Starting…'
                disabled={!progress.canRun}
                onClick={() =>
                  void (runScope === 'sample'
                    ? sampleSync(connector.id, Number(sampleSize))
                    : syncNow(connector.id))
                }>
                <Play />
                Run sync
              </Button>
              <Button
                variant='ghost'
                size='sm'
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
      connect: 'Add the endpoint base URL to continue (a connection is optional).',
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
    // A real Section (not a bare div) so it matches Connection / Connector settings
    // above it — same uppercase header + divider, no offset hand-rolled border.
    <Section
      title='Preview records'
      icon={<FlaskConical className='size-4' />}
      initialOpen
      collapsible={false}
      // Drop the body padding while there's no sample yet (the shared empty-body
      // pattern — cf. stream-config-panel / pagination-section).
      className={sample ? undefined : '[&_[data-slot=section]]:pb-0'}
      description='Optional — confirm the connection returns real data before the first sync.'
      actions={
        <Button
          size='sm'
          variant='outline'
          loading={isSampling}
          loadingText='Fetching…'
          onClick={() => void run()}>
          <FlaskConical />
          {sample ? 'Refresh' : 'Preview'}
        </Button>
      }>
      {sample && (
        <div className='px-1'>
          <StreamSample sample={sample} />
        </div>
      )}
    </Section>
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
