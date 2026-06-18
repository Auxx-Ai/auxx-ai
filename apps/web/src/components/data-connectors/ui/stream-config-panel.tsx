// apps/web/src/components/data-connectors/ui/stream-config-panel.tsx
'use client'

import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { Database, Pencil, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import {
  SchemaEditorDialog,
  type SeededFrom,
} from '~/components/schema-editor/ui/schema-editor-dialog'
import { api } from '~/trpc/react'
import { useSourcePaths } from '../hooks/use-source-paths'
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
  const utils = api.useUtils()
  const isGenericRest = !connector.type.startsWith('app:')
  const { defs } = useTargetDefs()

  const [seed, setSeed] = useState<{
    schema: Record<string, unknown>
    seededFrom: SeededFrom
  } | null>(null)
  const [sample, setSample] = useState<{ records: unknown[]; count: number } | null>(null)

  const sourcePaths = useSourcePaths(stream.sourceSchema as Record<string, unknown> | null)
  const hasSchema = !!stream.sourceSchema

  const invalidateStreams = () =>
    void utils.dataConnector.listStreams.invalidate({ id: connector.id })

  const setStreamSchema = api.dataConnector.setStreamSchema.useMutation({
    onSuccess: invalidateStreams,
    onError: (e) => toastError({ title: 'Could not save schema', description: e.message }),
  })
  const setStreamRequestConfig = api.dataConnector.setStreamRequestConfig.useMutation({
    onSuccess: invalidateStreams,
    onError: (e) => toastError({ title: 'Could not save request', description: e.message }),
  })
  const addMapping = api.dataConnector.addMapping.useMutation({
    onSuccess: () => void utils.dataConnector.listMappings.invalidate({ streamId: stream.id }),
    onError: (e) => toastError({ title: 'Could not add mapping', description: e.message }),
  })
  const sampleFetch = api.dataConnector.sampleFetch.useMutation({
    onError: (e) => toastError({ title: 'Test-fetch failed', description: e.message }),
  })

  const requestConfig = (stream.requestConfig ?? {}) as {
    path?: string
    method?: 'GET' | 'POST'
    recordsPath?: string
  }
  const [path, setPath] = useState(requestConfig.path ?? '')
  const [method, setMethod] = useState<'GET' | 'POST'>(requestConfig.method ?? 'GET')
  const [recordsPath, setRecordsPath] = useState(requestConfig.recordsPath ?? '')
  const syncMode = (stream.syncMode as 'snapshot' | 'incremental' | 'webhook') ?? 'snapshot'

  const handleTestFetch = async () => {
    const result = await sampleFetch.mutateAsync({
      id: connector.id,
      streamKey: stream.streamKey,
      requestConfig: isGenericRest
        ? { path, method, recordsPath: recordsPath || undefined }
        : undefined,
    })
    setSample(result)
    // Auto-set inferred schema when the stream has none yet.
    if (!hasSchema && result.records[0]) {
      const inferred = inferJsonSchema(result.records[0]) as Record<string, unknown>
      setStreamSchema.mutate({
        streamId: stream.id,
        sourceSchema: inferred,
        schemaSource: 'inferred',
      })
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
    setStreamSchema.mutate({ streamId: stream.id, sourceSchema: schema, schemaSource: source })

  const handleSaveRequest = () =>
    setStreamRequestConfig.mutate({
      streamId: stream.id,
      requestConfig: { path, method, recordsPath: recordsPath || undefined },
    })

  const handleAddMapping = () => {
    const firstDef = defs[0]
    if (!firstDef) {
      toastError({
        title: 'No entity definitions',
        description: 'Create an entity definition first.',
      })
      return
    }
    addMapping.mutate({
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
                <Button
                  variant='ghost'
                  size='xs'
                  loading={sampleFetch.isPending}
                  onClick={handleGenerate}>
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
              <div className='flex items-center gap-2'>
                <Select value={method} onValueChange={(v) => setMethod(v as 'GET' | 'POST')}>
                  <SelectTrigger size='sm' className='w-24'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='GET'>GET</SelectItem>
                    <SelectItem value='POST'>POST</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder='/orders'
                />
              </div>
              <Input
                value={recordsPath}
                onChange={(e) => setRecordsPath(e.target.value)}
                placeholder='Records JSONPath (e.g. data.orders)'
              />
              <Button
                className='self-start'
                size='sm'
                loading={setStreamRequestConfig.isPending}
                onClick={handleSaveRequest}>
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
                setStreamRequestConfig.mutate({
                  streamId: stream.id,
                  requestConfig: { path, method, recordsPath: recordsPath || undefined },
                  syncMode: v as 'snapshot' | 'incremental',
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
            <Button
              variant='ghost'
              size='xs'
              loading={addMapping.isPending}
              onClick={handleAddMapping}>
              <Plus />
              Add mapping
            </Button>
          }>
          <MappingTree
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
          <StreamDryRun
            sample={sample}
            onTestFetch={handleTestFetch}
            testing={sampleFetch.isPending}
          />
        </Section>
      </div>

      <SchemaEditorDialog
        open={!!seed}
        onOpenChange={(open) => !open && setSeed(null)}
        title={stream.streamKey}
        initial={seed ?? { schema: EMPTY_SCHEMA, seededFrom: 'empty' }}
        policy={{ emitRequired: false, root: 'any' }}
        onSave={handleSaveSchema}
      />
    </ScrollArea>
  )
}
