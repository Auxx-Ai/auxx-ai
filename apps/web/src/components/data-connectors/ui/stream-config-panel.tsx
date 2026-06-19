// apps/web/src/components/data-connectors/ui/stream-config-panel.tsx
'use client'

import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { Badge } from '@auxx/ui/components/badge'
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
import { ChevronDown, Database, Pencil, RefreshCw, Sparkles, Waypoints } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import type { api } from '~/trpc/react'
import { useBufferedConfig } from '../hooks/use-buffered-config'
import { useSourcePaths } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { MappingTree } from './mapping-tree'
import { StreamDryRun } from './stream-dry-run'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>
type Stream = NonNullable<ReturnType<typeof api.dataConnector.listStreams.useQuery>['data']>[number]

const SCHEMA_SOURCE_LABEL: Record<string, string> = {
  catalog: 'Catalog',
  inferred: 'Inferred',
  manual: 'Manual',
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
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

const EMPTY_SCHEMA = { type: 'object', properties: {} }

/**
 * Stream drill (05 §4) — two layers:
 *  - Layer A: the source schema (provenance badge + Edit + Generate-from-result
 *    via live test-fetch → inferJsonSchema + Save-as-example).
 *  - Layer B: the mapping fan-out tree (target/linkMode/identity/fields).
 * Plus per-stream request (generic-rest) + sync mode + a dry-run preview.
 */
export function StreamConfigPanel({ connector, stream, onPromoteField }: StreamConfigPanelProps) {
  const isGenericRest = !connector.type.startsWith('app:')

  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const [sample, setSample] = useState<{ response: unknown; recordCount: number } | null>(null)

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
    isSavingRequest,
    isSampling,
  } = useStreamMutations(connector.id)

  const requestConfig = (stream.requestConfig ?? {}) as {
    path?: string
    method?: 'GET' | 'POST'
  }
  const request = useBufferedConfig(
    {
      path: requestConfig.path ?? '',
      method: requestConfig.method ?? 'GET',
    },
    (draft) => saveRequestConfig(stream.id, { path: draft.path, method: draft.method }),
    { mode: 'manual' }
  )
  const rawSyncMode = (stream.syncMode as 'snapshot' | 'incremental' | 'webhook') ?? 'snapshot'
  // The picker only exposes snapshot/incremental; treat webhook as snapshot here.
  const syncMode: 'snapshot' | 'incremental' =
    rawSyncMode === 'incremental' ? 'incremental' : 'snapshot'

  const handleTestFetch = async () => {
    const result = await sampleFetch({
      id: connector.id,
      streamKey: stream.streamKey,
      requestConfig: isGenericRest
        ? { path: request.value.path, method: request.value.method }
        : undefined,
    })
    setSample(result)
    // Auto-set the inferred schema (the raw response shape) when none exists yet.
    if (!hasSchema && result.response != null) {
      const inferred = inferJsonSchema(result.response) as Record<string, unknown>
      setStreamSchema(stream.id, inferred, 'inferred')
    }
  }

  const handleGenerate = () => {
    if (sample?.response == null) {
      void handleTestFetch()
      return
    }
    const inferred = inferJsonSchema(sample.response) as Record<string, unknown>
    setSeed({ schema: inferred, seededFrom: 'inferred' })
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

  const badgeLabel = hasSchema ? (SCHEMA_SOURCE_LABEL[stream.schemaSource] ?? 'Manual') : 'None'

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        {/* Layer A — source schema */}
        <Section
          title='Source schema'
          icon={<Database className='size-4' />}
          initialOpen
          collapsible={false}
          actions={
            <div className='flex items-center gap-1'>
              <Tooltip content='Run a live test-fetch and infer the schema from the result'>
                <Button variant='ghost' size='xs' loading={isSampling} onClick={handleGenerate}>
                  <Sparkles />
                  Generate from result
                </Button>
              </Tooltip>
              <Button variant='ghost' size='xs' onClick={openEdit}>
                <Pencil />
                Edit
              </Button>
            </div>
          }>
          <div className='flex items-center gap-2 px-1 pb-2'>
            <span className='text-xs text-muted-foreground'>Provenance</span>
            <Badge variant='outline' size='sm'>
              {badgeLabel}
            </Badge>
            {sample && (
              <span className='text-xs text-muted-foreground'>
                Test-fetch returned {sample.recordCount} record{sample.recordCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </Section>

        {/* Per-stream request (generic-rest only) + sync mode */}
        {isGenericRest && (
          <Section
            title='Request'
            icon={<Database className='size-4' />}
            initialOpen
            collapsible={false}>
            <div className='px-1'>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton variant='ghost' className='!pr-1.5 text-xs'>
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
                    disabled={!request.isDirty || isSavingRequest}
                    loading={isSavingRequest}
                    onClick={() => void request.commit()}>
                    Save request
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </Section>
        )}

        <Section
          title='Sync mode'
          icon={<Database className='size-4' />}
          initialOpen
          collapsible={false}
          actions={
            <RadioTab
              value={syncMode}
              onValueChange={(v) =>
                setSyncMode(stream.id, v as 'snapshot' | 'incremental', {
                  path: request.value.path,
                  method: request.value.method,
                })
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

        {/* Layer B — mappings */}
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
            onPromoteField={onPromoteField}
          />
        </Section>

        {/* Sample + dry-run */}
        <Section
          title='Test &amp; preview'
          icon={<Database className='size-4' />}
          initialOpen
          collapsible={false}>
          <StreamDryRun sample={sample} onTestFetch={handleTestFetch} testing={isSampling} />
        </Section>
      </div>

      <SchemaEditorDialog
        open={!!seed}
        onOpenChange={(open) => !open && setSeed(null)}
        title={stream.streamKey ?? 'Stream schema'}
        initial={seed ?? { schema: EMPTY_SCHEMA, seededFrom: 'empty' }}
        policy={{ emitRequired: false, root: 'any', rootLabel: 'record', freeformNames: true }}
        onSave={handleSaveSchema}
      />
    </ScrollArea>
  )
}
