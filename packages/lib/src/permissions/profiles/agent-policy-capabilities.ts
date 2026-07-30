// packages/lib/src/permissions/profiles/agent-policy-capabilities.ts

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import type { ResourcePermission, Rung } from '@auxx/database/enums'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from '../capabilities/capability-view'
import { PERMISSION_RANK } from '../capabilities/compose-user-capabilities'
import { NON_RECORD_DEF_SLUGS } from '../capabilities/entity-access'
import type { InstanceAccessKey } from '../capabilities/instance-access'
import {
  type Area,
  buildAreaLevels,
  expandLevelsToKeys,
  type Level,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
} from '../capabilities/registry'
import { permissionToRung, satisfiesRung } from '../capabilities/rung'
import { ENTITY_WRITE_KEYS } from '../capabilities/seat-policy'
import {
  permissionToAreaLevel,
  policyAreaLevel,
  policyDefinitionLevel,
  policyResourceLevel,
} from './agent-policy'

/**
 * Resolves any RecordId-def form (a system slug, an `apiSlug`, or an
 * `EntityDefinition` CUID) to the entity **`apiSlug`** — the keyspace
 * `PublishedAgentPermissionPolicy.definitions` is written in.
 *
 * apiSlugs rather than CUIDs are deliberate (plan 19 §3 "Slug lifecycle"): a
 * published default then applies to definitions created later, and an override
 * survives archive/restore. Built once per run from already-cached data, so every
 * lookup is an in-memory Map hit — NEVER a query.
 */
export type DefIdToApiSlug = (entityDefId: string) => string

/**
 * The subset of a cached `Resource` the policy resolvers need. Structurally
 * satisfied by both `SystemResource` and `CustomResource`.
 */
export interface PolicyResourceRef {
  id: string
  apiSlug: string
  entityDefinitionId: string
  entityType?: string
}

/**
 * Build the in-memory RecordId-def → `apiSlug` resolver from the cached
 * `resources` array — every accepted def form (resource id, apiSlug, definition
 * CUID, entity slug) maps to the ONE key the policy is written in. Unknown keys
 * pass through unchanged, so an unrecognized def resolves through the policy's
 * `default` rather than throwing.
 */
export function buildDefIdToApiSlug(resources: readonly PolicyResourceRef[]): DefIdToApiSlug {
  const byKey = new Map<string, string>()
  for (const resource of resources) {
    const apiSlug = resource.apiSlug
    byKey.set(resource.id, apiSlug)
    byKey.set(resource.apiSlug, apiSlug)
    byKey.set(resource.entityDefinitionId, apiSlug)
    if (resource.entityType) byKey.set(resource.entityType, apiSlug)
  }
  return (entityDefId) => byKey.get(entityDefId) ?? entityDefId
}

/**
 * Build the in-memory RecordId-def → entity-SLUG resolver (the keyspace of
 * {@link ENTITY_WRITE_KEYS} and {@link NON_RECORD_DEF_SLUGS}). Mirrors the
 * resolver `getCapabilities` builds for the human `CapabilitySet`, so an agent and
 * a human classify the same def identically.
 */
export function buildDefIdToEntitySlug(resources: readonly PolicyResourceRef[]): DefIdToApiSlug {
  const byKey = new Map<string, string>()
  for (const resource of resources) {
    const slug = resource.entityType ?? resource.apiSlug
    byKey.set(resource.id, slug)
    byKey.set(resource.apiSlug, slug)
    byKey.set(resource.entityDefinitionId, slug)
    if (resource.entityType) byKey.set(resource.entityType, slug)
  }
  return (entityDefId) => byKey.get(entityDefId) ?? entityDefId
}

/**
 * A {@link CapabilityView} backed by an immutable
 * {@link PublishedAgentPermissionPolicy} — the runtime face of plan 19 §2.3.
 *
 * This replaces the shipped `composeAgentLevels` SET branch entirely. An agent's
 * authority no longer comes from `PermissionGrant`/`ResourceAccess` rows composed
 * against a synthetic member; it comes from the version snapshot, and only from
 * there. Three consequences are the point of the design:
 *
 * - **`none` is load-bearing.** The additive human reducers skip `'none'`
 *   (`compose-user-capabilities.ts` — a grantee-level `none` grants nobody), so an
 *   agent policy could never express "remove Deals" through them. Here `'none'`
 *   is just the bottom rung and denies outright.
 * - **Nothing can widen it.** Because this is an ordinary `CapabilityView`,
 *   run-as and invoker intersection go through `MinCapabilitySet`, whose every
 *   gate is `a && b`. An OWNER run-as therefore *cannot* lift an agent published
 *   as `None` — run-as is delegation, never replacement (§0.15).
 * - **The synthetic `OrganizationMember` is not a second authority.** It carries
 *   membership/role/seat only (§0.16); no grant row on it is consulted here.
 *
 * Zero I/O — every member is an in-memory Map/Set lookup, like `CapabilitySet`.
 */
export class AgentPolicyCapabilities implements CapabilityView {
  private readonly keys: ReadonlySet<PermissionKey>

  /**
   * @param policy         The version's resolved, already author-clamped snapshot.
   * @param defIdToApiSlug RecordId-def → entity `apiSlug` resolver (zero I/O).
   * @param defIdToSlug    RecordId-def → entity slug resolver, for mail-infra
   *                       detection and the {@link ENTITY_WRITE_KEYS} lookup.
   *                       Defaults to identity.
   */
  constructor(
    private readonly policy: PublishedAgentPermissionPolicy,
    private readonly defIdToApiSlug: DefIdToApiSlug = (id) => id,
    private readonly defIdToSlug: DefIdToApiSlug = (id) => id
  ) {
    // Materialize the area rungs into the flat key set every `can()` gate reads,
    // so an agent and a human answer capability questions through one mechanism.
    this.keys = new Set(
      expandLevelsToKeys(
        buildAreaLevels((area) => permissionToAreaLevel(policyAreaLevel(policy, area)))
      )
    )
  }

  /** The snapshot this view enforces — exposed for run-log/audit surfaces. */
  get publishedPolicy(): PublishedAgentPermissionPolicy {
    return this.policy
  }

  can(key: PermissionKey): boolean {
    return this.keys.has(key)
  }

  has(key: PermissionKey): boolean {
    return this.keys.has(key)
  }

  assert(key: PermissionKey): void {
    if (this.keys.has(key)) return
    const label = PERMISSION_REGISTRY_MAP.get(key)?.label ?? key
    throw new ForbiddenError(`This agent doesn't have permission to ${label}.`)
  }

  /** Read straight off the policy — exact, not recovered from the key set. */
  areaLevel(area: Area): Level {
    return permissionToAreaLevel(policyAreaLevel(this.policy, area))
  }

  canWriteEntity(entityDefId: string): boolean {
    return this.keys.has(this.writeKeyFor(entityDefId))
  }

  assertWriteEntity(entityDefId: string): void {
    this.assert(this.writeKeyFor(entityDefId))
  }

  /**
   * The exact published rung for a definition. Mail/messaging-infrastructure defs
   * are NOT in this keyspace — see {@link isMailInfraDef}.
   */
  private definitionLevel(entityDefId: string): ResourcePermission {
    return policyDefinitionLevel(this.policy, this.defIdToApiSlug(entityDefId))
  }

  canEditEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) return this.canWriteEntity(entityDefId)
    return PERMISSION_RANK[this.definitionLevel(entityDefId)] >= PERMISSION_RANK.edit
  }

  assertEditEntity(entityDefId: string): void {
    if (this.canEditEntity(entityDefId)) return
    throw new ForbiddenError("This agent doesn't have permission to edit these records.")
  }

  filterEditableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canEditEntity(id))
  }

  canViewEntity(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) return true
    return PERMISSION_RANK[this.definitionLevel(entityDefId)] >= PERMISSION_RANK.view
  }

  assertViewEntity(entityDefId: string): void {
    if (this.canViewEntity(entityDefId)) return
    throw new ForbiddenError("This agent doesn't have permission to view these records.")
  }

  filterViewableDefIds(entityDefIds: string[]): string[] {
    return entityDefIds.filter((id) => this.canViewEntity(id))
  }

  /**
   * **An agent has no front door beyond its published policy** (plan v3/03 §6.1).
   *
   * `hasDefPresence` is `canViewEntity || grantedDefIds[def]`, and the second
   * term is a *human* member's per-record shares. An agent's authority is the
   * immutable `AgentVersion.permissionPolicy` snapshot and nothing else —
   * `composeUserCapabilities` returns an EMPTY set for `userType: 'AGENT'`
   * precisely so a leftover `ResourceAccess` row on the agent's synthetic user
   * cannot grant anything. Deriving a front door from such rows would reopen
   * that door.
   *
   * So the policy answer IS the presence answer, and
   * {@link hasRecordGrantsOn} is unconditionally `false`.
   */
  hasDefPresence(entityDefId: string): boolean {
    return this.canViewEntity(entityDefId)
  }

  /** Always `false` — see {@link hasDefPresence}. */
  hasRecordGrantsOn(_entityDefId: string): boolean {
    return false
  }

  /**
   * The published definition rung on the {@link Rung} ladder. `none` → the
   * `'none'` rung rather than `undefined`: unlike the human set, the policy is
   * TOTAL, so "the policy says none" is a decision, not an absent tier.
   */
  recordDefRung(entityDefId: string): Rung | undefined {
    if (this.isMailInfraDef(entityDefId)) return undefined
    return permissionToRung(this.definitionLevel(entityDefId))
  }

  /**
   * The row-effective stamp for an agent is its DEF level, full stop — the
   * `grantRank` half is ignored on purpose.
   *
   * A grant rank is computed from `ResourceAccess` rows addressed to the running
   * principal's grantee union. For an agent that union resolves against its
   * synthetic `User` row, and honouring it here would let a stray share on that
   * user raise the agent above its published policy — the exact escalation the
   * empty-capability branch in `composeUserCapabilities` exists to prevent.
   */
  recordAccessAt(entityDefId: string, _grantRank: number | null): Rung {
    return this.recordDefRung(entityDefId) ?? 'none'
  }

  /** Row-effective DELETE gate — the `edit` floor plus the policy's delete key. */
  canDeleteRecordAt(access: Rung): boolean {
    if (!satisfiesRung(access, 'edit')) return false
    return this.keys.has(PermissionKey.recordsDelete) || satisfiesRung(access, 'admin')
  }

  /**
   * Row-effective EDIT gate — the `edit` floor on the stamp.
   *
   * Safe despite an agent having no shares of its own, because
   * {@link recordAccessAt} discards `grantRank` entirely: the stamp an agent is
   * ever judged at is its own published definition rung, so this can only ever
   * re-ask the policy question at row granularity.
   */
  canEditRecordAt(access: Rung): boolean {
    return satisfiesRung(access, 'edit')
  }

  /**
   * The published definition rung, or `undefined` for `none`.
   *
   * The policy and this method now speak the same `ResourcePermission` strings
   * (plan 26 Phase 2), so the only translation left is the bottom rung: `'none'`
   * becomes `undefined`, because that is the vocabulary every downstream gate
   * already reads — `satisfiesPermission` treats a stored `'none'` as a *grant
   * row marker*, not as "denied", so returning it verbatim would read as a live
   * type-level grant.
   *
   * Unlike the human `CapabilitySet`, where `undefined` means "no explicit
   * type-level grant, fall back to the base records verb", here it means exactly
   * "denied" — the policy is total, so there is no fallback tier to defer to.
   * `MinCapabilitySet` treats `undefined` as absorbing, which is the correct
   * intersection either way.
   */
  viewAccessFor(entityDefId: string): ResourcePermission | undefined {
    if (this.isMailInfraDef(entityDefId)) return undefined
    const level = this.definitionLevel(entityDefId)
    return level === 'none' ? undefined : level
  }

  canAdministerDef(entityDefId: string): boolean {
    if (this.isMailInfraDef(entityDefId)) return false
    return this.definitionLevel(entityDefId) === 'admin'
  }

  assertAdministerDef(entityDefId: string): void {
    if (this.canAdministerDef(entityDefId)) return
    throw new ForbiddenError("This agent doesn't have permission to administer this definition.")
  }

  /**
   * The effective rung for one shareable resource instance.
   *
   * A thin delegate on purpose: {@link policyResourceLevel} owns BOTH halves of
   * the answer — the instance rule and the intersection with its coarse L2 area
   * gate — because the same intersection is what supplies the fall-through for a
   * type the policy names no rule for. Splitting them left two places that had to
   * agree about the area's authority; there is now one.
   *
   * The gate itself is not optional: an agent policy that says
   * `knowledgeBase: None` but leaves a stale `kb` instance override at `Full`
   * must not route around its own area rule, or "effective execution is the
   * intersection of every constraint" (§0.5) stops being true for exactly the
   * domain where it matters most.
   */
  private instanceLevel(key: InstanceAccessKey, instanceId: string): ResourcePermission {
    return policyResourceLevel(this.policy, key, instanceId)
  }

  canViewInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return PERMISSION_RANK[this.instanceLevel(key, instanceId)] >= PERMISSION_RANK.view
  }

  canEditInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return PERMISSION_RANK[this.instanceLevel(key, instanceId)] >= PERMISSION_RANK.edit
  }

  canAdminInstance(key: InstanceAccessKey, instanceId: string): boolean {
    return this.instanceLevel(key, instanceId) === 'admin'
  }

  assertViewInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canViewInstance(key, instanceId)) return
    throw new ForbiddenError("This agent doesn't have permission to view this.")
  }

  assertEditInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canEditInstance(key, instanceId)) return
    throw new ForbiddenError("This agent doesn't have permission to edit this.")
  }

  assertAdminInstance(key: InstanceAccessKey, instanceId: string): void {
    if (this.canAdminInstance(key, instanceId)) return
    throw new ForbiddenError("This agent doesn't have permission to manage this.")
  }

  /**
   * Mail/messaging-infrastructure defs (signatures, snippets, threads…) are
   * governed by the mail visibility system and the coarse mail area keys, NOT by
   * the record-def keyspace — exactly as in `CapabilitySet`. Mirroring that
   * carve-out is deliberate: a `chat_agent` at `definitions: none` must fail on
   * *records*, without also breaking mail tools whose authorization lives
   * elsewhere. Their area rungs still come from this policy, so an agent with
   * `None` on the mail areas holds no mail verbs either.
   */
  private isMailInfraDef(entityDefId: string): boolean {
    return (
      NON_RECORD_DEF_SLUGS.has(entityDefId) ||
      NON_RECORD_DEF_SLUGS.has(this.defIdToApiSlug(entityDefId)) ||
      NON_RECORD_DEF_SLUGS.has(this.defIdToSlug(entityDefId))
    )
  }

  /** The capability key required to write the given RecordId-def part. */
  private writeKeyFor(entityDefId: string): PermissionKey {
    const slug = this.defIdToSlug(entityDefId)
    return ENTITY_WRITE_KEYS[slug] ?? PermissionKey.recordsEdit
  }
}
