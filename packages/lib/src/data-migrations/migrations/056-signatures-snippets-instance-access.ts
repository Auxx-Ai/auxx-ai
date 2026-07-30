// packages/lib/src/data-migrations/migrations/056-signatures-snippets-instance-access.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { Area, type Level, parseAreaLevels } from '../../permissions/capabilities/registry'
import {
  fanOutCapabilityChange,
  resolveProfileAudience,
  systemProfileSeed,
} from '../../permissions/profiles'
import { emitResourceAccessInstanceChanged } from '../../resource-access'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-056')

/** `INSTANCE_ACCESS_RESOURCES` keys, as they appear in `ResourceAccess.entityDefinitionId`. */
const SIGNATURE_KEY = 'signature'
const SNIPPET_KEY = 'snippet'

/** `granteeType: 'role'` id for "everyone in the workspace". */
const WORKSPACE_BASELINE_GRANTEE = 'org_member'

/** The legacy `SIGNATURE_FIELDS.visibility` option that meant "share with the org". */
const VISIBILITY_ORG_MEMBERS = 'org_members'

/** `SIGNATURE_FIELDS.visibility`'s `systemAttribute` (removed from the registry by 057). */
const VISIBILITY_ATTR = 'signature_visibility'

const CHUNK = 1000

/**
 * One instance to convert into `ResourceAccess` rows.
 *
 * `ownerId` is nullable on purpose — a signature whose owner cannot be resolved
 * to a real `User.id` must be SKIPPED and logged, never written with a bogus id
 * (`ResourceAccess.grantedById` is a real FK to `User`, so a bad value fails the
 * whole migration).
 */
export interface InstanceAccessSeed {
  organizationId: string
  instanceId: string
  ownerId: string | null
  /** Legacy vocabulary said "everyone in the org" (`ORGANIZATION` / `org_members`). */
  shareWithOrg: boolean
}

export interface BuiltInstanceAccessRows {
  /**
   * `user:<owner> @ admin`. Written as an UPSERT that RAISES the permission,
   * because a legacy row can already occupy this exact unique key at a weaker
   * level: `setSnippetSharing`'s `GROUPS` path happily wrote `user:<owner> @
   * view`. Left as `onConflictDoNothing` those owners would keep `view` on their
   * own content forever — and with no ADMIN override (plan 36 §0.6) nobody but
   * the org OWNER could repair it.
   */
  ownerRows: (typeof schema.ResourceAccess.$inferInsert)[]
  /**
   * `role:org_member @ view`. Written with `onConflictDoNothing` — an existing
   * workspace-baseline row is by definition at least as permissive as `view`,
   * so overwriting it could only ever DOWNGRADE a deliberate grant.
   */
  orgRows: (typeof schema.ResourceAccess.$inferInsert)[]
  /** Instances skipped because their owner did not resolve to a real `User.id`. */
  skipped: InstanceAccessSeed[]
}

/**
 * Normalize a `SINGLE_SELECT` stored value into the scalar option it represents.
 *
 * Per `project_use_system_values_single_select_arrays` a single-select value is
 * read back as an ARRAY by the lens/composed paths even though the DB row holds
 * a scalar in `optionId`. Both `signature-list.tsx` and `use-signature.ts`
 * already defend against this, which is the tell that either shape can arrive
 * here. Unwraps a one-element array, ignores anything else.
 */
export function normalizeSingleSelect(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Build the `ResourceAccess` rows for a batch of instances of one resource.
 *
 * Every instance with a resolvable owner gets an `admin` row for that owner —
 * this is the row that makes `baselineAtCreate: true` survivable, since without
 * it an absent row means NO access and the creator would lose their own content.
 * `shareWithOrg` additionally emits the `role:org_member @ view` workspace
 * baseline.
 *
 * Pure and deterministic: the same seeds always produce the same rows, which is
 * half of the migration's idempotency (the other half is the
 * `ResourceAccess_entity_grantee_key` unique constraint plus
 * `onConflictDoNothing`).
 */
export function buildInstanceAccessRows(
  resourceKey: typeof SIGNATURE_KEY | typeof SNIPPET_KEY,
  seeds: readonly InstanceAccessSeed[]
): BuiltInstanceAccessRows {
  const ownerRows: (typeof schema.ResourceAccess.$inferInsert)[] = []
  const orgRows: (typeof schema.ResourceAccess.$inferInsert)[] = []
  const skipped: InstanceAccessSeed[] = []

  for (const seed of seeds) {
    if (!seed.ownerId) {
      skipped.push(seed)
      continue
    }
    ownerRows.push({
      organizationId: seed.organizationId,
      entityDefinitionId: resourceKey,
      entityInstanceId: seed.instanceId,
      granteeType: ResourceGranteeType.user,
      granteeId: seed.ownerId,
      rung: 'admin',
      grantedById: seed.ownerId,
    })
    if (seed.shareWithOrg) {
      orgRows.push({
        organizationId: seed.organizationId,
        entityDefinitionId: resourceKey,
        entityInstanceId: seed.instanceId,
        granteeType: ResourceGranteeType.role,
        granteeId: WORKSPACE_BASELINE_GRANTEE,
        rung: 'read',
        grantedById: seed.ownerId,
      })
    }
  }

  return { ownerRows, orgRows, skipped }
}

/**
 * Every non-deleted snippet, as an owner-only seed.
 *
 * Deliberately does NOT read `Snippet.sharingType`: that column is dropped by
 * the Drizzle migration in this same slice, so reading it here would make this
 * migration's correctness depend on running BEFORE a schema file — exactly what
 * `feedback_migrations_self_sufficient` forbids. The `sharingType`-dependent
 * half (promoting `ORGANIZATION` to a `role:org_member @ view` row) is inlined
 * in that drop migration's own SQL, where the column still exists. The user
 * decision of 2026-07-28 makes the remainder safe: snippet volume is tiny, so
 * resetting sharing is acceptable and the legacy `GROUPS` rows are disposable.
 * `Snippet.createdById` is `NOT NULL` with an FK to `User`, so a snippet owner
 * is always resolvable.
 */
async function loadSnippetSeeds(db: Database): Promise<InstanceAccessSeed[]> {
  const snippets = await db
    .select({
      id: schema.Snippet.id,
      organizationId: schema.Snippet.organizationId,
      createdById: schema.Snippet.createdById,
    })
    .from(schema.Snippet)
    .where(eq(schema.Snippet.isDeleted, false))

  return snippets.map((s) => ({
    organizationId: s.organizationId,
    instanceId: s.id,
    ownerId: s.createdById,
    shareWithOrg: false,
  }))
}

/**
 * Every `signature` `EntityInstance`, with its owner resolved and verified.
 *
 * Owner resolution, in order:
 *  1. `EntityInstance.createdById` — the real column, an FK to `User`.
 *  2. the `created_by_id` `FieldValue`'s `actorId`. Per
 *     `project_actor_fieldvalue_storage_routing` an ACTOR value only stores a
 *     `User.id` in `actorId`; non-user actor kinds route through
 *     `relatedEntityId` instead, so a row with `relatedEntityId` but no
 *     `actorId` is NOT a user and must not be treated as one.
 *
 * Whatever comes out is then checked against the `User` table before use —
 * `ResourceAccess.grantedById` is a real FK, so an unverified id would abort the
 * migration. Anything left unresolved is returned as an owner-less seed, which
 * {@link buildInstanceAccessRows} skips and the runner logs.
 */
async function loadSignatureSeeds(db: Database): Promise<InstanceAccessSeed[]> {
  const defs = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.entityType, 'signature'))

  const defIds = defs.map((d) => d.id)
  if (defIds.length === 0) return []

  const instances = await db
    .select({
      id: schema.EntityInstance.id,
      organizationId: schema.EntityInstance.organizationId,
      createdById: schema.EntityInstance.createdById,
    })
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.entityDefinitionId, defIds))

  if (instances.length === 0) return []

  const instanceIds = instances.map((i) => i.id)

  // Fallback owner: the `created_by_id` ACTOR FieldValue. `actorId` only ever
  // holds a `User.id`; `relatedEntityId` means a non-user actor kind.
  const createdByValues = await db
    .select({
      entityId: schema.FieldValue.entityId,
      actorId: schema.FieldValue.actorId,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        inArray(schema.FieldValue.entityId, instanceIds),
        eq(schema.CustomField.systemAttribute, 'created_by_id')
      )
    )

  const actorOwner = new Map<string, string>()
  for (const row of createdByValues) {
    if (row.actorId) actorOwner.set(row.entityId, row.actorId)
  }

  // Legacy visibility. `optionId` is where a SINGLE_SELECT lands in the row;
  // `valueText`/`valueJson` are read too so an array-shaped or text-shaped write
  // from an older path still converts.
  const visibilityValues = await db
    .select({
      entityId: schema.FieldValue.entityId,
      optionId: schema.FieldValue.optionId,
      valueText: schema.FieldValue.valueText,
      valueJson: schema.FieldValue.valueJson,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        inArray(schema.FieldValue.entityId, instanceIds),
        eq(schema.CustomField.systemAttribute, VISIBILITY_ATTR)
      )
    )

  const sharedWithOrg = new Set<string>()
  for (const row of visibilityValues) {
    const value =
      normalizeSingleSelect(row.optionId) ??
      normalizeSingleSelect(row.valueText) ??
      normalizeSingleSelect(row.valueJson)
    if (value === VISIBILITY_ORG_MEMBERS) sharedWithOrg.add(row.entityId)
  }

  const candidates = instances.map((i) => ({
    ...i,
    ownerId: i.createdById ?? actorOwner.get(i.id) ?? null,
  }))

  // Verify against `User` before any FK-bearing write.
  const candidateOwnerIds = [...new Set(candidates.flatMap((c) => (c.ownerId ? [c.ownerId] : [])))]
  const realUsers = candidateOwnerIds.length
    ? await db
        .select({ id: schema.User.id })
        .from(schema.User)
        .where(inArray(schema.User.id, candidateOwnerIds))
    : []
  const realUserIds = new Set(realUsers.map((u) => u.id))

  return candidates.map((c) => ({
    organizationId: c.organizationId,
    instanceId: c.id,
    ownerId: c.ownerId && realUserIds.has(c.ownerId) ? c.ownerId : null,
    shareWithOrg: sharedWithOrg.has(c.id),
  }))
}

/**
 * Merge `signatures: Full` + `snippets: Full` onto every existing org's seeded
 * `member` `PermissionGrant` row (plan 36 §4.3).
 *
 * Without this, existing orgs compose both new areas to `None`: their Member
 * profile row was written by migration 052 before these areas existed, and
 * `ensureSystemProfiles` only seeds `levels` for a profile row it JUST inserted
 * ("never resurrect a baseline an admin cleared"). `Full` here buys the
 * instance-LESS action — create — and nothing more; every existing instance
 * still needs its own `ResourceAccess` row, which the two phases above write.
 *
 * Only `member`. `field_tech` is deliberately untouched: neither area is in
 * `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps both to `None` regardless
 * (plan 36 §0.5).
 *
 * Merge rule matches 052's — an existing explicit level always wins, so an admin
 * who has already narrowed either area keeps their choice on a re-run.
 */
async function backfillMemberBaseline(db: Database): Promise<void> {
  const baseline = systemProfileSeed('member')?.levels
  const newAreas: Area[] = [Area.signatures, Area.snippets]
  const additions = newAreas.reduce<Partial<Record<Area, Level>>>((acc, area) => {
    const level = baseline?.[area]
    // `Level.None` is 0 — an explicit `!== undefined` so a future seed that
    // deliberately closes one of these areas is still honoured, not truthiness.
    if (level !== undefined) acc[area] = level
    return acc
  }, {})

  if (Object.keys(additions).length === 0) {
    logger.warn('Member baseline seed has no signatures/snippets level — nothing to backfill')
    return
  }

  const profiles = await db
    .select({
      id: schema.PermissionProfile.id,
      organizationId: schema.PermissionProfile.organizationId,
    })
    .from(schema.PermissionProfile)
    .where(
      and(eq(schema.PermissionProfile.slug, 'member'), eq(schema.PermissionProfile.isSystem, true))
    )

  let updated = 0
  let missingGrant = 0

  for (const profile of profiles) {
    const [grant] = await db
      .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
      .from(schema.PermissionGrant)
      .where(
        and(
          eq(schema.PermissionGrant.organizationId, profile.organizationId),
          eq(schema.PermissionGrant.granteeType, 'profile'),
          eq(schema.PermissionGrant.granteeId, profile.id)
        )
      )
      .limit(1)

    if (!grant) {
      // Migration 052 writes this row for every org. A missing one means 052
      // never ran for this org — log and move on rather than halt the batch.
      logger.warn('Member permission grant missing for org, skipping baseline merge', {
        organizationId: profile.organizationId,
      })
      missingGrant += 1
      continue
    }

    const existing = parseAreaLevels(grant.levels)
    const merged = { ...additions, ...existing }
    if (newAreas.every((area) => merged[area] === existing[area])) continue

    await db
      .update(schema.PermissionGrant)
      .set({ levels: merged, updatedAt: new Date() })
      .where(eq(schema.PermissionGrant.id, grant.id))
    updated += 1

    // Same invalidation `grant-service.ts`'s `emitGrantChanged` performs for a
    // profile-grantee write: `hasPermissionGrants` (org) + `userCapabilities`
    // for every holder + dehydration + a realtime nudge.
    const audience = await resolveProfileAudience({
      organizationId: profile.organizationId,
      profileId: profile.id,
      slug: 'member',
      isSystem: true,
    })
    await fanOutCapabilityChange('permission-grant.changed', profile.organizationId, audience)
  }

  logger.info('Backfilled member baseline for signatures/snippets', {
    profiles: profiles.length,
    updated,
    missingGrant,
  })
}

/**
 * Convert the two legacy sharing vocabularies — `Snippet.sharingType` and the
 * `signature_visibility` FieldValue — into `ResourceAccess` rows, and open the
 * two new areas for existing orgs' members (plan 36 §4.1 + §4.3).
 *
 * Both resources are `baselineAtCreate: true`, so an instance with NO
 * `ResourceAccess` row is reachable by nobody but the org OWNER. This migration
 * is what stops that from being every pre-existing signature and snippet.
 *
 * Idempotent: rows are derived purely from current state; owner rows upsert to
 * `admin` (a fixed value, so a re-run is a no-op write) and the workspace
 * baseline rows use `onConflictDoNothing`, both against
 * `ResourceAccess_entity_grantee_key`. The baseline merge keeps any existing
 * explicit level. A second run changes nothing.
 */
export const migration056SignaturesSnippetsInstanceAccess: DataMigrationDef = {
  id: '056-signatures-snippets-instance-access',
  description:
    'Backfill signature/snippet owner + org-shared ResourceAccess rows and open the two new areas for existing members',
  async run(db: Database): Promise<void> {
    const snippetSeeds = await loadSnippetSeeds(db)
    const signatureSeeds = await loadSignatureSeeds(db)

    const snippetBuild = buildInstanceAccessRows(SNIPPET_KEY, snippetSeeds)
    const signatureBuild = buildInstanceAccessRows(SIGNATURE_KEY, signatureSeeds)

    for (const skipped of signatureBuild.skipped) {
      // Never a silent drop: a signature whose owner is unresolvable stays
      // unreachable by anyone but the org OWNER until someone re-shares it, and
      // the id is logged so that is a deliberate, findable outcome.
      logger.warn('Signature owner unresolvable — no ResourceAccess row written', {
        organizationId: skipped.organizationId,
        signatureId: skipped.instanceId,
      })
    }
    for (const skipped of snippetBuild.skipped) {
      logger.warn('Snippet owner unresolvable — no ResourceAccess row written', {
        organizationId: skipped.organizationId,
        snippetId: skipped.instanceId,
      })
    }

    const ownerRows = [...snippetBuild.ownerRows, ...signatureBuild.ownerRows]
    const orgRows = [...snippetBuild.orgRows, ...signatureBuild.orgRows]

    // RAISE, don't skip. A legacy `setSnippetSharing` GROUPS write could already
    // hold this exact unique key at `view`/`edit` FOR THE OWNER — `onConflictDoNothing`
    // would leave them unable to share or delete their own snippet, and §0.6
    // gives no admin override to fix it with. `admin` is the top of the ladder,
    // so this only ever raises.
    for (let i = 0; i < ownerRows.length; i += CHUNK) {
      await db
        .insert(schema.ResourceAccess)
        .values(ownerRows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [
            schema.ResourceAccess.organizationId,
            schema.ResourceAccess.entityDefinitionId,
            schema.ResourceAccess.entityInstanceId,
            schema.ResourceAccess.granteeType,
            schema.ResourceAccess.granteeId,
          ],
          set: { rung: 'admin', updatedAt: new Date() },
        })
    }

    // Never stomp an existing workspace-baseline row: anything already there is
    // at least `read`, so a write could only downgrade a deliberate grant.
    for (let i = 0; i < orgRows.length; i += CHUNK) {
      await db
        .insert(schema.ResourceAccess)
        .values(orgRows.slice(i, i + CHUNK))
        .onConflictDoNothing()
    }

    const rows = [...ownerRows, ...orgRows]

    // Bust `restrictedInstanceIds` (org) + `userCapabilities` (broadcast) for
    // every touched org — without this the backfilled rows stay invisible until
    // each org's caches naturally expire. Broadcast covers BOTH row families:
    // the workspace-baseline role grant fans out to everyone anyway.
    const affectedOrgIds = new Set(rows.map((r) => r.organizationId))
    // Emitted once per DEF, not once per org: this migration writes rows on two
    // instance-access resources, and the emitter's def id decides whether the
    // org-level `governingInstanceIds` key is recomputed. Both keys are blob-lane
    // so either would trigger it, but naming only one would make the call lie
    // about what it wrote.
    for (const orgId of affectedOrgIds) {
      for (const defKey of [SIGNATURE_KEY, SNIPPET_KEY]) {
        await emitResourceAccessInstanceChanged(
          orgId,
          [{ granteeType: ResourceGranteeType.role, granteeId: WORKSPACE_BASELINE_GRANTEE }],
          defKey
        )
      }
    }

    logger.info('Backfilled signature/snippet instance access', {
      snippets: snippetSeeds.length,
      signatures: signatureSeeds.length,
      rowsWritten: rows.length,
      signaturesSkipped: signatureBuild.skipped.length,
      snippetsSkipped: snippetBuild.skipped.length,
      orgsInvalidated: affectedOrgIds.size,
    })

    await backfillMemberBaseline(db)
  },
}
