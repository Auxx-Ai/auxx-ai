// packages/lib/src/quick-actions/action-catalog.ts

/**
 * Pure, client-safe action-catalog builder — the actions analog of
 * `buildCatalogTreeFromInstallations` (`@auxx/lib/agents/client`). Walks the
 * installed-app catalog's `actions` projection and produces both a flat list and
 * an app-grouped view, with the app icon resolved once so every render site
 * (quick-action picker, the `@` menu, the chip) groups by app and shows the icon
 * without re-deriving it. Imports nothing server-only.
 */

/** Where an action is offered. Mirrors `CatalogAction.surface`. */
export type ActionSurface = 'ticket-header' | 'email-editor'

/**
 * Structural subtype of the installed-app shape this builder reads — defined
 * here (not imported from the cache types) so the builder stays client-safe and
 * dependency-light. The full `AppInstallation` / `CachedInstalledApp` is
 * assignment-compatible by structural typing.
 */
export interface ActionCatalogInstallationLike {
  installationId: string
  app: {
    id: string
    title: string
    avatarUrl: string | null
  }
  actions?: ReadonlyArray<{
    toolId: string
    label: string
    description?: string
    iconKey: string | null
    color?: string
    surface: ActionSurface
    requiresConfirmation?: boolean
    confirmationMessage?: string
    inputHints?: Record<string, any> | null
    inputsJsonSchema?: Record<string, unknown>
  }>
}

/**
 * One action, flattened with its display metadata resolved. A superset of
 * `SerializedQuickAction` (so `toDraftActionPayload` and the existing picker
 * consumers keep working) plus the app-grouping fields.
 */
export interface ActionCatalogEntry {
  /** Tool id — the chip / select id consumers key on (`SerializedQuickAction.id`). */
  id: string
  /** Same value as `id`; named for clarity when both are in scope. */
  toolId: string
  label: string
  description?: string
  /** Raw per-action icon key from the catalog (may be undefined). */
  icon?: string
  /**
   * Resolved icon for display: the action's own `iconKey`, falling back to the
   * app avatar, then a `zap` lucide default. Render with `<AppIcon>` — the value
   * may be a URL (app avatar) or a lucide id.
   */
  iconId: string
  color?: string
  surface: ActionSurface
  requiresConfirmation?: boolean
  confirmationMessage?: string
  inputHints?: Record<string, any> | null
  /** Field-descriptor map the quick-action form renders (bridged from JSON Schema). */
  inputs: Record<string, any>
  /** Always empty — actions carry no output schema in the catalog projection. */
  outputs: Record<string, any>
  /** Always empty today; present for `SerializedQuickAction` shape parity. */
  defaults: Record<string, unknown>
  appId: string
  installationId: string
  /** Owning app's title — the group heading. */
  appTitle: string
  /** Owning app's resolved icon (`avatarUrl ?? 'package'`) — the group icon. */
  appIconId: string
}

/** Actions of one app, grouped for headed rendering. */
export interface ActionCatalogAppGroup {
  app: {
    id: string
    title: string
    /** Resolved app icon (`avatarUrl ?? 'package'`). Render with `<AppIcon>`. */
    iconId: string
    /** Apps carry no color today; reserved for `<AppIcon color>`. */
    color: string | null
  }
  actions: ActionCatalogEntry[]
}

export interface BuildActionCatalogOptions {
  /** Clamp to actions offered on this surface. Absent ⇒ every surface. */
  surface?: ActionSurface
}

export interface ActionCatalog {
  /** Flat list across all apps, sorted by app title then action label. */
  actions: ActionCatalogEntry[]
  /** Same actions grouped by app, apps sorted by title. */
  groups: ActionCatalogAppGroup[]
}

/** Lucide fallback when an app has no avatar. Matches the tool catalog's app-node fallback. */
const APP_ICON_FALLBACK = 'package'
/** Lucide fallback for an action with no own icon and no app avatar. */
const ACTION_ICON_FALLBACK = 'zap'

/**
 * Build the action catalog from installed apps. Pure — safe to call inside a
 * `useMemo`. The synthetic built-in `auxx` row (prepended by
 * `installedAppsProvider`) flows through like any other app.
 */
export function buildActionCatalog(
  installations: ReadonlyArray<ActionCatalogInstallationLike>,
  options: BuildActionCatalogOptions = {}
): ActionCatalog {
  const { surface } = options
  const groups: ActionCatalogAppGroup[] = []

  for (const inst of installations) {
    const raw = inst.actions ?? []
    const scoped = surface ? raw.filter((a) => a.surface === surface) : raw
    if (scoped.length === 0) continue

    const appIconId = inst.app.avatarUrl ?? APP_ICON_FALLBACK
    const actions: ActionCatalogEntry[] = scoped.map((action) => ({
      id: action.toolId,
      toolId: action.toolId,
      label: action.label,
      description: action.description,
      icon: action.iconKey ?? undefined,
      iconId: action.iconKey ?? inst.app.avatarUrl ?? ACTION_ICON_FALLBACK,
      color: action.color,
      surface: action.surface,
      requiresConfirmation: action.requiresConfirmation,
      confirmationMessage: action.confirmationMessage,
      inputHints: action.inputHints,
      inputs: jsonSchemaToActionFields(action.inputsJsonSchema, action.inputHints),
      outputs: {},
      defaults: {},
      appId: inst.app.id,
      installationId: inst.installationId,
      appTitle: inst.app.title,
      appIconId,
    }))
    actions.sort((a, b) => a.label.localeCompare(b.label))

    groups.push({
      app: { id: inst.app.id, title: inst.app.title, iconId: appIconId, color: null },
      actions,
    })
  }

  groups.sort((a, b) => a.app.title.localeCompare(b.app.title))
  const actions = groups.flatMap((g) => g.actions)
  return { actions, groups }
}

// ===== JSON Schema → quick-action field bridge =====
//
// Tool inputs ship as JSON Schema (`zodToProviderToolSchema` output); the
// quick-action form predates that and reads a flat field-descriptor map. These
// helpers bridge the two. Moved here from the web `useQuickActions` hook so the
// builder is the single source of the projection. Lossy by design: JSON Schema
// carries no currency-type or label metadata, so currency inputs fall back to
// plain number fields and labels derive from the field key.

/**
 * Convert a tool's input JSON Schema — shaped
 * `{ type: 'object', properties: {…}, required: [...] }` — into the flat
 * field-descriptor map (`{ fieldKey: { type, label, options, … } }`).
 * `inputHints` layers dynamic-select pickers over named inputs.
 */
export function jsonSchemaToActionFields(
  schema: Record<string, any> | undefined,
  inputHints?: Record<string, any> | null
): Record<string, any> {
  const properties = schema?.properties as Record<string, any> | undefined
  if (!properties) return {}
  const required: string[] = Array.isArray(schema?.required) ? schema.required : []

  const fields: Record<string, any> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const base = jsonSchemaPropToField(key, prop, required.includes(key))
    // A dynamic-select hint wins over the JSON-Schema-derived type: the field
    // renders a live, contact-scoped picker instead of a text/number input.
    const hint = inputHints?.[key]
    if (hint?.kind === 'dynamic-select') {
      fields[key] = { ...base, type: 'dynamic-select', dynamicSelect: hint.dynamicSelect }
    } else {
      fields[key] = base
    }
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
