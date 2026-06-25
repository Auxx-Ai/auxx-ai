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
import { ChevronDown, Database, FlaskConical, Pencil, RefreshCw, Waypoints } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import type { RouterOutputs } from '~/trpc/react'
import { useBufferedConfig } from '../hooks/use-buffered-config'
import { useSourcePaths } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import {
  type BackfillWindowSpan,
  describePagination,
  type PaginationSpec,
} from '../lib/describe-pagination'
import { detectPagination } from '../lib/detect-pagination'
import { MappingTree } from './mapping-tree'
import { PaginationSummary } from './pagination-summary'
import {
  JsonBodyEditor,
  RecordKeyValueEditor,
  RequestEditorBlock,
  RevealChip,
} from './request-editors'
import { StreamSample } from './stream-sample'
import { WebhookTriggerBindingSection } from './webhook-trigger-binding-section'

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

  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const [sample, setSample] = useState<{
    response: unknown
    recordCount: number
    responseHeaders?: Record<string, string>
  } | null>(null)

  const sourcePaths = useSourcePaths(stream.sourceSchema as Record<string, unknown> | null)
  const hasSchema = !!stream.sourceSchema

  // Single mutation surface for the stream: optimistic toggles (setSyncMode,
  // …) + deliberate/imperative saves (saveRequestConfig, setStreamSchema,
  // sampleFetch). Sync-mode is optimistic; the request form is a buffered
  // explicit Save (flip mode to 'auto' for autosave — plan §5/§6).
  const {
    setSyncMode,
    saveRequestConfig,
    setStreamSchema,
    sampleFetch,
    applyPagination,
    isSavingRequest,
    isSampling,
  } = useStreamMutations(connector.id)

  const requestConfig = (stream.requestConfig ?? {}) as {
    path?: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    params?: Record<string, unknown>
    body?: Record<string, unknown>
  }
  const request = useBufferedConfig(
    {
      path: requestConfig.path ?? '',
      method: requestConfig.method ?? 'GET',
      headers: requestConfig.headers ?? {},
      params: requestConfig.params ?? {},
      body: requestConfig.body ?? {},
    },
    (draft) => saveRequestConfig(stream.id, draft),
    { mode: 'manual' }
  )

  // Progressive disclosure — each sub-editor stays hidden until revealed, but
  // starts open when its config already has content (a saved request is never
  // hidden). `bodyValid` gates Save on a JSON parse error.
  const [showHeaders, setShowHeaders] = useState(
    () => Object.keys(requestConfig.headers ?? {}).length > 0
  )
  const [showParams, setShowParams] = useState(
    () => Object.keys(requestConfig.params ?? {}).length > 0
  )
  const [showBody, setShowBody] = useState(() => Object.keys(requestConfig.body ?? {}).length > 0)
  const [bodyValid, setBodyValid] = useState(true)
  const rawSyncMode = (stream.syncMode as 'snapshot' | 'incremental' | 'webhook') ?? 'snapshot'
  // The picker only exposes snapshot/incremental; treat webhook as snapshot here.
  const syncMode: 'snapshot' | 'incremental' =
    rawSyncMode === 'incremental' ? 'incremental' : 'snapshot'

  const handleTestFetch = async () => {
    const result = await sampleFetch({
      id: connector.id,
      streamKey: stream.streamKey,
      requestConfig: isGenericRest ? request.value : undefined,
    })
    setSample(result)
    // Auto-set the inferred schema (the raw response shape) when none exists yet.
    if (!hasSchema && result.response != null) {
      const inferred = inferJsonSchema(result.response) as Record<string, unknown>
      setStreamSchema(stream.id, inferred, 'inferred')
    }
  }

  // Derive the source schema directly from the current sample's shape. Only
  // offered once a sample exists (the Sample section hides it otherwise).
  const handleUseShape = () => {
    if (sample?.response == null) return
    const inferred = inferJsonSchema(sample.response) as Record<string, unknown>
    setStreamSchema(stream.id, inferred, 'inferred')
  }

  const openEdit = () =>
    setSeed({
      schema: (stream.sourceSchema as Record<string, unknown>) ?? EMPTY_SCHEMA,
      seededFrom: hasSchema
        ? stream.schemaSource === 'inferred'
          ? 'inferred'
          : 'existing'
        : 'empty',
    })

  const handleSaveSchema = (schema: Record<string, unknown>, source: 'inferred' | 'manual') =>
    setStreamSchema(stream.id, schema, source)

  // Only surface a provenance sentence when it's actionable (inferred/manual).
  // Catalog ("came predefined") and the empty state say nothing useful — hide them.
  const schemaSentence = hasSchema ? SCHEMA_SOURCE_SENTENCE[stream.schemaSource] : null

  // Pagination transparency (Step 10): describe the stream's configured spec and,
  // after a test fetch, an inform-only detected proposal. Read-only — both render
  // through PaginationSummary. The "Use this" apply is wired but hidden (§3.4).
  const pagination = (stream.requestConfig as { pagination?: PaginationSpec } | null)?.pagination
  const backfillWindowSpan = (
    connector.config as { backfillWindowSpan?: BackfillWindowSpan } | null
  )?.backfillWindowSpan
  const pageSizeFallback = numericParam(requestConfig.params)
  const configuredPagination = describePagination(pagination, {
    backfillWindowSpan,
    pageSizeFallback,
  })
  const detected = sample
    ? detectPagination({
        body: sample.response,
        headers: sample.responseHeaders,
        pageRecordCount: sample.recordCount,
        pageLimit: pagination?.pageSize ?? pageSizeFallback,
      })
    : null
  const detectedPagination = detected
    ? describePagination(detected.spec, { pageSizeFallback })
    : null

  const handleUsePagination = () => {
    if (!detected) return
    const merged = {
      ...((stream.requestConfig as Record<string, unknown>) ?? {}),
      pagination: detected.spec,
    }
    void applyPagination(stream.id, merged as Parameters<typeof applyPagination>[1])
  }

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
                        {request.value.method}
                        <ChevronDown className='size-3' />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start' className='[--radius:0.95rem]'>
                      <DropdownMenuRadioGroup
                        value={request.value.method}
                        onValueChange={(v) =>
                          request.set({ ...request.value, method: v as 'GET' | 'POST' })
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
                <InputGroupInput
                  value={request.value.path}
                  onChange={(e) => request.set({ ...request.value, path: e.target.value })}
                  placeholder='/orders or full URL'
                />
                <InputGroupAddon align='inline-end'>
                  <Button
                    size='xs'
                    variant='outline'
                    className='me-0.5'
                    disabled={!request.isDirty || isSavingRequest || !bodyValid}
                    loading={isSavingRequest}
                    onClick={() => void request.commit()}>
                    Save request
                  </Button>
                </InputGroupAddon>
              </InputGroup>

              {/* Reveal chips — headers / query params / body stay hidden until clicked. */}
              <div className='flex flex-wrap items-center gap-1.5'>
                <RevealChip
                  label='Headers'
                  count={Object.keys(request.value.headers).length}
                  active={showHeaders}
                  onClick={() => setShowHeaders((v) => !v)}
                />
                <RevealChip
                  label='Query params'
                  count={Object.keys(request.value.params).length}
                  active={showParams}
                  onClick={() => setShowParams((v) => !v)}
                />
                {request.value.method === 'POST' && (
                  <RevealChip
                    label='Body'
                    count={Object.keys(request.value.body).length > 0 ? 'JSON' : 0}
                    active={showBody}
                    onClick={() => setShowBody((v) => !v)}
                  />
                )}
              </div>

              {showHeaders && (
                <RequestEditorBlock title='Headers'>
                  <RecordKeyValueEditor
                    record={request.value.headers}
                    onChange={(headers) => request.set({ ...request.value, headers })}
                  />
                </RequestEditorBlock>
              )}
              {showParams && (
                <RequestEditorBlock title='Query params'>
                  <RecordKeyValueEditor
                    record={request.value.params}
                    onChange={(params) => request.set({ ...request.value, params })}
                  />
                </RequestEditorBlock>
              )}
              {request.value.method === 'POST' && showBody && (
                <RequestEditorBlock title='Body'>
                  <JsonBodyEditor
                    value={request.value.body}
                    onChange={(body) => request.set({ ...request.value, body })}
                    onValidChange={setBodyValid}
                  />
                </RequestEditorBlock>
              )}
            </div>
          </Section>
        )}

        {/* 1b. Webhook trigger binding — only when the connector syncs on webhooks
            (app-trigger sync bridge §7). Binds this stream to an app trigger + maps
            the payload tokens that steer the request above. */}
        {isGenericRest && showConfigure && connector.syncBehavior === 'webhook' && (
          <WebhookTriggerBindingSection connector={connector} stream={stream} />
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
              actions={
                <Button
                  variant='outline'
                  size='xs'
                  loading={isSampling}
                  loadingText='Fetching...'
                  onClick={() => void handleTestFetch()}>
                  <FlaskConical />
                  Test fetch
                </Button>
              }>
              <StreamSample sample={sample} onUseShape={handleUseShape} />
            </Section>

            {/* 2b. Pagination — read-only "how this fetch paginates" (generic-rest) */}
            {isGenericRest && (
              <Section
                title='Pagination'
                icon={<Waypoints className='size-4' />}
                initialOpen
                collapsible={false}
                description='How this fetch reads through multiple pages.'>
                <div className='flex flex-col gap-3'>
                  <PaginationSummary description={configuredPagination} variant='configured' />
                  {detectedPagination && detected && (
                    <PaginationSummary
                      description={detectedPagination}
                      variant='detected'
                      note={detected.note}
                      onUse={handleUsePagination}
                      useLoading={isSavingRequest}
                    />
                  )}
                </div>
              </Section>
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
                    // Pass the whole buffered request so toggling mode never drops
                    // saved headers/params/body (setStreamRequestConfig writes it whole).
                    setSyncMode(stream.id, v as 'snapshot' | 'incremental', request.value)
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
            description='Project subtrees of the source onto target definitions.'>
            <MappingTree
              connectorId={connector.id}
              streamId={stream.id}
              streamKey={stream.streamKey ?? ''}
              mappings={stream.mappings}
              sourcePaths={sourcePaths}
              sourceSchema={stream.sourceSchema as Record<string, unknown> | null}
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

/** Pull a numeric page-size from common limit-style query params, for the size row. */
function numericParam(params?: Record<string, unknown>): number | undefined {
  for (const key of ['limit', 'per_page', 'page_size', 'maxResults', 'pageSize']) {
    const value = params?.[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  }
  return undefined
}
