// apps/web/src/components/data-connectors/ui/source-config-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Globe, Plus, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { generateId, type KeyValue, KeyValueList } from '~/components/global/http-request'
import { readFieldNodes, SchemaField, seedDefaults } from '~/components/global/schema-form'
import { api } from '~/trpc/react'
import { useRegisterSaver } from '../hooks/use-connector-edits'

/** Order-independent serialization for dirty comparison (header order is cosmetic). */
function canonRecord(record: Record<string, string>): string {
  return JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

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
 * The connector-level fetch config (05 §3, 05a §5), rendered inline inside the
 * Connection section. Branches on the persisted `definitionKind` (05c §7), not a
 * `type` prefix sniff:
 * - 'builtin' (generic-rest, incl. template instances) → an HTTP slice: base URL
 *   + shared non-secret headers (per-stream path/body/pagination lives in the
 *   stream drill). Built with the shared http-request components.
 * - 'app' → a schema-driven config form from the connector's declared `config`
 *   schema, fetched via `dataConnector.connectorSchema` (the shared schema-form
 *   renderer).
 */
export function SourceConfigPanel({ connector }: SourceConfigPanelProps) {
  const utils = api.useUtils()
  const isApp = connector.definitionKind === 'app'

  const update = api.dataConnector.update.useMutation({
    onSuccess: () => void utils.dataConnector.getById.invalidate({ id: connector.id }),
    onError: (e) => toastError({ title: 'Could not save', description: e.message }),
  })
  // Awaitable so the connector-wide save bar can commit it alongside other sections.
  const save = (config: Record<string, unknown>) => update.mutateAsync({ id: connector.id, config })

  if (!isApp) {
    return <GenericRestSource connector={connector} onSave={save} saving={update.isPending} />
  }

  return <AppConfigSource connector={connector} onSave={save} saving={update.isPending} />
}

// ── generic-rest: base URL + shared headers ───────────────────────────────────

function GenericRestSource({
  connector,
  onSave,
  saving,
}: {
  connector: Connector
  onSave: (config: Record<string, unknown>) => Promise<unknown> | unknown
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
    return onSave({ ...(connector.config ?? {}), endpoint })
  }

  // Dirty vs the saved slice — the trailing blank header row is dropped by
  // `keyValueToRecord`, so an untouched form reads clean.
  const isDirty =
    baseUrl !== (config.endpoint?.baseUrl ?? '') ||
    canonRecord(keyValueToRecord(headers)) !== canonRecord(config.endpoint?.headers ?? {})
  useRegisterSaver('source', isDirty, saving, handleSave)

  return (
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
    </div>
  )
}

// ── app / template: schema-driven config form ─────────────────────────────────

function AppConfigSource({
  connector,
  onSave,
  saving,
}: {
  connector: Connector
  onSave: (config: Record<string, unknown>) => Promise<unknown> | unknown
  saving: boolean
}) {
  // The connector's declared config schema, fetched from the app catalog via
  // tRPC (05c §3). Falls back to a `config._schema` blob if the catalog omits it.
  const { data } = api.dataConnector.connectorSchema.useQuery({ id: connector.id })
  const schema =
    (data?.configJsonSchema as Record<string, unknown> | null) ??
    (connector.config as { _schema?: Record<string, unknown> })?._schema ??
    null
  const fields = useMemo(() => readFieldNodes(schema), [schema])
  const baseline = useMemo(
    () => ({ ...seedDefaults(fields), ...(connector.config ?? {}) }) as Record<string, unknown>,
    [fields, connector.config]
  )
  const [values, setValues] = useState<Record<string, unknown>>(() => baseline)

  // Dirty per declared field (order-independent); feeds the connector-wide save bar.
  const isDirty = fields.some(
    (f) => JSON.stringify(values[f.key]) !== JSON.stringify(baseline[f.key])
  )
  useRegisterSaver('source', isDirty, saving, () =>
    onSave({ ...(connector.config ?? {}), ...values })
  )

  if (fields.length === 0) {
    return (
      <div className='p-6 text-sm text-muted-foreground'>
        This connector has no user-configurable options. Its request is defined in code.
      </div>
    )
  }

  return (
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
    </div>
  )
}
