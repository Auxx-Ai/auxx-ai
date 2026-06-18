// apps/web/src/components/data-connectors/ui/source-config-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Globe, Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { generateId, type KeyValue, KeyValueList } from '~/components/global/http-request'
import { readFieldNodes, SchemaField, seedDefaults } from '~/components/global/schema-form'
import { api } from '~/trpc/react'

/** Connector headers are stored as a plain `Record<string, string>` (the shape the
 * generic-rest fetch sends + the tRPC schema validates), not the workflow node's
 * serialized string — so convert directly here rather than via the http-request
 * string helpers (which expect/produce a string). */
function recordToKeyValue(record: Record<string, string>): KeyValue[] {
  return Object.entries(record).map(([key, value]) => ({ id: generateId(), key, value }))
}

function keyValueToRecord(list: KeyValue[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const { key, value } of list) {
    const trimmed = key.trim()
    if (trimmed) record[trimmed] = value
  }
  return record
}

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

interface SourceConfigPanelProps {
  connector: Connector
}

/**
 * The `source` drill panel — the connector-level fetch config (05 §3, 05a §5):
 * - generic-rest → an HTTP slice: base URL + shared non-secret headers (per-stream
 *   path/body/pagination lives in the stream drill). Built with the shared
 *   http-request components using the default plain field editor (no TipTap /
 *   variable explorer / ReactFlow in this route).
 * - app/template → a schema-driven config form from the connector's declared
 *   `config` schema (the shared schema-form renderer).
 */
export function SourceConfigPanel({ connector }: SourceConfigPanelProps) {
  const utils = api.useUtils()
  const isGenericRest = !connector.type.startsWith('app:')

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not save', description: e.message }),
  })

  if (isGenericRest) {
    return (
      <GenericRestSource
        connector={connector}
        onSave={(config) => update.mutate({ id: connector.id, config })}
        saving={update.isPending}
      />
    )
  }

  return (
    <AppConfigSource
      connector={connector}
      onSave={(config) => update.mutate({ id: connector.id, config })}
      saving={update.isPending}
    />
  )
}

// ── generic-rest: base URL + shared headers ───────────────────────────────────

function GenericRestSource({
  connector,
  onSave,
  saving,
}: {
  connector: Connector
  onSave: (config: Record<string, unknown>) => void
  saving: boolean
}) {
  const config = (connector.config ?? {}) as {
    endpoint?: { baseUrl?: string; headers?: Record<string, string> }
  }
  const [baseUrl, setBaseUrl] = useState(config.endpoint?.baseUrl ?? '')
  // The list keeps a trailing blank row so the user can always add another.
  const [headers, setHeaders] = useState<KeyValue[]>(() => {
    const parsed = recordToKeyValue(config.endpoint?.headers ?? {})
    // Keep a trailing blank row so the user can always add another.
    return [...parsed, { id: generateId(), key: '', value: '' }]
  })

  const addRow = () => setHeaders((h) => [...h, { id: generateId(), key: '', value: '' }])

  const handleSave = () => {
    const endpoint = {
      ...(config.endpoint ?? {}),
      baseUrl,
      headers: keyValueToRecord(headers),
    }
    onSave({ ...(connector.config ?? {}), endpoint })
  }

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        <Section
          title='Endpoint'
          icon={<Globe className='size-4' />}
          initialOpen
          collapsible={false}
          description='Base URL shared by every stream on this connector.'>
          <Field className='px-1'>
            <FieldLabel>Base URL</FieldLabel>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder='https://api.example.com/v1'
            />
          </Field>
        </Section>

        <Section
          title='Shared headers'
          icon={<Globe className='size-4' />}
          initialOpen
          collapsible={false}
          description='Non-secret headers sent on every request. Secrets live in the bound credential, never here.'
          actions={
            <Button variant='ghost' size='xs' onClick={addRow}>
              <Plus />
              Add header
            </Button>
          }>
          <div className='px-1'>
            <KeyValueList readonly={false} list={headers} onChange={setHeaders} onAdd={addRow} />
          </div>
        </Section>

        <div className='p-3'>
          <Button
            className='self-start'
            loading={saving}
            loadingText='Saving...'
            onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}

// ── app / template: schema-driven config form ─────────────────────────────────

function AppConfigSource({
  connector,
  onSave,
  saving,
}: {
  connector: Connector
  onSave: (config: Record<string, unknown>) => void
  saving: boolean
}) {
  // The connector's declared config schema isn't exposed via tRPC yet (it lives in
  // the app catalog / lib registry). When available it would render here; for now
  // we render whatever schema the config blob carries under `_schema`, else a note.
  const schema = (connector.config as { _schema?: Record<string, unknown> })?._schema ?? null
  const fields = useMemo(() => readFieldNodes(schema), [schema])
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...seedDefaults(fields),
    ...(connector.config ?? {}),
  }))

  if (fields.length === 0) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>
        This connector has no user-configurable options. Its request is defined in code.
        {/* TODO: surface the connector's declared `config` schema via tRPC so app/template
            connectors render their options here (05a §2). */}
      </div>
    )
  }

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        <Section
          title='Connector settings'
          icon={<Settings2 className='size-4' />}
          initialOpen
          collapsible={false}
          description='Options declared by this connector.'>
          <div className='flex flex-col gap-4 px-1'>
            {fields.map((entry) => (
              <SchemaField
                key={entry.key}
                entry={entry}
                value={values[entry.key]}
                onChange={(next) => setValues((v) => ({ ...v, [entry.key]: next }))}
              />
            ))}
          </div>
        </Section>

        <div className='p-3'>
          <Button
            className='self-start'
            loading={saving}
            loadingText='Saving...'
            onClick={() => onSave({ ...(connector.config ?? {}), ...values })}>
            Save
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
