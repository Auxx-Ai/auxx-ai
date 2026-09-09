// packages/lib/src/seed/entity-migrations/migrations/140-integrations-view.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { Area, type Level, parseAreaLevels } from '../../../permissions/capabilities/registry'
import {
  fanOutCapabilityChange,
  resolveProfileAudience,
  systemProfileSeed,
} from '../../../permissions/profiles'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:140')

/**
 * Migration 140: open `Area.integrations` at `Level.Read` on every existing
 * org's `member` baseline grant row, so the new `integrations.view` rung is
 * inert for members instead of taking a surface away from them.
 *
 * ## Why a backfill is needed at all
 *
 * `Area.integrations` gained a `Level.Read` rung on 2026-09-09
 * (`permissions/capabilities/registry.ts`). Before it, the area was `Full`-only
 * and the whole connection READ path had no key to gate on:
 * `connections.list` was a bare `protectedProcedure` and handed every member
 * `ownedByOrOrgScoped`, i.e. their own connections **plus every org-scoped
 * one**. Adding the rung is what lets that path be gated.
 *
 * `MEMBER_BASELINE_LEVELS` now carries `integrations: Read` to keep the rung
 * inert for the seeded Member profile — but that map is only the SEED for a
 * profile row `ensureSystemProfiles` inserts for the FIRST time. Every existing
 * org's `member` grant row was written before the rung existed and OMITS the
 * area, so it composes `integrations` to `None` and, the moment the gate ships,
 * every member on it loses:
 *
 * - the Settings -> Connections entry (menu `permissionKey`, and the command
 *   palette action derived from it),
 * - the org-scoped half of `connections.list` — including, and this is the part
 *   that bites, the workflow / agent / data-connector connection picker, which
 *   asks for `orgScopedOnly: true` and would compose EMPTY with no error.
 *
 * Same shape and same reason as migration 138 step 2 (`Area.tasks` /
 * `Area.calls`) and data migration 061 (`Area.inboxes`, plan 40 §7).
 *
 * ## What it deliberately does NOT do
 *
 * 🛑 **`field_tech` is not touched.** `Area.integrations` is absent from
 * `WORKER_AREAS`, so `SEAT_CEILINGS.worker` clamps it to `None` for a worker
 * seat regardless of what the profile says. Writing it onto the `field_tech`
 * grant would be a lie in the data — the same reasoning 138 gives for leaving
 * `field_tech` off `Area.calls`, and 061 for leaving it off `Area.inboxes`.
 *
 * 🛑 **Only `Level.Read`, never `Full`.** `Full` is `integrationsManage`:
 * install and uninstall apps, MCP servers, webhooks, chat signing keys, and
 * connect / rotate / delete org-scoped connections. That rung stays closed by
 * default, which is why the addition is read from the SEED (which says `Read`)
 * rather than hard-coded to a level here.
 *
 * 🛑 **No custom or non-`member` profile is touched.** A profile that omits
 * `integrations` composes `None` off `ROLE_DEFAULTS.USER` and is refused —
 * that is the lever this whole change exists to give an admin, and a migration
 * that widened it would hand the lever straight back. The `accountant` and
 * `bookkeeper` seeds omit the area on purpose: an outside CPA has no business
 * reading the workspace's connected accounts.
 *
 * ## Idempotence
 *
 * The merge is fill-gaps, plan 22 §3's rule: `{ ...additions, ...existing }`,
 * so an existing explicit level always wins and a second run writes nothing. An
 * admin who has already narrowed (or widened) `Area.integrations` on the
 * `member` row keeps their choice. Re-running against a single org is
 * `packages/lib/scripts/run-entity-migration.ts --id 140-integrations-view --org <id>`.
 *
 * `PermissionProfile` / `PermissionGrant` are not `EntityInstance`-backed, so
 * this creates no `EntityDefinition` and no `CustomField` and contributes no
 * counter to the result — same as 138, and for the same reason.
 */
export const migration140IntegrationsView: EntityMigration = {
  id: '140-integrations-view',
  description:
    "Opens Area.integrations at Level.Read on every existing org's member baseline grant, so " +
    'the new integrations.view rung is inert for members instead of emptying their connection ' +
    'picker and hiding Settings -> Connections. Leaves field_tech, custom profiles and the ' +
    'accountant/bookkeeper seeds untouched.',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    await backfillMemberIntegrationsBaseline(db, organizationId)

    return {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      alreadyUpToDate: false,
    }
  },
}

/** The one area this migration opens. */
const MEMBER_NEW_AREAS: Area[] = [Area.integrations]

/**
 * The addition to merge onto an existing grant row, read from the SEED rather
 * than hard-coded — so if the seeded level for these areas ever changes, the
 * backfill follows it instead of contradicting it.
 *
 * `Level.None` is **0**, so membership is decided by an explicit `!== undefined`
 * rather than truthiness: a seed that deliberately CLOSES one of these areas
 * must survive as "closed on purpose", not degrade into "never mentioned",
 * which composes differently. Same rule as 138's helper of the same name.
 */
export function integrationsBaselineAdditions(
  seed: Partial<Record<Area, Level>> | null | undefined,
  areas: Area[]
): Partial<Record<Area, Level>> {
  return areas.reduce<Partial<Record<Area, Level>>>((acc, area) => {
    const level = seed?.[area]
    if (level !== undefined) acc[area] = level
    return acc
  }, {})
}

/**
 * Plan 22 §3's merge rule: an existing explicit level always wins. The spread
 * order IS the rule — `{ ...additions, ...existing }` — so an admin's choice
 * survives and a second run is a no-op rather than a reset.
 */
export function mergeIntegrationsBaseline(
  additions: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>
): Partial<Record<Area, Level>> {
  return { ...additions, ...existing }
}

/** True when the merge left every added area exactly where it already was. */
export function isNoopIntegrationsMerge(
  merged: Partial<Record<Area, Level>>,
  existing: Partial<Record<Area, Level>>,
  areas: Area[]
): boolean {
  return areas.every((area) => merged[area] === existing[area])
}

/**
 * Merge `Area.integrations` onto this org's `member` grant row, filling it in
 * only if the stored row does not already mention it explicitly. Skips (warns,
 * does not throw) when the profile or its grant row is missing — that means the
 * org predates `ensureSystemProfiles` seeding the slug, which is not this
 * migration's job to repair.
 */
async function backfillMemberIntegrationsBaseline(
  db: Database,
  organizationId: string
): Promise<void> {
  const slug = 'member' as const
  const additions = integrationsBaselineAdditions(systemProfileSeed(slug)?.levels, MEMBER_NEW_AREAS)

  if (Object.keys(additions).length === 0) {
    // Not a throw: an empty seed means the registry decided the area ships
    // closed for this profile, and a migration must not out-vote the registry.
    logger.warn('member baseline seed carries no integrations level — nothing to backfill', {
      organizationId,
      areas: MEMBER_NEW_AREAS,
    })
    return
  }

  const [profile] = await db
    .select({ id: schema.PermissionProfile.id })
    .from(schema.PermissionProfile)
    .where(
      and(
        eq(schema.PermissionProfile.organizationId, organizationId),
        eq(schema.PermissionProfile.slug, slug),
        eq(schema.PermissionProfile.isSystem, true)
      )
    )
    .limit(1)

  if (!profile) {
    logger.warn('member permission profile missing for org, skipping baseline merge', {
      organizationId,
    })
    return
  }

  const [grant] = await db
    .select({ id: schema.PermissionGrant.id, levels: schema.PermissionGrant.levels })
    .from(schema.PermissionGrant)
    .where(
      and(
        eq(schema.PermissionGrant.organizationId, organizationId),
        eq(schema.PermissionGrant.granteeType, 'profile'),
        eq(schema.PermissionGrant.granteeId, profile.id)
      )
    )
    .limit(1)

  if (!grant) {
    logger.warn('member permission grant missing for org, skipping baseline merge', {
      organizationId,
    })
    return
  }

  const existing = parseAreaLevels(grant.levels)
  const merged = mergeIntegrationsBaseline(additions, existing)
  if (isNoopIntegrationsMerge(merged, existing, MEMBER_NEW_AREAS)) return

  await db
    .update(schema.PermissionGrant)
    .set({ levels: merged, updatedAt: new Date() })
    .where(eq(schema.PermissionGrant.id, grant.id))

  // Same invalidation `grant-service.ts`'s `emitGrantChanged` performs for a
  // profile-grantee write: `hasPermissionGrants` (org) + `userCapabilities` for
  // every holder + dehydration + a realtime nudge. Without it the holders keep
  // serving a capability blob with no `integrations.view` key until the ONE_DAY
  // TTL expires — an empty connection picker with no error to explain it.
  const audience = await resolveProfileAudience({
    organizationId,
    profileId: profile.id,
    slug,
    isSystem: true,
  })
  await fanOutCapabilityChange('permission-grant.changed', organizationId, audience)

  logger.info('Backfilled member baseline for integrations', { organizationId, additions })
}
