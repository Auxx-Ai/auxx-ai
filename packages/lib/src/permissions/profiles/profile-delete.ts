// packages/lib/src/permissions/profiles/profile-delete.ts

import { type AgentKind, type Database, database, schema } from '@auxx/database'
import type { ResourcePermission, Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedResources, onCacheEvent } from '../../cache'
import { ForbiddenError, NotFoundError } from '../../errors'
import { PERMISSION_RANK } from '../capabilities/compose-user-capabilities'
import {
  AREA_ORDER,
  type Area,
  Level,
  PERMISSION_AREAS,
  parseAreaLevels,
} from '../capabilities/registry'
import { RUNG_ORDER } from '../capabilities/rung'
import { FeaturePermissionService } from '../feature-permission-service'
import { FeatureKey } from '../types'
import {
  computeEffectiveStatesUncached,
  type EffectiveState,
  type QueryRunner,
} from './effective-state'
import {
  type ActorAuthority,
  assertNoEscalation,
  assertProfileMapNoEscalation,
  HOLDER_GUARD_CAP,
  type ProfileAuthoredState,
} from './escalation-guard'
import {
  emitPermissionProfileChanged,
  fanOutCapabilityChange,
  type ProfileAudience,
  resolveProfileAudience,
  resolveProfileHolderIds,
} from './profile-invalidation'
import { parseProfileCeiling } from './profile-projection'
import { systemProfileFor, systemProfileForAgentKind } from './system-profiles'
import type { ProfileCeiling, SystemProfileSlug } from './types'

/** Input for both {@link deletePermissionProfile} and {@link previewPermissionProfileDeletion}. */
export interface DeletePermissionProfileInput {
  organizationId: string
  /** Who is deleting — their own effective state is the authority ceiling (§6.1.1). */
  actorUserId: string
  profileId: string
  db?: Database
}

/** One area whose rung moves for at least one holder when the profile is deleted. */
export interface ProfileDeletionAreaDelta {
  area: Area
  /** `PERMISSION_AREAS[area].label` — the dialog's "gaining: **Records** Full". */
  label: string
  from: Level
  to: Level
  /** `gain` is the case §0.24 warns about: deletion can WIDEN. */
  direction: 'gain' | 'loss'
  /** How many holders make exactly this `from → to` move. */
  holderCount: number
}

/** One entity definition or shared instance whose level moves for at least one holder. */
export interface ProfileDeletionResourceDelta {
  /** `entityDefinitionId` for a definition delta, the instance CUID for an instance delta. */
  id: string
  /** apiSlug when `id` resolves to a live entity definition; absent for instances. */
  apiSlug?: string
  /** Display label when `id` resolves to a live entity definition. */
  label?: string
  /**
   * `null` = no access at all on that side.
   *
   * TWO ladders share this field, by domain: a DEF delta carries a
   * {@link ResourcePermission} (`view/edit/admin`), an INSTANCE delta a
   * {@link Rung} (`read/edit/admin`, plus mail's `metadata`/`identity`). They
   * are never compared against each other — {@link buildResourceDeltas} picks
   * the matching rank function per domain — and the union is what keeps this
   * preview honest instead of stringifying one vocabulary into the other.
   */
  from: ResourcePermission | Rung | null
  to: ResourcePermission | Rung | null
  direction: 'gain' | 'loss'
  holderCount: number
}

/** How many holders land on which §1.3 system template — "N members return to the Member default". */
export interface ProfileDeletionFallback {
  slug: SystemProfileSlug
  /** The org's row for that template, or `null` when it is not seeded (code fallback, §5.2). */
  profileId: string | null
  holderCount: number
}

/** A bound draft agent that falls back by kind and is marked dirty (§0.24). */
export interface ProfileDeletionAgentDraft {
  id: string
  slug: string
  kind: AgentKind
  /** `agent` or `chat_agent`, per {@link systemProfileForAgentKind}. */
  fallbackSlug: Extract<SystemProfileSlug, 'agent' | 'chat_agent'>
  /** True when the draft has a published baseline, so the delete marks it unpublished. */
  markedDirty: boolean
}

/**
 * A published `AgentVersion` snapshot cut from this profile. Listed **separately
 * and explicitly as unchanged** (§0.24): the snapshot is self-contained,
 * `sourceProfileId` is audit text and not an FK, and the version stays
 * executable. The next publish snapshots the fallback policy instead.
 */
export interface ProfileDeletionPublishedVersion {
  agentId: string
  agentSlug: string
  versionId: string
  versionNumber: number
  /** Always `true` — deletion never rewrites a published snapshot. */
  unchanged: true
}

/** What a profile deletion did (or, in preview, would do). */
export interface PermissionProfileDeletionSummary {
  profile: {
    id: string
    slug: string
    name: string
    appliesTo: string
    isSystem: boolean
  }
  /** Human holders whose `permissionProfileId` was (or would be) nulled. */
  holderIds: string[]
  holderCount: number
  /** Where those holders land, grouped by system template (§1.3). */
  fallbacks: ProfileDeletionFallback[]
  /**
   * `false` when the holder set exceeded {@link HOLDER_GUARD_CAP}: the guard fell
   * back to the strict profile-map check (§6.1.3) and no per-holder state was
   * composed, so the three delta lists below are empty rather than wrong.
   */
  deltaExact: boolean
  areaDeltas: ProfileDeletionAreaDelta[]
  defDeltas: ProfileDeletionResourceDelta[]
  instanceDeltas: ProfileDeletionResourceDelta[]
  agentDrafts: ProfileDeletionAgentDraft[]
  publishedVersions: ProfileDeletionPublishedVersion[]
  /** Bound invitations whose binding was nulled; acceptance falls back per §1.1. */
  invitationIds: string[]
}

/** {@link PermissionProfileDeletionSummary} plus whether the guard would refuse. */
export interface PermissionProfileDeletionPreview extends PermissionProfileDeletionSummary {
  /**
   * The §6.1 escalation-guard refusal message, or `null` when the delete would be
   * allowed. The preview reports it instead of throwing so the dialog can render
   * the delta AND disable its confirm button in one round trip.
   */
  blockedReason: string | null
}

/** The profile row the deletion reads before writing. */
interface ProfileRow {
  id: string
  slug: string
  name: string
  appliesTo: string
  isSystem: boolean
  baseLevel: number | null
  ceiling: unknown
}

/** A captured human holder — the id plus what decides its §1.3 fallback template. */
interface HolderRow {
  userId: string
  role: OrganizationRole
  seatType: SeatType
}

/** Everything captured INSIDE the transaction, before any binding is nulled. */
interface Capture {
  holders: HolderRow[]
  holderIds: string[]
  agents: Array<{ id: string; slug: string; kind: AgentKind; activeVersionId: string | null }>
  invitationIds: string[]
  publishedVersions: ProfileDeletionPublishedVersion[]
}

/**
 * Rolls a preview transaction back by unwinding out of it, carrying the computed
 * summary. Internal — never escapes {@link previewPermissionProfileDeletion}.
 *
 * The preview deliberately performs the real writes and then discards them: the
 * `after` state has to come from {@link computeEffectiveStatesUncached} reading
 * post-write rows, exactly like the committing path. Simulating the fallback in
 * memory instead would be the hand-rolled second composer §6.1.4 forbids — the
 * dialog would then promise a delta enforcement never produces.
 */
class PreviewRollback extends Error {
  constructor(readonly payload: PermissionProfileDeletionPreview) {
    super('permission profile deletion preview — rolling back')
    this.name = 'PreviewRollback'
  }
}

/**
 * Delete a permission profile in ONE transaction (§8.4), then invalidate.
 *
 * The order is exactly the plan's, and both halves of it are load-bearing:
 *
 * ```
 * capture holders / agent drafts / invitations   ← INSIDE the txn, BEFORE the null-out
 *   → null their permissionProfileId
 *   → delete the profile's PermissionGrant row
 *   → delete its ResourceAccess rows (type AND instance)
 *   → delete the profile
 *   → commit
 *   → THEN invalidate the captured holders and draft agents
 * ```
 *
 * - **Capturing after the null-out loses the holder set** — the bindings are the
 *   only thing that names them, so the sweep must run first.
 * - **Invalidating before commit races a rollback** — the escalation guard throws
 *   from inside the transaction, and a pre-commit fan-out would have published a
 *   capability change that never happened.
 *
 * `granteeId` has **no FK** in either grant table, so nothing cascades: deleting
 * the `PermissionGrant` row and the `ResourceAccess` rows is mandatory, not
 * belt-and-braces. (The three *principal* bindings do carry `onDelete: 'set
 * null'`, but they are nulled explicitly anyway — the capture has to see them,
 * and relying on the FK would make the order unverifiable.)
 *
 * Fallback semantics (§0.24): humans resolve through §1.3's
 * {@link systemProfileFor} to `member` (full seat) or `field_tech` (worker) plus
 * the role templates — **which can widen**, hence the delta this returns. Draft
 * agents fall back by kind and are marked dirty. Already-published
 * `AgentVersion.permissionPolicy` snapshots are untouched and still executable.
 * **System profiles are never deletable**, so a template always exists to fall
 * back to.
 */
export async function deletePermissionProfile(
  input: DeletePermissionProfileInput
): Promise<PermissionProfileDeletionSummary> {
  const db = input.db ?? database

  const summary = await db.transaction(async (tx) => {
    const result = await runDeletion(tx as QueryRunner, input)
    // In the committing path a refusal is an error, not a field.
    if (result.blockedReason) throw new ForbiddenError(result.blockedReason)
    return result
  })

  // ── AFTER commit only (§8.4 / §8.3).
  //
  // The audience is the CAPTURED holder set, unioned with whatever the cached
  // sweep still returns. `resolveProfileAudience` reads `memberRoleMap`, which at
  // this point may already have been recomputed (by this delete's own event, or a
  // concurrent request) and would then return nobody — the profile is gone and no
  // binding points at it any more. The captured ids are the authoritative half.
  const audience = await resolveProfileAudience({
    organizationId: input.organizationId,
    profileId: input.profileId,
    slug: summary.profile.slug,
    isSystem: summary.profile.isSystem,
  })
  const merged: ProfileAudience = audience.broadcast
    ? audience
    : { userIds: [...new Set([...audience.userIds, ...summary.holderIds])], broadcast: false }

  await emitPermissionProfileChanged({
    organizationId: input.organizationId,
    profileId: input.profileId,
    slug: summary.profile.slug,
    isSystem: summary.profile.isSystem,
    audience: merged,
  })
  // The profile's own grant row went away, so `hasPermissionGrants` — the
  // composer's short-circuit — may have flipped. Fan it out too.
  await fanOutCapabilityChange('permission-grant.changed', input.organizationId, merged)

  if (summary.agentDrafts.length > 0) {
    await onCacheEvent('agent.updated', { orgId: input.organizationId })
  }

  return summary
}

/**
 * The read-only half of {@link deletePermissionProfile}: run the identical
 * transaction, compute the identical delta, then **roll back**.
 *
 * Step 7's delete dialog calls this to show holder count, the access delta
 * ("N members return to the Member default, gaining: Records Full, Files Full")
 * and the untouched published snapshots *before* the user commits. Nothing is
 * written, no event is emitted, and a guard refusal comes back as
 * {@link PermissionProfileDeletionPreview.blockedReason} instead of a throw.
 *
 * The governance gates (system-profile immutability, cross-org, the OWNER/ADMIN
 * rule for agent profiles, the plan gate) DO throw here, so the dialog never
 * offers a delete the mutation would refuse outright.
 */
export async function previewPermissionProfileDeletion(
  input: DeletePermissionProfileInput
): Promise<PermissionProfileDeletionPreview> {
  const db = input.db ?? database

  try {
    return await db.transaction(async (tx) => {
      const result = await runDeletion(tx as QueryRunner, input)
      throw new PreviewRollback(result)
    })
  } catch (error) {
    if (error instanceof PreviewRollback) return error.payload
    throw error
  }
}

/**
 * The §8.4 transaction body, shared verbatim by the committing and preview paths
 * so the preview cannot drift from what the delete actually does.
 */
async function runDeletion(
  tx: QueryRunner,
  input: DeletePermissionProfileInput
): Promise<PermissionProfileDeletionPreview> {
  const { organizationId, actorUserId, profileId } = input

  const profile = await loadProfile(tx, organizationId, profileId)
  const actorRole = await loadActorRole(tx, organizationId, actorUserId)

  // §0.24 — a template must always exist to fall back to.
  if (profile.isSystem) {
    throw new ForbiddenError(
      `The '${profile.name}' profile is a system profile and cannot be deleted. It is the template holders fall back to.`
    )
  }
  // §0.25 / doc 14 §0.9 — `permissions` being grantable must not hand agent
  // policy to a non-admin, on delete any more than on save.
  if (profile.appliesTo === 'agent' && actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
    throw new ForbiddenError(
      'Only owners and admins can delete an agent permission profile (doc 14 §0.9).'
    )
  }
  // §0.26 — writes are plan-gated; composition never is.
  await new FeaturePermissionService(tx).requireAccess(
    organizationId,
    FeatureKey.granularPermissions
  )

  // ── 1. CAPTURE, inside the transaction and before anything is nulled (§8.4).
  const capture = await captureHolders(tx, organizationId, profileId, profile)

  const exact = capture.holderIds.length <= HOLDER_GUARD_CAP

  // ── 2. `before`, still pre-write. The actor's authority is their PRE-write
  //      state so a delete can never authorize itself (§6.1.1).
  const before = await computeEffectiveStatesUncached({
    organizationId,
    userIds: exact ? [...capture.holderIds, actorUserId] : [actorUserId],
    tx,
  })
  const actorState = before.get(actorUserId)
  if (!actorState) throw new ForbiddenError('You are not a member of this organization.')
  const actor: ActorAuthority = { userId: actorUserId, role: actorRole, state: actorState }

  const beforeAuthored: ProfileAuthoredState = {
    levels: await readProfileLevels(tx, organizationId, profileId),
    baseLevel: (profile.baseLevel as Level | null) ?? null,
    ceiling: parseProfileCeiling(profile.ceiling),
  }

  // ── 3. THE WRITES, in §8.4's order.
  await applyDeletion(tx, organizationId, profileId, capture)

  // ── 4. `after`, re-read post-write: holders now compose through §1.3's
  //      system template, which may sit HIGHER than the deleted profile did.
  const after = exact
    ? await computeEffectiveStatesUncached({ organizationId, userIds: capture.holderIds, tx })
    : new Map<string, EffectiveState>()

  const fallbacks = await resolveFallbacks(tx, organizationId, capture.holders)

  // ── 5. The escalation guard. Deletion is in the affected-holder set precisely
  //      because it can widen (§6.1.3). A refusal throws → the txn rolls back.
  let blockedReason: string | null = null
  try {
    if (exact) {
      assertNoEscalation({ actor, before, after })
    } else {
      await assertStrictFallbackNoEscalation(tx, {
        organizationId,
        actor,
        before: beforeAuthored,
        fallbacks,
      })
    }
  } catch (error) {
    if (error instanceof ForbiddenError) blockedReason = error.message
    else throw error
  }

  const resources = await getCachedResources(organizationId)
  const defLabels = new Map(
    resources.map((r) => [r.entityDefinitionId, { apiSlug: r.apiSlug, label: r.label }])
  )

  return {
    profile: {
      id: profile.id,
      slug: profile.slug,
      name: profile.name,
      appliesTo: profile.appliesTo,
      isSystem: profile.isSystem,
    },
    holderIds: capture.holderIds,
    holderCount: capture.holderIds.length,
    fallbacks,
    deltaExact: exact,
    areaDeltas: exact ? buildAreaDeltas(capture.holderIds, before, after) : [],
    defDeltas: exact
      ? buildResourceDeltas(capture.holderIds, before, after, 'defs', defLabels)
      : [],
    instanceDeltas: exact ? buildResourceDeltas(capture.holderIds, before, after, 'instances') : [],
    agentDrafts: capture.agents.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      kind: agent.kind,
      fallbackSlug: systemProfileForAgentKind(agent.kind),
      markedDirty: agent.activeVersionId !== null,
    })),
    publishedVersions: capture.publishedVersions,
    invitationIds: capture.invitationIds,
    blockedReason,
  }
}

/** Load the target profile, refusing a cross-org id outright (§1.1). */
async function loadProfile(
  tx: QueryRunner,
  organizationId: string,
  profileId: string
): Promise<ProfileRow> {
  const [row] = await tx
    .select({
      id: schema.PermissionProfile.id,
      slug: schema.PermissionProfile.slug,
      name: schema.PermissionProfile.name,
      appliesTo: schema.PermissionProfile.appliesTo,
      isSystem: schema.PermissionProfile.isSystem,
      baseLevel: schema.PermissionProfile.baseLevel,
      ceiling: schema.PermissionProfile.ceiling,
    })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) throw new NotFoundError('Permission profile not found in this organization.')
  return row as ProfileRow
}

/** The actor's org role — the §6.1.1 OWNER short-circuit and the agent gate. */
async function loadActorRole(
  tx: QueryRunner,
  organizationId: string,
  actorUserId: string
): Promise<OrganizationRole> {
  const [row] = await tx
    .select({ role: schema.OrganizationMember.role })
    .from(schema.OrganizationMember)
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.userId, actorUserId)
      )
    )
    .limit(1)

  if (!row) throw new ForbiddenError('You are not a member of this organization.')
  return row.role
}

/** The profile's currently stored area levels — the strict fallback's `before`. */
async function readProfileLevels(
  tx: QueryRunner,
  organizationId: string,
  profileId: string
): Promise<Partial<Record<Area, Level>>> {
  const [row] = await tx
    .select({ levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, profileId)
      )
    )
    .limit(1)

  return row ? parseAreaLevels(row.levels) : {}
}

/**
 * The §6.1.3 affected-holder sweep for a deletion, run BEFORE the null-out.
 *
 * Two sources, deliberately unioned:
 *
 *  - {@link resolveProfileHolderIds} — the shared sweep the save path and the
 *    §8.3 invalidation use, so one profile change has one holder definition.
 *    It reads the cached `memberRoleMap`.
 *  - a direct, index-backed read of `OrganizationMember` from the transaction —
 *    because a stale cache that misses a holder would silently drop that holder
 *    out of the guard's comparison, and the guard is the only thing standing
 *    between "deletion widens access" and an escalation. §8.3 already notes the
 *    `(organizationId, permissionProfileId)` indexes exist for the delete path
 *    "where a cache read would be unsafe".
 *
 * The transactional read also carries `role`/`seatType`, which is what
 * {@link systemProfileFor} needs to say *where* each holder lands — at zero extra
 * cost. A holder only the cache knows about is still captured (id only) so it is
 * invalidated after commit.
 */
async function captureHolders(
  tx: QueryRunner,
  organizationId: string,
  profileId: string,
  profile: ProfileRow
): Promise<Capture> {
  const [memberRows, agentRows, invitationRows, cachedHolderIds] = await Promise.all([
    tx
      .select({
        userId: schema.OrganizationMember.userId,
        role: schema.OrganizationMember.role,
        seatType: schema.OrganizationMember.seatType,
      })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.permissionProfileId, profileId)
        )
      ),
    tx
      .select({
        id: schema.Agent.id,
        slug: schema.Agent.slug,
        kind: schema.Agent.kind,
        activeVersionId: schema.Agent.activeVersionId,
      })
      .from(schema.Agent)
      .where(
        and(
          eq(schema.Agent.organizationId, organizationId),
          eq(schema.Agent.permissionProfileId, profileId)
        )
      ),
    tx
      .select({ id: schema.OrganizationInvitation.id })
      .from(schema.OrganizationInvitation)
      .where(
        and(
          eq(schema.OrganizationInvitation.organizationId, organizationId),
          eq(schema.OrganizationInvitation.permissionProfileId, profileId)
        )
      ),
    resolveProfileHolderIds({
      organizationId,
      profileId,
      slug: profile.slug,
      // A system profile is never deletable, so the null-bound branch of the
      // sweep is unreachable here — passed explicitly rather than inferred.
      isSystem: profile.isSystem,
    }),
  ])

  const holders = memberRows as HolderRow[]
  const holderIds = [...new Set([...holders.map((row) => row.userId), ...(cachedHolderIds ?? [])])]

  return {
    holders,
    holderIds,
    agents: agentRows as Capture['agents'],
    invitationIds: invitationRows.map((row) => row.id),
    publishedVersions: await capturePublishedVersions(tx, organizationId, profileId),
  }
}

/**
 * Active `AgentVersion` snapshots whose `permissionPolicy.sourceProfileId` names
 * this profile — listed so the dialog can say they are **unchanged** (§0.24).
 *
 * Scoped to each agent's *active* version, which is what "still executable"
 * means for the dialog. Historical versions are equally untouched (the snapshot
 * is self-contained and `sourceProfileId` is audit text, not an FK) and are
 * deliberately not enumerated — the list is a reassurance, not an inventory.
 * The `sourceProfileId` match is done in memory because it lives inside a jsonb
 * column with no index to key on.
 */
async function capturePublishedVersions(
  tx: QueryRunner,
  organizationId: string,
  profileId: string
): Promise<ProfileDeletionPublishedVersion[]> {
  const rows = await tx
    .select({
      agentId: schema.Agent.id,
      agentSlug: schema.Agent.slug,
      versionId: schema.AgentVersion.id,
      versionNumber: schema.AgentVersion.versionNumber,
      permissionPolicy: schema.AgentVersion.permissionPolicy,
    })
    .from(schema.Agent)
    .innerJoin(schema.AgentVersion, eq(schema.AgentVersion.id, schema.Agent.activeVersionId))
    .where(eq(schema.Agent.organizationId, organizationId))

  const out: ProfileDeletionPublishedVersion[] = []
  for (const row of rows) {
    const policy = row.permissionPolicy as { sourceProfileId?: string | null } | null
    if (policy?.sourceProfileId !== profileId) continue
    out.push({
      agentId: row.agentId,
      agentSlug: row.agentSlug,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      unchanged: true,
    })
  }
  return out
}

/**
 * The §8.4 writes, in the order the plan pins:
 * null the three principal bindings → delete the profile's `PermissionGrant` row
 * → delete its `ResourceAccess` rows (type **and** instance) → delete the profile.
 *
 * The two grant deletions are not optional: `granteeId` has no FK in either
 * table, so a skipped delete leaves rows that a later profile reusing the id
 * would silently inherit.
 */
async function applyDeletion(
  tx: QueryRunner,
  organizationId: string,
  profileId: string,
  capture: Capture
): Promise<void> {
  const now = new Date()

  await tx
    .update(schema.OrganizationMember)
    .set({ permissionProfileId: null, updatedAt: now })
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.permissionProfileId, profileId)
      )
    )

  if (capture.agents.length > 0) {
    // Draft agents fall back by kind AND are marked dirty (§0.24) — but only the
    // ones with a published baseline; a never-published draft has nothing to be
    // unpublished against. This mirrors `MARK_DIRTY_IF_PUBLISHED` in the toolset
    // and scope services, expressed as two id lists so the update stays portable.
    const dirtyIds = capture.agents.filter((a) => a.activeVersionId !== null).map((a) => a.id)
    const cleanIds = capture.agents.filter((a) => a.activeVersionId === null).map((a) => a.id)
    if (dirtyIds.length > 0) {
      await tx
        .update(schema.Agent)
        .set({ permissionProfileId: null, hasUnpublishedChanges: true, updatedAt: now })
        .where(
          and(eq(schema.Agent.organizationId, organizationId), inArray(schema.Agent.id, dirtyIds))
        )
    }
    if (cleanIds.length > 0) {
      await tx
        .update(schema.Agent)
        .set({ permissionProfileId: null, updatedAt: now })
        .where(
          and(eq(schema.Agent.organizationId, organizationId), inArray(schema.Agent.id, cleanIds))
        )
    }
  }

  await tx
    .update(schema.OrganizationInvitation)
    .set({ permissionProfileId: null })
    .where(
      and(
        eq(schema.OrganizationInvitation.organizationId, organizationId),
        eq(schema.OrganizationInvitation.permissionProfileId, profileId)
      )
    )

  await tx
    .delete(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, profileId)
      )
    )

  // Type rows AND instance rows — one predicate, since neither carries an FK on
  // `granteeId` and both are keyed by the same grantee.
  await tx
    .delete(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.granteeType, 'profile'),
        eq(schema.ResourceAccess.granteeId, profileId)
      )
    )

  await tx
    .delete(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
}

/**
 * Group the captured holders by the §1.3 template they now resolve to — what the
 * dialog turns into "N members return to the **Member** default".
 *
 * Holders known only to the cached sweep carry no `role`/`seatType` and are
 * therefore counted in `holderCount` but not attributed to a template; the sum of
 * `fallbacks[].holderCount` can be lower than `holderCount`.
 */
async function resolveFallbacks(
  tx: QueryRunner,
  organizationId: string,
  holders: HolderRow[]
): Promise<ProfileDeletionFallback[]> {
  const counts = new Map<SystemProfileSlug, number>()
  for (const holder of holders) {
    const slug = systemProfileFor(holder.role, holder.seatType)
    counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const slugs = [...counts.keys()]
  const rows = await tx
    .select({ id: schema.PermissionProfile.id, slug: schema.PermissionProfile.slug })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.organizationId, organizationId),
        inArray(schema.PermissionProfile.slug, slugs)
      )
    )
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]))

  return slugs.map((slug) => ({
    slug,
    // `null` is the §5.2 runtime fallback: no row seeded, so composition uses
    // ROLE_DEFAULTS in code. The dialog should still name the template.
    profileId: idBySlug.get(slug) ?? null,
    holderCount: counts.get(slug) ?? 0,
  }))
}

/**
 * The >{@link HOLDER_GUARD_CAP} strict fallback (§6.1.3) for a deletion: compare
 * the deleted profile's own map against each system template the holders land on,
 * and require the actor to hold every raised value outright.
 *
 * Run once per distinct fallback template — bounded by four (`owner`, `admin`,
 * `member`, `field_tech`) — because holders of one profile may differ in role and
 * seat and therefore land in different places.
 */
async function assertStrictFallbackNoEscalation(
  tx: QueryRunner,
  input: {
    organizationId: string
    actor: ActorAuthority
    before: ProfileAuthoredState
    fallbacks: ProfileDeletionFallback[]
  }
): Promise<void> {
  const { organizationId, actor, before, fallbacks } = input
  const targets = fallbacks.filter((f) => f.holderCount > 0)
  if (targets.length === 0) return

  for (const target of targets) {
    const after = await readAuthoredState(tx, organizationId, target.profileId)
    assertProfileMapNoEscalation({ actor, before, after })
  }
}

/** A profile's authored map (levels + baseLevel + ceiling), or the empty map. */
async function readAuthoredState(
  tx: QueryRunner,
  organizationId: string,
  profileId: string | null
): Promise<ProfileAuthoredState> {
  // No seeded row: composition falls through to ROLE_DEFAULTS, which this check
  // cannot see. `None` everywhere is the conservative reading for a "before"
  // AND the honest one for an "after" it cannot enumerate.
  if (!profileId) return { levels: {}, baseLevel: null, ceiling: null }

  const [row] = await tx
    .select({
      baseLevel: schema.PermissionProfile.baseLevel,
      ceiling: schema.PermissionProfile.ceiling,
    })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.id, profileId),
        eq(schema.PermissionProfile.organizationId, organizationId)
      )
    )
    .limit(1)

  return {
    levels: await readProfileLevels(tx, organizationId, profileId),
    baseLevel: ((row?.baseLevel ?? null) as Level | null) ?? null,
    ceiling: (row ? parseProfileCeiling(row.ceiling) : null) as ProfileCeiling | null,
  }
}

/**
 * Aggregate the per-holder area moves into one list the dialog can render,
 * grouped by the exact `(area, from, to)` tuple so "3 members gain Records Full"
 * is never averaged out of two different moves.
 */
function buildAreaDeltas(
  holderIds: string[],
  before: Map<string, EffectiveState>,
  after: Map<string, EffectiveState>
): ProfileDeletionAreaDelta[] {
  const groups = new Map<string, ProfileDeletionAreaDelta>()

  for (const userId of holderIds) {
    const prevState = before.get(userId)
    const nextState = after.get(userId)
    if (!nextState) continue
    for (const area of AREA_ORDER) {
      const prev = prevState?.areas[area] ?? Level.None
      const next = nextState.areas[area]
      if (next === prev) continue
      const key = `${area}:${prev}:${next}`
      const existing = groups.get(key)
      if (existing) existing.holderCount += 1
      else {
        groups.set(key, {
          area,
          label: PERMISSION_AREAS[area].label,
          from: prev,
          to: next,
          direction: next > prev ? 'gain' : 'loss',
          holderCount: 1,
        })
      }
    }
  }

  // Gains first: §0.24's warning is that deletion can WIDEN, so that is what the
  // dialog leads with.
  return [...groups.values()].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'gain' ? -1 : 1
    return AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area)
  })
}

/** `undefined` (no access) ranks below every real permission — as in the guard. */
function permissionRank(permission: ResourcePermission | undefined): number {
  return permission === undefined ? 0 : PERMISSION_RANK[permission]
}

/** {@link permissionRank}'s twin for the {@link Rung}-valued INSTANCE lane. */
function rungRankOrNone(rung: Rung | undefined): number {
  return rung === undefined ? 0 : RUNG_ORDER[rung]
}

/**
 * The definition/instance analogue of {@link buildAreaDeltas}. Keys present on
 * only one side still count: an absent key means no access, not "unchanged".
 */
function buildResourceDeltas(
  holderIds: string[],
  before: Map<string, EffectiveState>,
  after: Map<string, EffectiveState>,
  domain: 'defs' | 'instances',
  labels?: Map<string, { apiSlug: string; label: string }>
): ProfileDeletionResourceDelta[] {
  const groups = new Map<string, ProfileDeletionResourceDelta>()
  // Per-domain ladder (see `ProfileDeletionResourceDelta.from`). Ranking an
  // instance rung through `PERMISSION_RANK` would read `undefined` for `read`
  // and label every real gain a "loss".
  const rank =
    domain === 'defs'
      ? (v: ResourcePermission | Rung | undefined) =>
          permissionRank(v as ResourcePermission | undefined)
      : (v: ResourcePermission | Rung | undefined) => rungRankOrNone(v as Rung | undefined)

  for (const userId of holderIds) {
    const prevMap = before.get(userId)?.[domain] ?? {}
    const nextMap = after.get(userId)?.[domain]
    if (!nextMap) continue
    for (const id of new Set([...Object.keys(prevMap), ...Object.keys(nextMap)])) {
      const prev = prevMap[id]
      const next = nextMap[id]
      if (prev === next) continue
      const key = `${id}:${prev ?? '-'}:${next ?? '-'}`
      const existing = groups.get(key)
      if (existing) {
        existing.holderCount += 1
        continue
      }
      const meta = labels?.get(id)
      groups.set(key, {
        id,
        ...(meta ? { apiSlug: meta.apiSlug, label: meta.label } : {}),
        from: prev ?? null,
        to: next ?? null,
        direction: rank(next) > rank(prev) ? 'gain' : 'loss',
        holderCount: 1,
      })
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'gain' ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}
