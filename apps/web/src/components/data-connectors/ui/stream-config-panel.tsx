// apps/web/src/components/data-connectors/ui/stream-config-panel.tsx
'use client'

import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import {
  ChevronDown,
  CircleHelp,
  Database,
  FlaskConical,
  Pencil,
  RefreshCw,
  Waypoints,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import type { HttpRequestFieldContextValue } from '~/components/global/http-request'
import { makeTokenFieldEditor } from '~/components/global/token-field'
import { Tooltip } from '~/components/global/tooltip'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import type { RouterOutputs } from '~/trpc/react'
import { useSourcePaths } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'
import { MappingTree } from './mapping-tree'
import { PaginationSection } from './pagination-section'
import {
  JsonBodyEditor,
  RecordKeyValueEditor,
  RequestEditorBlock,
  RevealChip,
} from './request-editors'
import { makeSteeringTokenSource } from './steering-token-source'
import { StreamGuideDialog } from './stream-guide-dialog'
import { StreamSample } from './stream-sample'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

// Plain-language explainer of where the source schema came from — replaces the
// old "Provenance" badge + Catalog/Inferred/Manual jargon.
const SCHEMA_SOURCE_SENTENCE: Record<string, string> = {
  catalog: 'Schema came predefined with this connector.',
  inferred: 'Schema auto-detected from a live response.',
  manual: 'Schema edited by hand.',
}

const METHOD_OPTIONS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
] as const

const SYNC_MODE_COPY: Record<
  'snapshot' | 'incremental',
  { icon: ReactNode; title: string; description: string }
> = {
  snapshot: {
    icon: <RefreshCw />,
    title: 'Full re-fetch every run',
    description:
      'Pulls the entire dataset each sync. Records that vanish upstream are treated as deleted and archived.',
  },
  incremental: {
    icon: <Waypoints />,
    title: 'Only new & changed records',
    description:
      'Uses a saved cursor to fetch records added or updated since the last run. Missing records are never archived.',
  },
}

interface StreamConfigPanelProps {
  connector: Connector
  stream: Stream
  /**
   * Which sections to render. `all` (default, the flat-editor drill) shows the
   * whole panel; the setup stepper splits it into `configure` (request → sample →
   * schema → sync mode) and `map` (mappings only) so each becomes its own step.
   */
  view?: 'all' | 'configure' | 'map'
  /** Wrap in a full-height `ScrollArea` (default). The stepper supplies its own scroll. */
  scroll?: boolean
}

const EMPTY_SCHEMA = { type: 'object', properties: {} }

/**
 * Stream drill (05 §4), ordered to follow the setup flow:
 *  request → sample (single live test-fetch) → schema → sync mode → mappings.
 * The schema is derived from the sample ("Use this shape as the schema") or
 * hand-edited; the mapping fan-out tree projects subtrees onto target defs.
 */
export function StreamConfigPanel({
  connector,
  stream,
  view = 'all',
  scroll = true,
}: StreamConfigPanelProps) {
  const showConfigure = view !== 'map'
  const showMappings = view !== 'configure'
  // Branch on the persisted definitionKind (05c §7), not a `type` prefix sniff.
  const isGenericRest = connector.definitionKind !== 'app'

  const [helpOpen, setHelpOpen] = useState(false)
  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const [sample, setSample] = useState<{
    response: unknown
    recordCount: number
    responseHeaders?: Record<string, string>
  } | null>(null)

  // Render config from the draft store (optimistic) — nothing persists until the save
  // bar's `commit()` (the unified saving model, plans/data-connectors/v4). Fall back to
  // the server prop for the first frame before the bridge seeds the store.
  const draftStream = useConnectorDraftStore((s) =>
    s.draft.streams.find((st) => st.id === stream.id)
  )
  const draftBehavior = useConnectorDraftStore((s) => s.draft.syncBehavior)
  const setStreamValidity = useConnectorDraftStore((s) => s.setStreamValidity)

  // Test-fetch readiness (plan §7a, `canSample`) — needs only an endpoint, and is
  // dirty-EXEMPT (it's the tool that sends the uncommitted draft request config to
  // discover the schema before any save). Soft-disabled only once the draft is seeded;
  // before that we defer to the server guard (Phase 0) rather than flash a false-disable.
  const draftSeeded = useConnectorDraftStore((s) => s.connectorId === connector.id)
  const draftConfig = useConnectorDraftStore((s) => s.draft.config)
  const draftCredentialId = useConnectorDraftStore((s) => s.meta?.credentialId ?? null)
  const canSample = isGenericRest
    ? !!(draftConfig as { endpoint?: { baseUrl?: string } }).endpoint?.baseUrl
    : !!draftCredentialId
  const sampleBlockReason =
    draftSeeded && !canSample ? (isGenericRest ? 'Add a base URL' : 'Connect an account') : null

  const liveRequestConfig = (draftStream?.requestConfig ?? stream.requestConfig ?? {}) as {
    path?: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    params?: Record<string, unknown>
    body?: Record<string, unknown>
    webhookTrigger?: { paths?: string[] }
  }
  const liveSourceSchema = (draftStream?.sourceSchema ?? stream.sourceSchema) as Record<
    string,
    unknown
  > | null
  const liveSchemaSource = draftStream?.schemaSource ?? stream.schemaSource

  const sourcePaths = useSourcePaths(liveSourceSchema)
  const hasSchema = !!liveSourceSchema

  // Imperative reads only — the live test-fetch (sampleFetch); the persisting writes
  // (request config, schema, sync mode) are draft setters now.
  const { sampleFetch, isSampling } = useStreamMutations(connector.id)

  // The request fields rendered from the draft.
  const reqValue = {
    path: liveRequestConfig.path ?? '',
    method: liveRequestConfig.method ?? 'GET',
    headers: liveRequestConfig.headers ?? {},
    params: liveRequestConfig.params ?? {},
    body: liveRequestConfig.body ?? {},
  }
  // Merge a request edit onto the draft's full requestConfig so pagination / webhook
  // steering / backfill-window keys survive. Reads the latest draft to avoid stale closures.
  const setRequest = (next: typeof reqValue) => {
    const cur = (getConnectorDraftState().draft.streams.find((s) => s.id === stream.id)
      ?.requestConfig ?? {}) as Record<string, unknown>
    getConnectorDraftState().setRequestConfig(stream.id, { ...cur, ...next })
  }

  // Progressive disclosure — each sub-editor stays hidden until revealed, but
  // starts open when its config already has content (a saved request is never
  // hidden). `bodyValid` blocks commit on a JSON parse error (via stream validity).
  const [showHeaders, setShowHeaders] = useState(
    () => Object.keys(liveRequestConfig.headers ?? {}).length > 0
  )
  const [showParams, setShowParams] = useState(
    () => Object.keys(liveRequestConfig.params ?? {}).length > 0
  )
  const [showBody, setShowBody] = useState(
    () => Object.keys(liveRequestConfig.body ?? {}).length > 0
  )
  const setBodyValid = (valid: boolean) => setStreamValidity(stream.id, valid)

  const syncMode: 'snapshot' | 'incremental' =
    (draftStream?.syncMode ?? stream.syncMode) === 'incremental' ? 'incremental' : 'snapshot'

  // Webhook-driven connectors steer the fetch with `{path}` placeholders declared in the
  // Webhook steering section. Token-enable the request fields (URL + header/param values)
  // so those paths are insertable via the `{` picker, not hand-typed. Gated on the draft
  // behavior — steering is orthogonal to syncMode (completeness).
  const isSteered = draftBehavior === 'webhook'
  const steeringPaths = useMemo<string[]>(
    () => liveRequestConfig.webhookTrigger?.paths ?? [],
    [liveRequestConfig.webhookTrigger]
  )
  const tokenFieldContext = useMemo<HttpRequestFieldContextValue>(() => {
    const tokenSource = makeSteeringTokenSource(steeringPaths)
    return {
      FieldEditor: makeTokenFieldEditor(tokenSource),
      keyPlaceholder: 'Enter key…',
      valuePlaceholder: 'Type { to insert a field…',
    }
  }, [steeringPaths])

  // Schema writes go to the draft store; commit persists them (and re-derives nothing).
  const setStreamSchema = (schema: Record<string, unknown>, source: 'inferred' | 'manual') =>
    getConnectorDraftState().setStreamSchema(stream.id, schema, source)

  const handleTestFetch = async () => {
    const result = await sampleFetch({
      id: connector.id,
      streamKey: stream.streamKey,
      requestConfig: isGenericRest ? reqValue : undefined,
    })
    setSample(result)
    // Auto-set the inferred schema (the raw response shape) when none exists yet.
    if (!hasSchema && result.response != null) {
      const inferred = inferJsonSchema(result.response) as Record<string, unknown>
      setStreamSchema(inferred, 'inferred')
    }
  }

  // Derive the source schema directly from the current sample's shape. Only
  // offered once a sample exists (the Sample section hides it otherwise).
  const handleUseShape = () => {
    if (sample?.response == null) return
    const inferred = inferJsonSchema(sample.response) as Record<string, unknown>
    setStreamSchema(inferred, 'inferred')
  }

  const openEdit = () =>
    setSeed({
      schema: liveSourceSchema ?? EMPTY_SCHEMA,
      seededFrom: hasSchema ? (liveSchemaSource === 'inferred' ? 'inferred' : 'existing') : 'empty',
    })

  const handleSaveSchema = (schema: Record<string, unknown>, source: 'inferred' | 'manual') =>
    setStreamSchema(schema, source)

  // Only surface a provenance sentence when it's actionable (inferred/manual).
  // Catalog ("came predefined") and the empty state say nothing useful — hide them.
  const schemaSentence =
    hasSchema && liveSchemaSource ? SCHEMA_SOURCE_SENTENCE[liveSchemaSource] : null

  const body = (
    <>
      <div className='flex flex-col'>
        {/* 1. Request — what to fetch (generic-rest only) */}
        {isGenericRest && showConfigure && (
          <Section
            title='Request'
            icon={<Database className='size-4' />}
            initialOpen
            collapsible={false}
            description='What to fetch from the source.'>
            <div className='flex flex-col gap-2 px-1'>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton variant='ghost' className='pr-1.5! text-xs'>
                        {reqValue.method}
                        <ChevronDown className='size-3' />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start' className='[--radius:0.95rem]'>
                      <DropdownMenuRadioGroup
                        value={reqValue.method}
                        onValueChange={(v) =>
                          setRequest({ ...reqValue, method: v as 'GET' | 'POST' })
                        }>
                        {METHOD_OPTIONS.map((option) => (
                          <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}
                            className='pl-3'>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </InputGroupAddon>
                {isSteered ? (
                  <div className='flex-1'>
                    <tokenFieldContext.FieldEditor
                      value={reqValue.path}
                      onChange={(path) => setRequest({ ...reqValue, path })}
                      placeholder='/orders/{id}.json'
                    />
                  </div>
                ) : (
                  <InputGroupInput
                    value={reqValue.path}
                    onChange={(e) => setRequest({ ...reqValue, path: e.target.value })}
                    placeholder='/orders or full URL'
                  />
                )}
              </InputGroup>

              {/* Reveal chips — headers / query params / body stay hidden until clicked. */}
              <div className='flex flex-wrap items-center gap-1.5'>
                <RevealChip
                  label='Headers'
                  count={Object.keys(reqValue.headers).length}
                  active={showHeaders}
                  onClick={() => setShowHeaders((v) => !v)}
                />
                <RevealChip
                  label='Query params'
                  count={Object.keys(reqValue.params).length}
                  active={showParams}
                  onClick={() => setShowParams((v) => !v)}
                />
                {reqValue.method === 'POST' && (
                  <RevealChip
                    label='Body'
                    count={Object.keys(reqValue.body).length > 0 ? 'JSON' : 0}
                    active={showBody}
                    onClick={() => setShowBody((v) => !v)}
                  />
                )}
              </div>

              {showHeaders && (
                <RequestEditorBlock title='Headers'>
                  <RecordKeyValueEditor
                    record={reqValue.headers}
                    onChange={(headers) => setRequest({ ...reqValue, headers })}
                    fieldContext={isSteered ? tokenFieldContext : undefined}
                  />
                </RequestEditorBlock>
              )}
              {showParams && (
                <RequestEditorBlock title='Query params'>
                  <RecordKeyValueEditor
                    record={reqValue.params}
                    onChange={(params) => setRequest({ ...reqValue, params })}
                    fieldContext={isSteered ? tokenFieldContext : undefined}
                  />
                </RequestEditorBlock>
              )}
              {reqValue.method === 'POST' && showBody && (
                <RequestEditorBlock title='Body'>
                  <JsonBodyEditor
                    value={reqValue.body}
                    onChange={(body) => setRequest({ ...reqValue, body })}
                    onValidChange={setBodyValid}
                  />
                </RequestEditorBlock>
              )}
            </div>
          </Section>
        )}

        {/* 2. Sample — the single live test-fetch; feeds the schema below */}
        {showConfigure && (
          <>
            <Section
              title='Sample'
              icon={<FlaskConical className='size-4' />}
              initialOpen
              collapsible={false}
              className={sample ? undefined : '[&_[data-slot=section]]:pb-0'}
              description='Pull a few real records to see what the source returns.'
              actions={(() => {
                const testFetchButton = (
                  <Button
                    variant='outline'
                    size='xs'
                    loading={isSampling}
                    loadingText='Fetching...'
                    aria-disabled={!!sampleBlockReason}
                    className={sampleBlockReason ? 'cursor-not-allowed opacity-50' : undefined}
                    onClick={() => {
                      if (sampleBlockReason) return
                      void handleTestFetch()
                    }}>
                    <FlaskConical />
                    Test fetch
                  </Button>
                )
                return sampleBlockReason ? (
                  <Tooltip content={sampleBlockReason}>{testFetchButton}</Tooltip>
                ) : (
                  testFetchButton
                )
              })()}>
              <StreamSample sample={sample} onUseShape={handleUseShape} />
            </Section>

            {/* 2b. Pagination — read-only "how this fetch paginates" (generic-rest) */}
            {isGenericRest && (
              <PaginationSection connector={connector} stream={stream} sample={sample} />
            )}

            {/* 3. Schema — derived from the sample or hand-edited */}
            <Section
              title='Source schema'
              icon={<Database className='size-4' />}
              initialOpen
              collapsible={false}
              className='[&_[data-slot=section]]:pb-0'
              description={schemaSentence ?? undefined}
              actions={
                <Button variant='ghost' size='xs' onClick={openEdit}>
                  <Pencil />
                  Edit
                </Button>
              }></Section>

            {/* 4. Sync mode */}
            <Section
              title='Sync mode'
              icon={<Database className='size-4' />}
              initialOpen
              collapsible={false}
              actions={
                <RadioTab
                  value={syncMode}
                  onValueChange={(v) =>
                    getConnectorDraftState().setSyncMode(stream.id, v as 'snapshot' | 'incremental')
                  }
                  size='sm'>
                  <RadioTabItem value='snapshot' size='sm'>
                    Snapshot
                  </RadioTabItem>
                  <RadioTabItem value='incremental' size='sm'>
                    Incremental
                  </RadioTabItem>
                </RadioTab>
              }>
              <div className='px-1'>
                <EmptySection
                  icon={SYNC_MODE_COPY[syncMode].icon}
                  title={SYNC_MODE_COPY[syncMode].title}
                  description={SYNC_MODE_COPY[syncMode].description}
                />
              </div>
            </Section>
          </>
        )}

        {/* 5. Mappings */}
        {showMappings && (
          <Section
            title='Mappings'
            icon={<Database className='size-4' />}
            initialOpen
            collapsible={false}
            description='Project subtrees of the source onto target definitions.'
            actions={
              <Button
                variant='ghost'
                size='xs'
                onClick={() => setHelpOpen(true)}
                aria-label='Mapping help'>
                <CircleHelp />
                Help
              </Button>
            }>
            <MappingTree
              connectorId={connector.id}
              streamId={stream.id}
              streamKey={stream.streamKey ?? ''}
              sourcePaths={sourcePaths}
              sourceSchema={liveSourceSchema}
            />
          </Section>
        )}
      </div>

      <SchemaEditorDialog
        open={!!seed}
        onOpenChange={(open) => !open && setSeed(null)}
        title={stream.streamKey ?? 'Stream schema'}
        initial={seed ?? { schema: EMPTY_SCHEMA, seededFrom: 'empty' }}
        policy={{ emitRequired: false, root: 'any', rootLabel: 'record', freeformNames: true }}
        onSave={handleSaveSchema}
      />
      {helpOpen && (
        <StreamGuideDialog
          open={helpOpen}
          onOpenChange={setHelpOpen}
          initialPage='mapping'
          isGenericRest={isGenericRest}
        />
      )}
    </>
  )

  return scroll ? (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      {body}
    </ScrollArea>
  ) : (
    body
  )
}
