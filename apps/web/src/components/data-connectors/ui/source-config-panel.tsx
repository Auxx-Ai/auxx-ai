// apps/web/src/components/data-connectors/ui/source-config-panel.tsx
'use client'

import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { Globe, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { readFieldNodes, SchemaField, seedDefaults } from '~/components/global/schema-form'
import { api } from '~/trpc/react'
import { useRegisterSaver } from '../hooks/use-connector-edits'
import { RecordKeyValueEditor, RequestEditorBlock, RevealChip } from './request-editors'

/** Order-independent serialization for dirty comparison (header order is cosmetic). */
function canonRecord(record: Record<string, string>): string {
  return JSON.stringify(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
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
  const [headers, setHeaders] = useState<Record<string, string>>(config.endpoint?.headers ?? {})
  // Reveal the headers editor by default when the connector already has some.
  const [showHeaders, setShowHeaders] = useState(
    () => Object.keys(config.endpoint?.headers ?? {}).length > 0
  )

  const handleSave = () => {
    const endpoint = { ...(config.endpoint ?? {}), baseUrl, headers }
    return onSave({ ...(connector.config ?? {}), endpoint })
  }

  const isDirty =
    baseUrl !== (config.endpoint?.baseUrl ?? '') ||
    canonRecord(headers) !== canonRecord(config.endpoint?.headers ?? {})
  useRegisterSaver('source', isDirty, saving, handleSave)

  return (
    <div className='flex flex-col'>
      <Section
        title='Endpoint'
        icon={<Globe className='size-4' />}
        initialOpen
        collapsible={false}
        description='Base URL and shared headers sent on every request. Secrets live in the bound credential, never here.'>
        <div className='flex flex-col gap-3 px-1'>
          <Field>
            <FieldLabel>Base URL</FieldLabel>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder='https://api.example.com/v1'
            />
          </Field>

          <div className='flex flex-wrap items-center gap-1.5'>
            <RevealChip
              label='Headers'
              count={Object.keys(headers).length}
              active={showHeaders}
              onClick={() => setShowHeaders((v) => !v)}
            />
          </div>

          {showHeaders && (
            <RequestEditorBlock title='Shared headers'>
              <RecordKeyValueEditor record={headers} onChange={setHeaders} />
            </RequestEditorBlock>
          )}
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
