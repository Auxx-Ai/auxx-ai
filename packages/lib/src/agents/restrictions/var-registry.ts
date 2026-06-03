// packages/lib/src/agents/restrictions/var-registry.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import type { ToolContext } from '../../ai/agent-framework/tool-context'
import {
  getCachedAppByInstallationId,
  getCachedEntityDefId,
  getCachedFieldMap,
  getCachedInstalledApps,
  getCachedResourceFields,
} from '../../cache/org-cache-helpers'
import { FieldValueService } from '../../field-values/field-value-service'
import type { TypedFieldValueResult } from '../../field-values/types'
import type { RestrictionVar } from './client'

/**
 * The var-id prefix (under the `visitor` anchor) for an app-contributed
 * identity field, addressed by stable slug form:
 *   `visitor:app:<appSlug>:<appFieldKey>`  e.g. `visitor:app:shopify:customerId`
 * Distinct from the direct `visitor:<resourceFieldId>` form used by built-in /
 * non-app custom fields. See plans/chat/v6 phase-2 / phase-5.
 */
const APP_REF_PREFIX = 'app:'

/**
 * Var registry + resolver for `source: 'var'` tool restrictions.
 *
 * A **var** is a read-only value reachable from the chat invocation context:
 * an **anchor** (the verified visitor's contact, or the thread) plus a **field
 * reference** on that anchor's entity. We do not author vars — we *project*
 * them from the entity-field system (`getCachedResourceFields`), so built-in,
 * custom, and app-registered fields all become vars uniformly. See
 * plans/chat/v6 phase-2.
 *
 * Two responsibilities live here:
 *   1. {@link buildRestrictionVarRegistry} — the **picker projection** the
 *      phase-4 UI reads (one `RestrictionVar` per resolvable field).
 *   2. {@link buildResolveVar} — the per-turn **resolver** the engine hook
 *      calls. Resolution parses the var id directly and never gates on the
 *      picker list, so hidden-but-resolvable app fields (e.g. Shopify's
 *      `customerId`) still resolve. See the comment on `buildResolveVar`.
 */

/** The hardcoded identity anchors. The one platform-defined seam (see spec). */
type Anchor = 'visitor' | 'thread'

/** entityType slug each anchor resolves to (and its RecordId / ResourceFieldId prefix). */
const ANCHOR_ENTITY_TYPE: Record<Anchor, string> = {
  visitor: 'contact',
  thread: 'thread',
}

/** Picker group heading per anchor (app-owned fields get the app group instead). */
const ANCHOR_GROUP: Record<Anchor, string> = {
  visitor: 'Visitor',
  thread: 'Thread',
}

/** The `self` var for an anchor — the anchor's own record id. */
function selfVar(anchor: Anchor): RestrictionVar {
  return {
    id: `${anchor}:self`,
    anchor,
    ref: 'self',
    label: anchor === 'visitor' ? "Visitor's contact ID" : 'Thread ID',
    group: ANCHOR_GROUP[anchor],
    fieldType: 'TEXT',
  }
}

/** Options shared by the registry projection and the resolver. */
export interface VarRegistryOptions {
  /**
   * The agent's bound app accounts (`Agent.appAccounts`), keyed by app slug →
   * `{ credId }` where `credId` is the bound connection's id
   * (`WorkflowCredentials.id`). The resolver uses it to scope an app identity
   * var (`visitor:app:<slug>:<key>`) to the org's per-connection CustomField:
   * the slug picks the bound connection, then the CustomField whose
   * `connectionId === credId` (or, for installation-scoped fields, the
   * installation owned by the slug) supplies the `fieldId` to read. When the
   * app has no bound account the var resolves to null — the "connect a store"
   * deferral the phase-3 fail-closed gate surfaces.
   */
  appAccounts?: Record<string, { credId?: string } | undefined> | null
}

/**
 * Project the org's anchor entity-definition fields into the picker var list.
 *
 * For each anchor: emit the `self` var, then one var per field on the anchor's
 * entity (built-in + custom + app-registered, all enumerated from the org
 * cache).
 *
 * **App-owned fields** are addressed by the stable slug form
 * `visitor:app:<appSlug>:<appFieldKey>` (NOT the per-install resourceFieldId) so
 * the same id is portable across installs and shared by the app author's
 * `suggestedVar`, the stored restriction, and the resolver. They are surfaced
 * **even when `capabilities.hidden`** — they're identity-binding targets by
 * design (e.g. Shopify's hidden `customerId`). An app field is skipped if its
 * `appFieldKey` or its installation's slug can't be resolved (no broken id).
 *
 * **Non-app fields** keep the direct `visitor:<resourceFieldId>` form and are
 * excluded from the picker when hidden (they're not user-facing). Resolution
 * does NOT depend on this list, so a hidden-but-resolvable field still resolves
 * by id (see {@link buildResolveVar}).
 */
export async function buildRestrictionVarRegistry(
  orgId: string,
  _opts: VarRegistryOptions = {}
): Promise<RestrictionVar[]> {
  const vars: RestrictionVar[] = []

  for (const anchor of ['visitor', 'thread'] as const) {
    const entityType = ANCHOR_ENTITY_TYPE[anchor]
    const entityDefId = await getCachedEntityDefId(orgId, entityType)
    // Anchor entity def missing (e.g. org without a thread def) → still surface
    // the `self` var; just skip field enumeration.
    vars.push(selfVar(anchor))
    if (!entityDefId) continue

    const fields = await getCachedResourceFields(orgId, entityType)
    // App fields carry `appFieldKey` only on the CustomField row, not the
    // ResourceField projection — load the field map once to look it up.
    const fieldMap = await getCachedFieldMap(orgId, entityDefId)

    for (const field of fields) {
      if (field.isAppOwned) {
        // App-owned: emit the slug form. Resolve slug from the installation and
        // appFieldKey from the CustomField row; skip gracefully if either is
        // missing so we never emit a broken id.
        const appFieldKey = fieldMap.get(field.id)?.appFieldKey
        if (!appFieldKey) continue
        const installationId = field.appInstallationId
        const app = installationId
          ? await getCachedAppByInstallationId(orgId, installationId)
          : null
        if (!app) continue

        vars.push({
          id: `${anchor}:${APP_REF_PREFIX}${app.slug}:${appFieldKey}`,
          anchor,
          ref: `${APP_REF_PREFIX}${app.slug}:${appFieldKey}`,
          label: field.label,
          group: app.title || app.slug || 'App',
          fieldType: field.fieldType ?? 'TEXT',
        })
        continue
      }

      // Non-app field hidden from the picker (not user-facing).
      if (field.capabilities?.hidden === true) continue

      const resourceFieldId = field.resourceFieldId ?? toResourceFieldId(entityDefId, field.id)
      vars.push({
        id: `${anchor}:${resourceFieldId}`,
        anchor,
        ref: resourceFieldId,
        label: field.label,
        group: ANCHOR_GROUP[anchor],
        fieldType: field.fieldType ?? 'TEXT',
      })
    }
  }

  return vars
}

/**
 * Parse a var id into its anchor + field ref. Splits on the FIRST `:` only —
 * the ref may itself be a `ResourceFieldId` containing a colon.
 *
 * `visitor:self`                 → `{ anchor: 'visitor', ref: 'self' }`
 * `visitor:contact:primary_email`→ `{ anchor: 'visitor', ref: 'contact:primary_email' }`
 */
function parseVarId(varId: string): { anchor: Anchor; ref: string } | null {
  const idx = varId.indexOf(':')
  if (idx <= 0 || idx === varId.length - 1) return null
  const anchor = varId.slice(0, idx)
  if (anchor !== 'visitor' && anchor !== 'thread') return null
  return { anchor, ref: varId.slice(idx + 1) }
}

/**
 * Resolve the anchor's RecordId from the invocation context.
 * Visitor → `contact:<contactId>`; thread → `thread:<threadId>`.
 * Returns null when the anchor identity is absent (anonymous visitor, or an
 * internal turn with no `ctx.invocation`) — the phase-1 `required` check then
 * fires and refuses the call. That null *is* the identity gate.
 */
function resolveAnchorId(anchor: Anchor, ctx: ToolContext): RecordId | null {
  if (anchor === 'visitor') {
    const contactId = ctx.invocation?.contactId
    return contactId ? toRecordId('contact', contactId) : null
  }
  const threadId = ctx.invocation?.threadId
  return threadId ? toRecordId('thread', threadId) : null
}

/**
 * Extract a single scalar from a `batchGetValues` result. Takes the first
 * value, unwraps an array (multi-value field → first entry), and pulls the
 * primitive out of the `TypedFieldValue` via `extractValue`. Returns null when
 * nothing is extractable.
 */
function firstScalar(values: TypedFieldValueResult[]): unknown {
  const first = values[0]?.value
  if (first === null || first === undefined) return null
  const typed = (Array.isArray(first) ? first[0] : first) as TypedFieldValue | undefined
  if (!typed) return null
  return extractValue(typed)
}

/**
 * Parse the app-identity ref `app:<appSlug>:<appFieldKey>` (the part after the
 * `visitor` anchor). The slug and key are single segments with no `:`.
 * Returns null for any other ref shape.
 */
function parseAppRef(ref: string): { appSlug: string; appFieldKey: string } | null {
  if (!ref.startsWith(APP_REF_PREFIX)) return null
  const rest = ref.slice(APP_REF_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0 || sep === rest.length - 1) return null
  return { appSlug: rest.slice(0, sep), appFieldKey: rest.slice(sep + 1) }
}

/**
 * Resolve an app identity ref (`app:<slug>:<key>`) to the org's CustomField id.
 *
 * Lookup: among the contact entity's custom fields, pick the app-owned field
 * whose `appFieldKey` matches AND whose installation belongs to `<slug>` (guards
 * against two apps sharing the same key). Among those, prefer the row whose
 * `connectionId === connectionId` (connection-scoped — one field per connected
 * account); fall back to an installation-scoped row (null `connectionId`) when
 * no connection-scoped match exists. Returns the field's `id` (→ `fieldId`).
 */
async function resolveAppFieldId(
  orgId: string,
  entityDefId: string,
  appSlug: string,
  appFieldKey: string,
  connectionId: string
): Promise<string | null> {
  // appInstallationId → slug, so we can scope to the app that owns the key.
  const installedApps = await getCachedInstalledApps(orgId)
  const installationIdsForSlug = new Set(
    installedApps.filter((a) => a.app.slug === appSlug).map((a) => a.installationId)
  )
  if (installationIdsForSlug.size === 0) return null

  const fields = await getCachedCustomFieldsForEntity(orgId, entityDefId)
  const candidates = fields.filter(
    (f) =>
      f.appFieldKey === appFieldKey &&
      f.appInstallationId !== null &&
      installationIdsForSlug.has(f.appInstallationId)
  )
  if (candidates.length === 0) return null

  // Prefer the connection-scoped row for the bound connection; else fall back to
  // an installation-scoped row (null connectionId).
  const byConnection = candidates.find((f) => f.connectionId === connectionId)
  if (byConnection) return byConnection.id
  const installationScoped = candidates.find((f) => f.connectionId === null)
  return installationScoped?.id ?? null
}

/** Custom fields for an entity def as an array (thin wrapper over the field map). */
async function getCachedCustomFieldsForEntity(
  orgId: string,
  entityDefId: string
): Promise<CustomFieldEntity[]> {
  const map = await getCachedFieldMap(orgId, entityDefId)
  return [...map.values()]
}

/**
 * Build the per-turn `resolveVar` closure passed into
 * `buildApplyToolRestrictions`. Built once where the engine config is
 * assembled, then called per restricted arg.
 *
 * Resolution parses the var id **directly** (anchor + ref) — it does NOT look
 * the var up in the picker registry. This is load-bearing: app fields like
 * Shopify's `customerId` are `hidden: true` (excluded from the picker) yet must
 * still resolve. Gating resolution on registry membership would break them.
 *
 * App identity vars (`visitor:app:<slug>:<key>`): the slug → the agent's bound
 * connection (`appAccounts[slug].credId`) → the org's per-connection CustomField
 * → its `fieldId`, which is then read off the anchor record with the same
 * `batchGetValues` path as a direct field. No bound connection → null (the
 * "connect a store" deferral the fail-closed gate surfaces).
 */
export function buildResolveVar(
  orgId: string,
  opts: VarRegistryOptions = {}
): (varId: string, ctx: ToolContext) => Promise<unknown> {
  const appAccounts = opts.appAccounts
  return async (varId, ctx) => {
    const parsed = parseVarId(varId)
    if (!parsed) return null // unknown / garbage id → null → required check refuses

    const { anchor, ref } = parsed
    const anchorId = resolveAnchorId(anchor, ctx)
    if (!anchorId) return null // anonymous visitor / internal turn → gate fires

    // `self` → the anchor's own id (the raw contactId / threadId scalar).
    if (ref === 'self') {
      return anchor === 'visitor'
        ? (ctx.invocation?.contactId ?? null)
        : (ctx.invocation?.threadId ?? null)
    }

    // App identity var — resolve the slug-addressed app field to a fieldId,
    // then read it off the anchor record.
    const appRef = parseAppRef(ref)
    if (appRef) {
      // App identity vars are visitor-anchored (contact fields). Other anchors
      // have no app-field surface.
      if (anchor !== 'visitor') return null
      const connectionId = appAccounts?.[appRef.appSlug]?.credId
      if (!connectionId) return null // no bound store → "connect a store" deferral

      const entityDefId = await getCachedEntityDefId(ctx.organizationId, ANCHOR_ENTITY_TYPE.visitor)
      if (!entityDefId) return null
      const fieldId = await resolveAppFieldId(
        ctx.organizationId,
        entityDefId,
        appRef.appSlug,
        appRef.appFieldKey,
        connectionId
      )
      if (!fieldId) return null

      const service = new FieldValueService(ctx.organizationId, undefined, ctx.db)
      const result = await service.batchGetValues({
        recordIds: [anchorId],
        fieldReferences: [toResourceFieldId(entityDefId, fieldId)],
      })
      return firstScalar(result.values)
    }

    // Direct field on the anchor's record — reuse the existing read path.
    const service = new FieldValueService(ctx.organizationId, undefined, ctx.db)
    const result = await service.batchGetValues({
      recordIds: [anchorId],
      fieldReferences: [ref as ResourceFieldId],
    })
    return firstScalar(result.values)
  }
}
