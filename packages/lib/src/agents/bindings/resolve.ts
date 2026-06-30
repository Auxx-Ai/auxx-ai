// packages/lib/src/agents/bindings/resolve.ts

import { type Database, database } from '@auxx/database'
import { extractValue, type TypedFieldValue } from '@auxx/types'
import type {
  FieldPath,
  FieldReference,
  ResourceFieldId,
  VarRef,
  VarSource,
} from '@auxx/types/field'
import {
  getFieldDefinitionId,
  getFieldId,
  isFieldPath,
  parseResourceFieldId,
  toResourceFieldId,
} from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import {
  findCachedResource,
  getCachedFieldMap,
  getCachedInstalledApps,
} from '../../cache/org-cache-helpers'
import { FieldValueService } from '../../field-values/field-value-service'
import type { TypedFieldValueResult } from '../../field-values/types'

/**
 * Sentinel marking a var segment whose field id is **connection-late-bound** —
 * one `CustomField` row per connected store, the row chosen at turn time by the
 * agent's bound connection. `@app:` (not bare `app:`) so it can never collide
 * with a real entity slug. See plans/chat/v8 phase-2.
 */
const APP_SEGMENT_PREFIX = '@app:'

/**
 * The single tool-input binding resolver (plans/chat/v8 phase-2). Built per
 * tool-call from the `ToolContext` (it needs `appAccounts` / `organizationId` /
 * `db` for `@app:` segment resolution), then invoked per bound input.
 *
 * The resolver only ever reads a field **off a record drawn from the subject**.
 * The subject is built outside kopilot from verified inputs (phase-1), and the
 * spoofable `identify()` claim is in `claimed`, not an anchor — so no
 * model/visitor-supplied value can select *which* record is read. A
 * misconfiguration can pin the wrong field of the right record (a bug), never
 * another person's record (a breach).
 */
export function buildResolveVarSource(
  ctx: ToolContext
): (source: VarSource, subject: Subject) => Promise<unknown> {
  return async (source, subject) => {
    if (source.kind === 'const') return source.value
    if (source.kind === 'model') return undefined // leave to the LLM

    // 1. Turn-time app pre-pass: rewrite each `@app:<slug>:<key>` segment to a
    //    concrete ResourceFieldId via the agent's bound connection. Cache-only
    //    reads; no bound store / no provisioned field → null → input absent.
    const ref = await resolveAppSegments(source.ref, ctx)
    if (!ref) return undefined

    // 2. Anchor is derived from the ref's root entity — never stored.
    const recordId = subject.anchors[rootEntityOf(ref)]
    if (!recordId) return undefined // absent anchor → undefined → gate

    // 3. `<type>:self` → the anchor's own id (the one ref that is the record,
    //    not a field on it). Short-circuits batchGetValues.
    if (fieldPartOf(ref) === 'self') return parseRecordId(recordId).entityInstanceId

    const service = new FieldValueService(ctx.organizationId, undefined, ctx.db)
    const result = await service.batchGetValues({
      recordIds: [recordId],
      fieldReferences: [ref],
    })
    return firstScalar(result.values)
  }
}

/**
 * The single field-resolution helper that BOTH the kopilot context store
 * ({@link buildFieldSource}) and procedure refs ({@link readProcedureRef}) go
 * through, so production and the eval Simulation never diverge. Returns a
 * resolver closure built once per consumer.
 *
 * - Production: no overlay — a bare `FieldReference` resolves off
 *   `subject.anchors` via {@link buildResolveVarSource}; a missing subject (or
 *   absent anchor) gates to `undefined`, exactly as before.
 * - Simulation: `ctx.evalFieldResolver` is set, so the whole subject path is
 *   short-circuited to the overlay — which layers `startingFields` and then
 *   delegates to the subject resolver itself (see the Simulation field
 *   resolver). plans/evals/phase-1-agent-simulation.md §1.5.
 */
export function buildSubjectFieldResolver(
  ctx: ToolContext
): (ref: FieldReference) => Promise<unknown> {
  if (ctx.evalFieldResolver) {
    const overlay = ctx.evalFieldResolver
    return (ref) => overlay(ref)
  }
  const resolve = buildResolveVarSource(ctx)
  return async (ref) => {
    // No subject → no anchors to resolve against → gate by absence.
    if (!ctx.subject) return undefined
    return resolve({ kind: 'var', ref: ref as VarRef }, ctx.subject)
  }
}

/** Root entity-type slug of a var ref — the anchor key (derived, never stored). */
function rootEntityOf(ref: VarRef): string {
  return getFieldDefinitionId(isFieldPath(ref) ? ref[0] : ref)
}

/** Terminal field part of a var ref (`self`, `@app:…`, a uuid, or a system key). */
function fieldPartOf(ref: VarRef): string {
  const terminal = isFieldPath(ref) ? ref[ref.length - 1]! : ref
  return getFieldId(terminal)
}

/** Parse the `@app:<slug>:<key>` field form. Slug and key are single segments. */
function parseAppSegment(fieldPart: string): { slug: string; key: string } | null {
  if (!fieldPart.startsWith(APP_SEGMENT_PREFIX)) return null
  const rest = fieldPart.slice(APP_SEGMENT_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0 || sep === rest.length - 1) return null
  return { slug: rest.slice(0, sep), key: rest.slice(sep + 1) }
}

/**
 * Rewrite every `@app:<slug>:<key>` segment of a ref to a concrete
 * `ResourceFieldId`, resolving the connection-scoped field at turn time. Returns
 * the (possibly identical) ref, or `null` when an app segment can't resolve (no
 * bound store, no provisioned field) — the "connect a store" gate. Non-app refs
 * pass through unchanged.
 */
async function resolveAppSegments(ref: VarRef, ctx: ToolContext): Promise<VarRef | null> {
  return resolveAppSegmentsWith(ref, ctx.organizationId, (slug) => ctx.appAccounts?.[slug]?.credId)
}

/**
 * Connection-explicit core of {@link resolveAppSegments}. `credIdForSlug` returns
 * the bound connection id for an app slug — the agent reads it from
 * `ctx.appAccounts`, the quick-action picker passes the workspace connection
 * id (one app, one connection). Returns `null` when any `@app:` segment can't
 * resolve (no connection, no provisioned field).
 */
async function resolveAppSegmentsWith(
  ref: VarRef,
  orgId: string,
  credIdForSlug: (slug: string) => string | undefined
): Promise<VarRef | null> {
  const segments: ResourceFieldId[] = isFieldPath(ref) ? ref : [ref]
  const rewritten: ResourceFieldId[] = []

  for (const segment of segments) {
    const { entityDefinitionId: slug, fieldId } = parseResourceFieldId(segment)
    const app = parseAppSegment(fieldId)
    if (!app) {
      rewritten.push(segment)
      continue
    }
    const credId = credIdForSlug(app.slug)
    if (!credId) return null // no bound store → "connect a store"
    // Resolve the leading segment the way the rest of the app does — by id OR
    // entityType OR apiSlug. Connector-owned defs key by apiSlug (entityType is
    // null); agent bindings key by entityType. Both live in the `resources` cache.
    const resource = await findCachedResource(orgId, slug)
    if (!resource) return null
    const entityDefId = resource.entityDefinitionId
    const cfId = await resolveAppFieldId(orgId, entityDefId, app.slug, app.key, credId)
    if (!cfId) return null
    rewritten.push(toResourceFieldId(entityDefId, cfId))
  }

  return isFieldPath(ref) ? (rewritten as FieldPath) : rewritten[0]!
}

/**
 * Read a single field value off a known record, resolving `@app:<slug>:<key>`
 * segments against an explicit connection. The decoupled core shared by the
 * agent binding resolver and the quick-action `resolveOptions` endpoint — it
 * needs only `(orgId, recordId, connectionId)`, never a `ToolContext`/`Subject`.
 *
 * Returns `undefined` when the ref can't resolve (no provisioned field, empty
 * value) — the caller treats that as the disabled/empty state. See
 * plans/actions/09-dynamic-action-inputs.md.
 */
export async function resolveAppFieldValue(params: {
  orgId: string
  recordId: RecordId
  ref: string
  connectionId: string
  db?: Database
}): Promise<unknown> {
  const { orgId, recordId, ref, connectionId, db = database } = params
  const resolved = await resolveAppSegmentsWith(ref as VarRef, orgId, () => connectionId)
  if (!resolved) return undefined
  if (fieldPartOf(resolved) === 'self') return parseRecordId(recordId).entityInstanceId

  const service = new FieldValueService(orgId, undefined, db)
  const result = await service.batchGetValues({
    recordIds: [recordId],
    fieldReferences: [resolved],
  })
  return firstScalar(result.values)
}

/**
 * Resolve a Data Connector's stored `targetFieldRef` to a concrete
 * `ResourceFieldId`. A plain `${defId}:${fieldId}` passes through unchanged; the
 * late-bound `@app:<slug>:<key>` form is resolved against the connector's bound
 * connection (its `credentialId`). Returns `null` when an `@app:` segment can't
 * resolve (no bound connection / no provisioned field) — the caller skips that
 * field/candidate and records a run error. The connection-explicit twin of
 * {@link resolveAppFieldValue}, decoupled from `ToolContext`/`Subject`.
 */
export async function resolveConnectorFieldRef(
  ref: ResourceFieldId,
  orgId: string,
  connectionId: string | undefined
): Promise<ResourceFieldId | null> {
  const resolved = await resolveAppSegmentsWith(ref as VarRef, orgId, () => connectionId)
  return (resolved as ResourceFieldId | null) ?? null
}

/**
 * Resolve an app field (`@app:<slug>:<key>`) to the org's `CustomField` id.
 *
 * Among the entity's custom fields, pick the app-owned field whose `appFieldKey`
 * matches AND whose installation belongs to `<slug>` (guards against two apps
 * sharing a key). Prefer the row whose `connectionId === credId`
 * (connection-scoped — one field per connected account); fall back to an
 * installation-scoped row (null `connectionId`). Already entity-agnostic, so app
 * fields can live on contact, company (via traversal), or any anchor. Lifted
 * verbatim from v6 `var-registry.ts:241`.
 */
async function resolveAppFieldId(
  orgId: string,
  entityDefId: string,
  appSlug: string,
  appFieldKey: string,
  connectionId: string
): Promise<string | null> {
  const installedApps = await getCachedInstalledApps(orgId)
  const installationIdsForSlug = new Set(
    installedApps.filter((a) => a.app.slug === appSlug).map((a) => a.installationId)
  )
  if (installationIdsForSlug.size === 0) return null

  const fieldMap = await getCachedFieldMap(orgId, entityDefId)
  const candidates = [...fieldMap.values()].filter(
    (f) =>
      f.appFieldKey === appFieldKey &&
      f.appInstallationId !== null &&
      installationIdsForSlug.has(f.appInstallationId)
  )
  if (candidates.length === 0) return null

  const byConnection = candidates.find((f) => f.connectionId === connectionId)
  if (byConnection) return byConnection.id
  const installationScoped = candidates.find((f) => f.connectionId === null)
  return installationScoped?.id ?? null
}

/**
 * Extract a single scalar from a `batchGetValues` result — takes the first
 * value, unwraps a multi-value array, and pulls the primitive via
 * `extractValue`. Returns `undefined` when nothing is extractable. Lifted from
 * v6 `var-registry.ts:210`.
 */
function firstScalar(values: TypedFieldValueResult[]): unknown {
  const first = values[0]?.value
  if (first === null || first === undefined) return undefined
  const typed = (Array.isArray(first) ? first[0] : first) as TypedFieldValue | undefined
  if (!typed) return undefined
  return extractValue(typed)
}
