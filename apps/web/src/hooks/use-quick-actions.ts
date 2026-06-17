// apps/web/src/hooks/use-quick-actions.ts

'use client'

import { useMemo } from 'react'
import type { SerializedQuickAction } from '~/lib/workflow/workflow-block-loader'
import {
  type AppInstallation,
  useExtensionsContext,
} from '~/providers/extensions/extensions-context'

/**
 * Hook to load available quick actions from installed apps.
 *
 * Reads directly from the deployment catalog's `actions` projection (exposed
 * via `useExtensionsContext` → `apps.listInstalled` → cached envelope). No
 * iframe boot — the picker renders synchronously from the trpc cache.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §10.2.
 */
export function useQuickActions(_threadId?: string, _ticketId?: string) {
  const { appInstallations, isLoading } = useExtensionsContext()

  const actions = useMemo<SerializedQuickAction[]>(
    () => appInstallations.flatMap(installationToActions),
    [appInstallations]
  )

  return { actions, isLoading }
}

function installationToActions(installation: AppInstallation): SerializedQuickAction[] {
  const actions = installation.actions ?? []
  if (actions.length === 0) return []

  return actions.map((action) => ({
    id: action.toolId,
    label: action.label,
    description: action.description,
    icon: action.iconKey ?? undefined,
    color: action.color,
    // The catalog ships tool inputs as a JSON Schema; the quick-action form
    // reads the SDK field-descriptor map. Bridge here (see comment on the fn).
    inputs: jsonSchemaToActionFields(action.inputsJsonSchema),
    outputs: {},
    defaults: {},
    appId: installation.app.id,
    installationId: installation.installationId,
  }))
}

/**
 * Convert a tool's input JSON Schema — `zodToProviderToolSchema` output, shaped
 * `{ type: 'object', properties: {…}, required: [...] }` — into the flat
 * field-descriptor map the quick-action form renders
 * (`{ fieldKey: { type, label, options, … } }`, keyed by field name).
 *
 * Tool inputs ship as JSON Schema since the catalog refactor; the form predates
 * it and was built against the old iframe SDK descriptor shape, so this bridges
 * the two. Lossy by design: JSON Schema carries no `currency`-type or label
 * metadata, so currency inputs fall back to plain number fields and labels are
 * derived from the field key.
 */
export function jsonSchemaToActionFields(
  schema: Record<string, any> | undefined
): Record<string, any> {
  const properties = schema?.properties as Record<string, any> | undefined
  if (!properties) return {}
  const required: string[] = Array.isArray(schema?.required) ? schema.required : []

  const fields: Record<string, any> = {}
  for (const [key, prop] of Object.entries(properties)) {
    fields[key] = jsonSchemaPropToField(key, prop, required.includes(key))
  }
  return fields
}

function jsonSchemaPropToField(key: string, prop: any, required: boolean): Record<string, any> {
  const base = { label: titleCaseKey(key), required, description: prop?.description }

  // A fixed value set → single-select, regardless of the underlying scalar type.
  if (Array.isArray(prop?.enum)) {
    return {
      ...base,
      type: 'select',
      options: prop.enum.map((value: unknown) => ({ value, label: String(value) })),
    }
  }

  switch (prop?.type) {
    case 'integer':
    case 'number':
      return {
        ...base,
        type: 'number',
        integer: prop.type === 'integer',
        // JSON Schema's exclusiveMinimum (e.g. `> 0`) maps to the input's
        // inclusive `min` — close enough for the UI; the server re-validates.
        min:
          prop.minimum ??
          (typeof prop.exclusiveMinimum === 'number' ? prop.exclusiveMinimum : undefined),
        max: prop.maximum,
      }
    case 'boolean':
      return { ...base, type: 'boolean' }
    default:
      return { ...base, type: 'string' }
  }
}

/** `maxRedemptions` / `duration_in_months` → `Max Redemptions` / `Duration In Months`. */
function titleCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase())
}
