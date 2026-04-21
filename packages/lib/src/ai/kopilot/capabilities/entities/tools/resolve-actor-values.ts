// packages/lib/src/ai/kopilot/capabilities/entities/tools/resolve-actor-values.ts

import { type ActorId, isActorId, toActorId } from '@auxx/types/actor'
import { getCachedGroups, getCachedMembers } from '../../../../../cache/org-cache-helpers'
import type { CachedGroup, OrgMemberInfo } from '../../../../../cache/org-cache-keys'
import type { ResourceField } from '../../../../../resources/registry/field-types'
import type { Resource } from '../../../../../resources/registry/types'
import { BaseType } from '../../../../../workflow-engine/core/types'

/**
 * Forgiving resolver for ACTOR field values passed in by the Kopilot LLM.
 *
 * The LLM won't always produce a perfect `user:<id>` ActorId — it echoes
 * what the user typed. This walks `values` against the resource's fields
 * and, for ACTOR fields only, normalizes:
 *   - already-valid ActorIds (`user:xyz` / `group:xyz`) against the org
 *     cache — passes through or fails
 *   - object shapes ({ actorType, id } etc.) the same way
 *   - self-reference keywords ("me", "myself", "self", "i", "@me") →
 *     caller's actorId
 *   - exact-match email → member's actorId
 *   - exact-match name → member's actorId, or ambiguous error
 *
 * Non-ACTOR fields pass through untouched. Non-writable ACTOR fields
 * (createdBy) are still resolved so the handler's capability check sees
 * a real id and returns the correct "not writable" error.
 */

const SELF_KEYWORDS = new Set(['me', 'myself', 'self', 'i', '@me'])

export interface ActorResolutionError {
  fieldId: string
  fieldLabel: string
  input: unknown
  reason: 'ambiguous' | 'not_found'
  candidates: Array<{ actorId: ActorId; label: string }>
}

export interface ResolvedActorValues {
  values: Record<string, unknown>
  errors: ActorResolutionError[]
}

interface ResolveCtx {
  organizationId: string
  userId: string
}

type ActorTarget = 'user' | 'group' | 'both'

interface MemberIndex {
  byActorId: Map<string, OrgMemberInfo>
  byEmail: Map<string, OrgMemberInfo>
  byName: Map<string, OrgMemberInfo[]>
}

interface GroupIndex {
  byActorId: Map<string, CachedGroup>
  byName: Map<string, CachedGroup[]>
}

export async function resolveActorValues(
  values: Record<string, unknown>,
  resource: Resource,
  ctx: ResolveCtx
): Promise<ResolvedActorValues> {
  const actorFields = collectActorFields(resource, values)
  if (actorFields.length === 0) {
    return { values, errors: [] }
  }

  const needsGroups = actorFields.some((f) => actorTarget(f) !== 'user')
  const [members, groups] = await Promise.all([
    getCachedMembers(ctx.organizationId),
    needsGroups ? getCachedGroups(ctx.organizationId) : Promise.resolve<CachedGroup[]>([]),
  ])

  const memberIndex = indexMembers(members)
  const groupIndex = needsGroups ? indexGroups(groups) : null

  const errors: ActorResolutionError[] = []
  const rewritten: Record<string, unknown> = { ...values }

  for (const field of actorFields) {
    const fieldKey = inputKeyForField(field, values)
    if (!fieldKey) continue

    const raw = values[fieldKey]
    const target = actorTarget(field)
    const multiple = field.options?.actor?.multiple === true

    if (multiple && Array.isArray(raw)) {
      const out: unknown[] = []
      for (const item of raw) {
        const resolved = resolveSingle(item, field, target, memberIndex, groupIndex, ctx, errors)
        if (resolved !== undefined) out.push(resolved)
      }
      rewritten[fieldKey] = out
      continue
    }

    const resolved = resolveSingle(raw, field, target, memberIndex, groupIndex, ctx, errors)
    if (resolved !== undefined) rewritten[fieldKey] = resolved
  }

  return { values: rewritten, errors }
}

/**
 * Entry point for bulk-update-entity, which passes field values as a flat
 * list of `{ fieldId, value }` pairs rather than a map.
 */
export async function resolveActorValuesFlat(
  pairs: Array<{ fieldId: string; value: unknown }>,
  resource: Resource,
  ctx: ResolveCtx
): Promise<{ pairs: Array<{ fieldId: string; value: unknown }>; errors: ActorResolutionError[] }> {
  const asMap: Record<string, unknown> = {}
  for (const pair of pairs) {
    asMap[pair.fieldId] = pair.value
  }
  const { values, errors } = await resolveActorValues(asMap, resource, ctx)
  return {
    pairs: pairs.map((p) => ({ fieldId: p.fieldId, value: values[p.fieldId] })),
    errors,
  }
}

/**
 * Build a human-readable error body for the LLM. Includes the offending
 * input, candidate actorIds with labels, and the caller's own actorId so
 * the next iteration has everything it needs to self-correct.
 */
export function formatActorResolutionError(
  errors: ActorResolutionError[],
  callerUserId: string
): string {
  const callerActorId = toActorId('user', callerUserId)
  const lines: string[] = []

  for (const err of errors) {
    const reason =
      err.reason === 'ambiguous'
        ? `Ambiguous actor "${formatInput(err.input)}" for field "${err.fieldLabel}".`
        : `Could not resolve actor "${formatInput(err.input)}" for field "${err.fieldLabel}".`
    lines.push(reason)

    if (err.candidates.length > 0) {
      const candidateList = err.candidates
        .slice(0, 10)
        .map((c) => `  - ${c.actorId} (${c.label})`)
        .join('\n')
      lines.push(`Possible matches:\n${candidateList}`)
    }
  }

  lines.push(
    `Use one of those actorIds, or call list_members with a query to search. The current user is ${callerActorId}.`
  )
  return lines.join('\n')
}

// ── Internals ──

function collectActorFields(resource: Resource, values: Record<string, unknown>): ResourceField[] {
  const valueKeys = new Set(Object.keys(values))
  return resource.fields.filter((f) => {
    if (f.type !== BaseType.ACTOR) return false
    return valueKeys.has(f.id) || valueKeys.has(f.key) || valueKeys.has(f.systemAttribute ?? '')
  })
}

function inputKeyForField(field: ResourceField, values: Record<string, unknown>): string | null {
  if (field.id in values) return field.id
  if (field.key in values) return field.key
  if (field.systemAttribute && field.systemAttribute in values) return field.systemAttribute
  return null
}

function actorTarget(field: ResourceField): ActorTarget {
  return (field.options?.actor?.target ?? 'user') as ActorTarget
}

function resolveSingle(
  raw: unknown,
  field: ResourceField,
  target: ActorTarget,
  memberIndex: MemberIndex,
  groupIndex: GroupIndex | null,
  ctx: ResolveCtx,
  errors: ActorResolutionError[]
): unknown {
  // Null / undefined: pass through (clears the field)
  if (raw === null || raw === undefined) return raw

  // Already an ActorId string
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return raw

    if (isActorId(trimmed)) {
      return validateActorId(trimmed as ActorId, field, target, memberIndex, groupIndex, errors)
    }

    // Self-reference keyword
    if (SELF_KEYWORDS.has(trimmed.toLowerCase())) {
      if (target === 'group') {
        errors.push(notFoundError(field, raw, groupCandidates(groupIndex)))
        return raw
      }
      return toActorId('user', ctx.userId)
    }

    // Email / name lookup
    return lookupByString(trimmed, field, target, memberIndex, groupIndex, raw, errors)
  }

  // Object shapes
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>

    // Pass through shaped objects — the actor converter handles them, but
    // we still want to validate the id exists and resolve a '@me' nested
    // inside.
    const nestedId = typeof obj.id === 'string' ? (obj.id as string).trim() : null
    const actorType = (obj.actorType ?? obj.type) as 'user' | 'group' | undefined

    if (nestedId && SELF_KEYWORDS.has(nestedId.toLowerCase())) {
      if (target === 'group') {
        errors.push(notFoundError(field, raw, groupCandidates(groupIndex)))
        return raw
      }
      return toActorId('user', ctx.userId)
    }

    if (typeof obj.actorId === 'string' && isActorId(obj.actorId)) {
      return validateActorId(obj.actorId as ActorId, field, target, memberIndex, groupIndex, errors)
    }

    if (nestedId && actorType) {
      const actorId = toActorId(actorType, nestedId)
      return validateActorId(actorId, field, target, memberIndex, groupIndex, errors)
    }

    // Object we don't understand — leave it for the converter to reject
    return raw
  }

  return raw
}

function validateActorId(
  actorId: ActorId,
  field: ResourceField,
  target: ActorTarget,
  memberIndex: MemberIndex,
  groupIndex: GroupIndex | null,
  errors: ActorResolutionError[]
): ActorId {
  const isUser = actorId.startsWith('user:')
  const isGroup = actorId.startsWith('group:')

  if (isUser && target === 'group') {
    errors.push(notFoundError(field, actorId, groupCandidates(groupIndex)))
    return actorId
  }
  if (isGroup && target === 'user') {
    errors.push(notFoundError(field, actorId, memberCandidates(memberIndex)))
    return actorId
  }

  if (isUser && !memberIndex.byActorId.has(actorId)) {
    errors.push(notFoundError(field, actorId, memberCandidates(memberIndex)))
    return actorId
  }
  if (isGroup && groupIndex && !groupIndex.byActorId.has(actorId)) {
    errors.push(notFoundError(field, actorId, groupCandidates(groupIndex)))
    return actorId
  }

  return actorId
}

function lookupByString(
  input: string,
  field: ResourceField,
  target: ActorTarget,
  memberIndex: MemberIndex,
  groupIndex: GroupIndex | null,
  raw: unknown,
  errors: ActorResolutionError[]
): unknown {
  const lower = input.toLowerCase()

  if (target !== 'group') {
    const byEmail = memberIndex.byEmail.get(lower)
    if (byEmail) return toActorId('user', byEmail.userId)

    const byName = memberIndex.byName.get(lower)
    if (byName && byName.length === 1) {
      return toActorId('user', byName[0].userId)
    }
    if (byName && byName.length > 1) {
      errors.push({
        fieldId: field.id,
        fieldLabel: field.label,
        input: raw,
        reason: 'ambiguous',
        candidates: byName.map((m) => ({
          actorId: toActorId('user', m.userId),
          label: memberLabel(m),
        })),
      })
      return raw
    }
  }

  if (target !== 'user' && groupIndex) {
    const byGroupName = groupIndex.byName.get(lower)
    if (byGroupName && byGroupName.length === 1) {
      return toActorId('group', byGroupName[0].id)
    }
    if (byGroupName && byGroupName.length > 1) {
      errors.push({
        fieldId: field.id,
        fieldLabel: field.label,
        input: raw,
        reason: 'ambiguous',
        candidates: byGroupName.map((g) => ({
          actorId: toActorId('group', g.id),
          label: g.displayName ?? g.id,
        })),
      })
      return raw
    }
  }

  errors.push(
    notFoundError(
      field,
      raw,
      target === 'group'
        ? groupCandidates(groupIndex)
        : target === 'user'
          ? memberCandidates(memberIndex)
          : [...memberCandidates(memberIndex), ...groupCandidates(groupIndex)]
    )
  )
  return raw
}

function notFoundError(
  field: ResourceField,
  input: unknown,
  candidates: Array<{ actorId: ActorId; label: string }>
): ActorResolutionError {
  return {
    fieldId: field.id,
    fieldLabel: field.label,
    input,
    reason: 'not_found',
    candidates,
  }
}

function memberCandidates(index: MemberIndex): Array<{ actorId: ActorId; label: string }> {
  return Array.from(index.byActorId.values())
    .slice(0, 10)
    .map((m) => ({ actorId: toActorId('user', m.userId), label: memberLabel(m) }))
}

function groupCandidates(index: GroupIndex | null): Array<{ actorId: ActorId; label: string }> {
  if (!index) return []
  return Array.from(index.byActorId.values())
    .slice(0, 10)
    .map((g) => ({ actorId: toActorId('group', g.id), label: g.displayName ?? g.id }))
}

function memberLabel(m: OrgMemberInfo): string {
  return m.user?.name ?? m.user?.email ?? m.userId
}

function indexMembers(members: OrgMemberInfo[]): MemberIndex {
  const byActorId = new Map<string, OrgMemberInfo>()
  const byEmail = new Map<string, OrgMemberInfo>()
  const byName = new Map<string, OrgMemberInfo[]>()

  for (const m of members) {
    byActorId.set(toActorId('user', m.userId), m)
    const email = m.user?.email?.toLowerCase()
    if (email) byEmail.set(email, m)
    const name = m.user?.name?.toLowerCase()
    if (name) {
      const bucket = byName.get(name) ?? []
      bucket.push(m)
      byName.set(name, bucket)
    }
  }
  return { byActorId, byEmail, byName }
}

function indexGroups(groups: CachedGroup[]): GroupIndex {
  const byActorId = new Map<string, CachedGroup>()
  const byName = new Map<string, CachedGroup[]>()

  for (const g of groups) {
    byActorId.set(toActorId('group', g.id), g)
    const name = g.displayName?.toLowerCase()
    if (name) {
      const bucket = byName.get(name) ?? []
      bucket.push(g)
      byName.set(name, bucket)
    }
  }
  return { byActorId, byName }
}

function formatInput(input: unknown): string {
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}
