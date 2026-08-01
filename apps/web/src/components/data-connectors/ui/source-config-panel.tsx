// apps/web/src/components/data-connectors/ui/source-config-panel.tsx
'use client'

import type { ActionInputHint } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import { Section } from '@auxx/ui/components/section'
import { Globe, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { type FieldEntry, readFieldNodes, seedDefaults } from '~/components/global/schema-form'
import { BaseType } from '~/components/workflow/types'
import { api, type RouterOutputs } from '~/trpc/react'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'
import { RecordKeyValueEditor, RequestEditorBlock, RevealChip } from './request-editors'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

/** `FieldType` is a const object, not a TS enum — its value union has to be spelled out. */
type FieldTypeValue = (typeof FieldType)[keyof typeof FieldType]

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
  const isApp = connector.definitionKind === 'app'
  if (!isApp) {
    return <GenericRestSource connector={connector} />
  }
  return <AppConfigSource connector={connector} />
}

// ── generic-rest: base URL + shared headers ───────────────────────────────────

function GenericRestSource({ connector }: { connector: Connector }) {
  // Render from the draft store (optimistic) — nothing persists until the save bar's
  // `commit()` (the unified saving model, plans/data-connectors/v4).
  const config = useConnectorDraftStore((s) => s.draft.config) as {
    endpoint?: { baseUrl?: string; headers?: Record<string, string> }
  }
  const baseUrl = config.endpoint?.baseUrl ?? ''
  const headers = config.endpoint?.headers ?? {}
  // Reveal the headers editor by default when the connector already has some.
  const [showHeaders, setShowHeaders] = useState(
    () => Object.keys((connector.config as typeof config)?.endpoint?.headers ?? {}).length > 0
  )

  // Merge a patch onto the endpoint, preserving sibling config keys (backfill window,
  // webhook signal). Read the latest draft config to avoid a stale closure between edits.
  const patchEndpoint = (patch: { baseUrl?: string; headers?: Record<string, string> }) => {
    const cur = getConnectorDraftState().draft.config as {
      endpoint?: Record<string, unknown>
    }
    getConnectorDraftState().setConfig({
      ...cur,
      endpoint: { ...(cur.endpoint ?? {}), ...patch },
    })
  }

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
              onChange={(e) => patchEndpoint({ baseUrl: e.target.value })}
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
              <RecordKeyValueEditor
                record={headers}
                onChange={(next) => patchEndpoint({ headers: next })}
              />
            </RequestEditorBlock>
          )}
        </div>
      </Section>
    </div>
  )
}

// ── app / template: schema-driven config form ─────────────────────────────────

function AppConfigSource({ connector }: { connector: Connector }) {
  // The connector's declared config schema, fetched from the app catalog via
  // tRPC (05c §3). Falls back to a `config._schema` blob if the catalog omits it.
  const { data } = api.dataConnector.connectorSchema.useQuery({ id: connector.id })
  const draftConfig = useConnectorDraftStore((s) => s.draft.config)
  const schema =
    (data?.configJsonSchema as Record<string, unknown> | null) ??
    (draftConfig as { _schema?: Record<string, unknown> })?._schema ??
    null
  // Per-field dynamic-select hints (tool-backed dropdowns). Keyed by config field.
  const optionHints = (data?.configOptionHints ?? null) as Record<string, ActionInputHint> | null
  const fields = useMemo(() => readFieldNodes(schema), [schema])
  const defaults = useMemo(() => seedDefaults(fields) as Record<string, unknown>, [fields])
  // Declared field values render from the draft (optimistic), defaults filling the gaps.
  const values = useMemo(
    () => ({ ...defaults, ...draftConfig }) as Record<string, unknown>,
    [defaults, draftConfig]
  )
  // Write a single field back onto the draft config (preserving sibling keys); commit
  // persists. Read the latest config to avoid a stale closure between edits.
  const setValue = (key: string, next: unknown) => {
    const cur = getConnectorDraftState().draft.config
    getConnectorDraftState().setConfig({ ...cur, [key]: next })
  }

  if (fields.length === 0) {
    return null
  }

  return (
    <div className='flex flex-col'>
      <Section
        title='Connector settings'
        icon={<Settings2 className='size-4' />}
        initialOpen
        collapsible={false}
        description='Options declared by this connector.'>
        <FieldPanel
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-70!'>
          {fields.map((entry) => {
            const hint = optionHints?.[entry.key]
            const onChange = (next: unknown) => setValue(entry.key, next)
            return hint?.kind === 'dynamic-select' ? (
              <ToolBackedSelectRow
                key={entry.key}
                connectorId={connector.id}
                entry={entry}
                hint={hint}
                value={values[entry.key]}
                onChange={onChange}
              />
            ) : (
              <ConfigFieldRow
                key={entry.key}
                entry={entry}
                value={values[entry.key]}
                onChange={onChange}
              />
            )
          })}
        </FieldPanel>
      </Section>
    </div>
  )
}

/** Map a JSON-Schema config node to the platform `FieldType` that renders it. */
function fieldTypeFor(entry: FieldEntry): FieldTypeValue {
  switch (entry.node.type) {
    case 'boolean':
      return FieldType.CHECKBOX
    case 'number':
    case 'integer':
      return FieldType.NUMBER
    default:
      return FieldType.TEXT
  }
}

/** The row-label icon's base type for a given field type. */
function baseTypeFor(fieldType: FieldTypeValue): BaseType {
  if (fieldType === FieldType.CHECKBOX) return BaseType.BOOLEAN
  if (fieldType === FieldType.NUMBER) return BaseType.NUMBER
  return BaseType.STRING
}

const ROW_TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' }

/**
 * A plain connector-config field rendered as a `FieldPanelRow` + matching
 * `FieldInputAdapter` control (mirrors `ConnectionVariableFields`). Text / number /
 * checkbox by the field's JSON-Schema type.
 */
function ConfigFieldRow({
  entry,
  value,
  onChange,
}: {
  entry: FieldEntry
  value: unknown
  onChange: (next: unknown) => void
}) {
  const fieldType = fieldTypeFor(entry)
  return (
    <FieldPanelRow
      title={entry.meta.label ?? entry.key}
      description={entry.meta.description}
      type={baseTypeFor(fieldType)}
      showIcon
      isRequired={entry.required}>
      <FieldInputAdapter
        fieldType={fieldType}
        value={value ?? (fieldType === FieldType.CHECKBOX ? false : '')}
        onChange={onChange}
        placeholder={entry.meta.placeholder}
        triggerProps={ROW_TRIGGER_PROPS}
      />
    </FieldPanelRow>
  )
}

/**
 * A config field whose options are fetched live by running an app tool through
 * the connector's own connection (e.g. a repo picker backed by `list_repos`).
 * Renders a `SINGLE_SELECT` via `FieldInputAdapter`, fed by the generic
 * `apps.resolveToolOptions` resolver (connector source).
 */
function ToolBackedSelectRow({
  connectorId,
  entry,
  hint,
  value,
  onChange,
}: {
  connectorId: string
  entry: FieldEntry
  hint: ActionInputHint
  value: unknown
  onChange: (next: unknown) => void
}) {
  // `allowCustom` turns the closed single-select into a creatable combobox: the
  // tool options become suggestions, and a typed value commits as the raw string.
  const allowCustom = hint.kind === 'dynamic-select' && hint.dynamicSelect.allowCustom === true

  // Suggestions are fetched ONCE (no per-keystroke `query`). Running the app tool
  // live on every keystroke would hammer the connection's API and flip the field
  // back into a loading/disabled state mid-type. The picker filters this list
  // client-side and, when `allowCustom`, offers to create whatever you type.
  const optionsQuery = api.apps.resolveToolOptions.useQuery(
    { source: { kind: 'connector', connectorId }, fieldKey: entry.key },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  )
  const options = (optionsQuery.data?.options ?? []).map((o) => ({
    value: o.value,
    label: o.sublabel ? `${o.label} — ${o.sublabel}` : o.label,
  }))
  const selected = typeof value === 'string' && value ? [value] : []
  // A persisted custom value won't appear in the resolved suggestions (it's a
  // repo the token can't list); surface it as its own option so the trigger
  // renders the label rather than a blank.
  if (allowCustom && selected[0] && !options.some((o) => o.value === selected[0])) {
    options.unshift({ value: selected[0], label: selected[0] })
  }
  const fieldOptions: FieldOptions = { options }

  return (
    <FieldPanelRow
      title={entry.meta.label ?? entry.key}
      description={entry.meta.description}
      type={BaseType.STRING}
      showIcon
      isRequired={entry.required}>
      <FieldInputAdapter
        fieldType={FieldType.SINGLE_SELECT}
        fieldOptions={fieldOptions}
        value={selected}
        onChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? '') : (next ?? ''))}
        placeholder={
          optionsQuery.isLoading
            ? 'Loading…'
            : (optionsQuery.data?.disabledHint ??
              entry.meta.placeholder ??
              `Select ${entry.meta.label ?? entry.key}…`)
        }
        // Only block during the one-time initial load — once suggestions resolve
        // (or fail to), the field stays typeable so a custom value still works.
        disabled={optionsQuery.isLoading}
        canAdd={allowCustom}
        useValueAsLabel={allowCustom}
        triggerProps={ROW_TRIGGER_PROPS}
      />
    </FieldPanelRow>
  )
}
