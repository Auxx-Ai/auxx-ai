// packages/lib/src/ai/agent-framework/tool-inputs.ts

import { type ActorId, type ActorIdType, isActorId, toActorId } from '@auxx/types/actor'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import type { AbsoluteDate, RelativeDate } from '@auxx/types/task'
import { getCachedResources } from '../../cache/org-cache-helpers'
import { DateLanguageModule } from '../../tasks/date-language-module'
import { TextDateParser } from '../../tasks/text-date-parser'

/**
 * Generic input-validation helpers used by `AgentToolDefinition.validateInputs`.
 *
 * Each helper returns a `ParseResult<T>` instead of throwing — `ok: false`
 * carries an LLM-actionable error message; `ok: true` may also carry
 * `warnings` (informational, surfaced to the engine log only).
 *
 * No DB reads. The only async helper is `getKnownDefIds`, which goes through
 * the existing cached-resources lookup (sub-ms hit).
 */

export type ParseResult<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { ok: false; error: string }

/** Lookup tables for resolving an entity-definition reference from any of its
 *  three identifier forms: canonical id, apiSlug, or entityType. */
export interface KnownDefIds {
  /** Set of canonical entity-definition ids (`<defId>`). */
  byId: Set<string>
  /** apiSlug → canonical defId (e.g. `'contacts'` → `'k6f...'`). */
  byApiSlug: Map<string, string>
  /** entityType → canonical defId (e.g. `'contact'` → `'k6f...'`). */
  byEntityType: Map<string, string>
}

/**
 * Build a `KnownDefIds` lookup for an organization. Reads from the existing
 * org `resources` cache — sub-ms for warm caches, single batched query for
 * cold ones. Safe to call from `validateInputs`.
 */
export async function getKnownDefIds(orgId: string): Promise<KnownDefIds> {
  const resources = await getCachedResources(orgId)
  const byId = new Set<string>()
  const byApiSlug = new Map<string, string>()
  const byEntityType = new Map<string, string>()
  for (const r of resources) {
    byId.add(r.id)
    const apiSlug = (r as { apiSlug?: string }).apiSlug
    if (apiSlug) byApiSlug.set(apiSlug, r.id)
    if (r.entityType) byEntityType.set(r.entityType, r.id)
  }
  return { byId, byApiSlug, byEntityType }
}

/**
 * Trim + length-bound a string-typed argument. `name` is included in error
 * messages so the LLM knows which arg to fix. `required: false` (default)
 * means an undefined / empty input returns `ok: true, value: undefined`.
 */
export function parseStringArg(
  input: unknown,
  opts: { name: string; max?: number; required?: boolean; min?: number }
): ParseResult<string | undefined> {
  if (input === undefined || input === null || input === '') {
    if (opts.required) {
      return { ok: false, error: `${opts.name} is required.` }
    }
    return { ok: true, value: undefined }
  }
  if (typeof input !== 'string') {
    return {
      ok: false,
      error: `${opts.name} must be a string; got ${typeof input}.`,
    }
  }
  const trimmed = input.trim()
  if (opts.required && trimmed.length === 0) {
    return { ok: false, error: `${opts.name} is required.` }
  }
  if (opts.min !== undefined && trimmed.length < opts.min) {
    return {
      ok: false,
      error: `${opts.name} must be at least ${opts.min} characters; got ${trimmed.length}.`,
    }
  }
  if (opts.max !== undefined && trimmed.length > opts.max) {
    return {
      ok: false,
      error: `${opts.name} must be at most ${opts.max} characters; got ${trimmed.length}. Shorten it.`,
    }
  }
  return { ok: true, value: trimmed }
}

/**
 * Normalize a single recordId argument.
 *
 * Accepts:
 * - Canonical `<defId>:<instId>` — pass-through.
 * - 3-part `<slug>:<defId>:<instId>` — auto-strips the slug prefix when
 *   `slug` resolves to `defId` via `knownDefIds.byApiSlug` /
 *   `byEntityType`. Otherwise rejects with guidance.
 * - Bare `<instId>` — only when `defaultEntityDefinitionId` is provided
 *   (which means the caller knows the entity in context, e.g. when a tool
 *   was invoked while looking at a single record). Returns canonicalized
 *   form with a warning.
 *
 * Rejects everything else with an LLM-actionable error.
 */
export function normalizeRecordIdArg(
  input: unknown,
  ctx: { knownDefIds?: KnownDefIds; defaultEntityDefinitionId?: string; argName?: string } = {}
): ParseResult<RecordId> {
  const argName = ctx.argName ?? 'recordId'
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, error: `${argName} must be a non-empty string.` }
  }
  const parts = input.split(':')

  if (parts.length === 2) {
    const [defId, instId] = parts
    if (!defId || !instId) {
      return {
        ok: false,
        error: `${argName} '${input}' is malformed. Expected '<entityDefinitionId>:<entityInstanceId>'.`,
      }
    }
    if (ctx.knownDefIds && !ctx.knownDefIds.byId.has(defId)) {
      // Maybe the LLM passed apiSlug:instId instead of defId:instId.
      const resolved =
        ctx.knownDefIds.byApiSlug.get(defId) ?? ctx.knownDefIds.byEntityType.get(defId)
      if (resolved) {
        return {
          ok: true,
          value: toRecordId(resolved, instId),
          warnings: [
            `${argName}: substituted entityDefinitionId '${resolved}' for slug/entityType '${defId}'.`,
          ],
        }
      }
      return {
        ok: false,
        error: `${argName} '${input}' references unknown entityDefinitionId '${defId}'. Use the id from list_entities or search_entities, not the slug.`,
      }
    }
    return { ok: true, value: input as RecordId }
  }

  if (parts.length === 3) {
    const [maybeSlug, defId, instId] = parts
    if (!maybeSlug || !defId || !instId) {
      return {
        ok: false,
        error: `${argName} '${input}' is malformed. Expected '<entityDefinitionId>:<entityInstanceId>'.`,
      }
    }
    if (ctx.knownDefIds) {
      const resolved =
        ctx.knownDefIds.byApiSlug.get(maybeSlug) ?? ctx.knownDefIds.byEntityType.get(maybeSlug)
      if (resolved && resolved === defId) {
        return {
          ok: true,
          value: toRecordId(defId, instId),
          warnings: [`${argName}: dropped redundant '${maybeSlug}:' prefix.`],
        }
      }
    }
    return {
      ok: false,
      error: `${argName} '${input}' has 3 colon-separated parts. Expected '<entityDefinitionId>:<entityInstanceId>' (2 parts). Drop the leading prefix.`,
    }
  }

  if (parts.length === 1) {
    if (ctx.defaultEntityDefinitionId) {
      return {
        ok: true,
        value: toRecordId(ctx.defaultEntityDefinitionId, input),
        warnings: [
          `${argName}: bare instance id; assumed entityDefinitionId '${ctx.defaultEntityDefinitionId}'.`,
        ],
      }
    }
    return {
      ok: false,
      error: `${argName} '${input}' is missing the entityDefinitionId prefix. Expected '<entityDefinitionId>:<entityInstanceId>'.`,
    }
  }

  return {
    ok: false,
    error: `${argName} '${input}' has ${parts.length} colon-separated parts; expected 2.`,
  }
}

/**
 * Normalize an array of recordIds. Per-item validation; the first invalid
 * item short-circuits with a precise error. Warnings from successful items
 * are aggregated.
 */
export function normalizeRecordIdArrayArg(
  input: unknown,
  ctx: { knownDefIds?: KnownDefIds; defaultEntityDefinitionId?: string; argName?: string } = {}
): ParseResult<RecordId[]> {
  const argName = ctx.argName ?? 'recordIds'
  if (input === undefined || input === null) {
    return { ok: true, value: [] }
  }
  if (!Array.isArray(input)) {
    return { ok: false, error: `${argName} must be an array; got ${typeof input}.` }
  }
  const value: RecordId[] = []
  const warnings: string[] = []
  for (let i = 0; i < input.length; i++) {
    const r = normalizeRecordIdArg(input[i], { ...ctx, argName: `${argName}[${i}]` })
    if (!r.ok) return r
    value.push(r.value)
    if (r.warnings) warnings.push(...r.warnings)
  }
  return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value }
}

/**
 * Normalize a single ActorId argument.
 *
 * Accepts:
 * - Canonical `user:<id>` / `group:<id>` — pass-through.
 * - Bare `<id>` — only when `defaultKind` is provided (typical for
 *   tools where the slot is unambiguously a user, e.g. `assigneeIds`).
 *   Returns canonicalized form with a warning.
 *
 * Rejects 3+ part shapes and unknown kind prefixes.
 */
export function normalizeActorIdArg(
  input: unknown,
  ctx: { defaultKind?: ActorIdType; argName?: string } = {}
): ParseResult<ActorId> {
  const argName = ctx.argName ?? 'actorId'
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, error: `${argName} must be a non-empty string.` }
  }
  if (isActorId(input)) {
    return { ok: true, value: input }
  }
  const parts = input.split(':')
  if (parts.length === 1) {
    if (ctx.defaultKind) {
      return {
        ok: true,
        value: toActorId(ctx.defaultKind, input),
        warnings: [`${argName}: bare id; assumed kind '${ctx.defaultKind}'.`],
      }
    }
    return {
      ok: false,
      error: `${argName} '${input}' is missing the kind prefix. Expected 'user:<id>' or 'group:<id>'.`,
    }
  }
  if (parts.length === 2) {
    return {
      ok: false,
      error: `${argName} '${input}' has an unknown kind prefix. Expected 'user:<id>' or 'group:<id>'.`,
    }
  }
  return {
    ok: false,
    error: `${argName} '${input}' has ${parts.length} colon-separated parts; expected 'user:<id>' or 'group:<id>'.`,
  }
}

/**
 * Parse a free-text deadline (e.g. "next Friday", "in 3 days", "end of month")
 * into the canonical `AbsoluteDate | RelativeDate` shape used by the task service.
 *
 * Undefined / null / empty input returns `ok: true, value: undefined` (deadline
 * is optional). On parse failure, returns guidance with example phrasings the
 * LLM can retry with.
 */
export function parseDeadlineArg(
  input: unknown,
  ctx: { argName?: string } = {}
): ParseResult<AbsoluteDate | RelativeDate | undefined> {
  const argName = ctx.argName ?? 'deadline'
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: undefined }
  }
  if (typeof input !== 'string') {
    return { ok: false, error: `${argName} must be a string; got ${typeof input}.` }
  }
  const parser = new TextDateParser()
  const result = parser.parse(input)
  if (!result.found || !result.duration) {
    return {
      ok: false,
      error: `${argName} '${input}' could not be parsed. Try a phrasing like "next Friday", "in 3 days", "tomorrow", or "end of month".`,
    }
  }
  if (typeof result.duration === 'string') {
    const dateModule = new DateLanguageModule()
    const resolved = dateModule.calculateTargetDate(result.duration)
    return { ok: true, value: { type: 'static', value: resolved } satisfies AbsoluteDate }
  }
  return { ok: true, value: result.duration satisfies RelativeDate }
}

/**
 * Normalize an array of ActorIds. Per-item validation; the first invalid
 * item short-circuits.
 */
export function normalizeActorIdArrayArg(
  input: unknown,
  ctx: { defaultKind?: ActorIdType; argName?: string } = {}
): ParseResult<ActorId[]> {
  const argName = ctx.argName ?? 'actorIds'
  if (input === undefined || input === null) {
    return { ok: true, value: [] }
  }
  if (!Array.isArray(input)) {
    return { ok: false, error: `${argName} must be an array; got ${typeof input}.` }
  }
  const value: ActorId[] = []
  const warnings: string[] = []
  for (let i = 0; i < input.length; i++) {
    const r = normalizeActorIdArg(input[i], { ...ctx, argName: `${argName}[${i}]` })
    if (!r.ok) return r
    value.push(r.value)
    if (r.warnings) warnings.push(...r.warnings)
  }
  return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value }
}
