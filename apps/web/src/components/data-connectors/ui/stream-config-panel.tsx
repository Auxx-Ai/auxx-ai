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
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, Database, Pencil, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import type { api } from '~/trpc/react'
import { useBufferedConfig } from '../hooks/use-buffered-config'
import { useSourcePaths } from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { useTargetDefs } from '../hooks/use-target-defs'
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
  const { defs } = useTargetDefs()

  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const [sample, setSample] = useState<{ records: unknown[]; count: number } | null>(null)

  const sourcePaths = useSourcePaths(stream.sourceSchema as Record<string, unknown> | null)
  const hasSchema = !!stream.sourceSchema

  // Single mutation surface for the stream: optimistic toggles (setSyncMode,
  // …) + deliberate/imperative saves (saveRequestConfig, setStreamSchema,
  // addMapping, sampleFetch). Sync-mode is optimistic; the request form is a
  // buffered explicit Save (flip mode to 'auto' for autosave — plan §5/§6).
  const {
    setSyncMode,
    saveRequestConfig,
    setStreamSchema,
    addMapping,
    sampleFetch,
    isSavingRequest,
    isAddingMapping,
    isSampling,
  } = useStreamMutations(connector.id)

  const requestConfig = (stream.requestConfig ?? {}) as {
    path?: string
    method?: 'GET' | 'POST'
    recordsPath?: string
  }
  const request = useBufferedConfig(
    {
      path: requestConfig.path ?? '',
      method: requestConfig.method ?? 'GET',
      recordsPath: requestConfig.recordsPath ?? '',
    },
    (draft) =>
      saveRequestConfig(stream.id, {
        path: draft.path,
        method: draft.method,
        recordsPath: draft.recordsPath || undefined,
      }),
    { mode: 'manual' }
  )
  const syncMode = (stream.syncMode as 'snapshot' | 'incremental' | 'webhook') ?? 'snapshot'

  const handleTestFetch = async () => {
    const result = await sampleFetch({
      id: connector.id,
      streamKey: stream.streamKey,
      requestConfig: isGenericRest
        ? {
            path: request.value.path,
            method: request.value.method,
            recordsPath: request.value.recordsPath || undefined,
          }
        : undefined,
    })
    setSample(result)
    // Auto-set inferred schema when the stream has none yet.
    if (!hasSchema && result.records[0]) {
      const inferred = inferJsonSchema(result.records[0]) as Record<string, unknown>
      setStreamSchema(stream.id, inferred, 'inferred')
    }
  }

  const handleGenerate = () => {
    if (!sample?.records[0]) {
      void handleTestFetch()
      return
    }
    const inferred = inferJsonSchema(sample.records[0]) as Record<string, unknown>
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

  const handleAddMapping = () => {
    const firstDef = defs[0]
    if (!firstDef) {
      toastError({
        title: 'No entity definitions',
        description: 'Create an entity definition first.',
      })
      return
    }
    addMapping({
      dataConnectorStreamId: stream.id,
      rootPath: '',
      linkMode: 'upsert',
      targetMode: 'contributing',
      entityDefinitionId: firstDef.entityDefinitionId,
      identityStrategy: { kind: 'connectorExternalId' },
    })
  }

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
                Test-fetch returned {sample.count} record{sample.count === 1 ? '' : 's'}
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
            <div className='flex flex-col gap-3 px-1'>
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
              </InputGroup>
              <Input
                value={request.value.recordsPath}
                onChange={(e) => request.set({ ...request.value, recordsPath: e.target.value })}
                placeholder='Records JSONPath (e.g. data.orders)'
              />
              <Button
                className='self-start'
                size='sm'
                disabled={!request.isDirty}
                loading={isSavingRequest}
                onClick={() => void request.commit()}>
                Save request
              </Button>
            </div>
          </Section>
        )}

        <Section
          title='Sync mode'
          icon={<Database className='size-4' />}
          initialOpen
          collapsible={false}>
          <div className='px-1'>
            <RadioTab
              value={syncMode}
              onValueChange={(v) =>
                setSyncMode(stream.id, v as 'snapshot' | 'incremental', {
                  path: request.value.path,
                  method: request.value.method,
                  recordsPath: request.value.recordsPath || undefined,
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
          </div>
        </Section>

        {/* Layer B — mappings */}
        <Section
          title='Mappings'
          icon={<Database className='size-4' />}
          initialOpen
          collapsible={false}
          description='Project subtrees of the source onto target definitions.'
          actions={
            <Button variant='ghost' size='xs' loading={isAddingMapping} onClick={handleAddMapping}>
              <Plus />
              Add mapping
            </Button>
          }>
          <MappingTree
            connectorId={connector.id}
            streamId={stream.id}
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
        title={stream.streamKey}
        initial={seed ?? { schema: EMPTY_SCHEMA, seededFrom: 'empty' }}
        policy={{ emitRequired: false, root: 'any', rootLabel: 'record', freeformNames: true }}
        onSave={handleSaveSchema}
      />
    </ScrollArea>
  )
}
