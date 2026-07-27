// packages/lib/src/permissions/profiles/system-profiles.ts

import {
  type AgentKind,
  type Database,
  database,
  type PermissionGrantInsert,
  type PermissionProfileInsert,
  schema,
  type Transaction,
} from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { type Area, Level } from '../capabilities/registry'
import { FIELD_TECH_BASELINE_LEVELS, MEMBER_BASELINE_LEVELS } from '../capabilities/seat-policy'
import type {
  AgentAccessLevel,
  AgentPermissionPolicy,
  ProfileAppliesTo,
  SystemProfileSlug,
} from './types'

/** One seeded system-profile row (§5.1). */
interface SystemProfileSeed {
  slug: SystemProfileSlug
  name: string
  description: string
  icon: { iconId: string; color: string }
  seat: SeatType
  appliesTo: ProfileAppliesTo
  /** `null` = sparse over `ROLE_DEFAULTS`; unset areas fall through to code. */
  baseLevel: Level | null
  /**
   * The governance rank this profile confers on assignment (plan 21 §2.a).
   * Hidden from authoring (21 §2.0.1) — only these seeds carry non-`USER` ranks;
   * every custom profile is `USER`. Agent profiles ignore it, like `baseLevel`.
   */
  role: OrganizationRole
  agentPolicy: AgentPermissionPolicy | null
  /**
   * The profile's seeded baseline, written as a `PermissionGrant` row by
   * `ensureSystemProfiles` (plan 22 §2.2/§2.3) — `null` for the profiles that
   * don't need one (owner/admin lean on `baseLevel: Full`; the two agent
   * profiles use `agentPolicy` instead). With `ROLE_DEFAULTS.USER` now the
   * all-`None` floor, `member`/`field_tech` are the only seeds that carry one.
   */
  levels: Partial<Record<Area, Level>> | null
}

/** A total agent policy at one uniform level — the two agent seeds' shape. */
function uniformAgentPolicy(level: AgentAccessLevel): AgentPermissionPolicy {
  return {
    areas: { default: level, overrides: {} },
    definitions: { default: level, overrides: {} },
    resourceDefault: level,
    resources: {},
  }
}

/**
 * The six system profiles seeded into every org (§5.1). Plan 22 reverses doc
 * 19 §0.6's original *sparse-over-`ROLE_DEFAULTS`* rationale for the USER
 * rank: unset now means `None` (`ROLE_DEFAULTS.USER` is the all-`None` floor),
 * so a profile that stores nothing composes to nothing. `member` and
 * `field_tech` therefore carry their out-of-the-box access as an explicit
 * `levels` map — {@link MEMBER_BASELINE_LEVELS} / {@link
 * FIELD_TECH_BASELINE_LEVELS} — which `ensureSystemProfiles` writes as a
 * `PermissionGrant` row, but ONLY at the moment the profile row is first
 * created (never re-applied to a pre-existing row), so an admin who
 * deliberately cleared the Member baseline keeps it cleared through later
 * org top-ups. The map still lives in code, so the shipped default stays
 * PR-reviewable (the surviving half of doc 19 §0.6's argument) — it is
 * written as DATA instead of composed from `ROLE_DEFAULTS` at read time.
 *
 * `owner`/`admin` express "everything" as `baseLevel: Full` rather than an
 * all-Full grant row (`levels: null`) — which also keeps seeding clear of
 * `assertGrantableLevels`' admin-only rejection; `ROLE_DEFAULTS.ADMIN`/`.OWNER`
 * staying `ALL_FULL` means there is nothing to seed for them anyway. The two
 * agent profiles likewise seed `levels: null` — their authority lives in
 * `agentPolicy`, never the additive grant reducers.
 *
 * `field_tech`'s cap is `SEAT_CEILINGS`, not a `ceiling` on this row (§0.20) —
 * the seat ceiling is a billing invariant and must never become profile-driven.
 * No seed carries a `ceiling` at all, and none ever will: it has no authoring
 * surface (plan 20 §2.a.1) and `ensureSystemProfiles` writes `null`.
 */
export const SYSTEM_PROFILE_SEEDS: readonly SystemProfileSeed[] = [
  {
    slug: 'owner',
    name: 'Owner',
    description: 'Full, unrestricted access. Never limited by any permission profile.',
    icon: { iconId: 'crown', color: 'amber' },
    seat: 'full',
    appliesTo: 'member',
    role: 'OWNER',
    baseLevel: Level.Full,
    agentPolicy: null,
    levels: null,
  },
  {
    slug: 'admin',
    name: 'Administrator',
    description: 'Full access to every area, including org settings and billing.',
    icon: { iconId: 'shield', color: 'blue' },
    seat: 'full',
    appliesTo: 'member',
    role: 'ADMIN',
    baseLevel: Level.Full,
    agentPolicy: null,
    levels: null,
  },
  {
    slug: 'member',
    name: 'Member',
    description: 'The workspace baseline every teammate starts from.',
    icon: { iconId: 'user', color: 'indigo' },
    seat: 'full',
    appliesTo: 'member',
    role: 'USER',
    baseLevel: null,
    agentPolicy: null,
    levels: MEMBER_BASELINE_LEVELS,
  },
  {
    slug: 'field_tech',
    name: 'Field Tech',
    description: 'Field seat: assigned schedule, visit reports, and linked records only.',
    icon: { iconId: 'hard-hat', color: 'orange' },
    seat: 'worker',
    appliesTo: 'member',
    role: 'USER',
    baseLevel: null,
    agentPolicy: null,
    levels: FIELD_TECH_BASELINE_LEVELS,
  },
  {
    slug: 'agent',
    name: 'Internal Agent',
    description: 'Permissive default for internal agents. Full access to every domain.',
    icon: { iconId: 'bot', color: 'violet' },
    seat: 'full',
    appliesTo: 'agent',
    role: 'USER',
    baseLevel: null,
    agentPolicy: uniformAgentPolicy('full'),
    levels: null,
  },
  {
    slug: 'chat_agent',
    name: 'Chat Agent',
    description: 'Fail-closed default for customer-facing agents. No access until granted.',
    icon: { iconId: 'message-circle', color: 'emerald' },
    seat: 'full',
    appliesTo: 'agent',
    role: 'USER',
    baseLevel: null,
    agentPolicy: uniformAgentPolicy('none'),
    levels: null,
  },
]

const SYSTEM_SEED_BY_SLUG = new Map(SYSTEM_PROFILE_SEEDS.map((seed) => [seed.slug, seed]))

/** The seed definition for a system slug — the shape the runtime fallback mirrors. */
export function systemProfileSeed(slug: SystemProfileSlug): SystemProfileSeed | undefined {
  return SYSTEM_SEED_BY_SLUG.get(slug)
}

/**
 * Seed the six system permission profiles for an org — **idempotent**, so it is
 * safe to call from every org-creation and org-top-up path (§5.2).
 *
 * Conflicts on the `(organizationId, slug)` unique key are ignored, so an
 * existing org's edited system rows are never clobbered. For every profile
 * row that was actually a NEW insert (not a conflict-skipped pre-existing one)
 * and whose seed carries a non-null `levels` (plan 22 §2.2/§2.3 —
 * `member`/`field_tech`), also writes that map as the profile's
 * `PermissionGrant` row: a direct insert, on purpose — the seeding path does
 * not run `assertGrantableLevels` or the escalation guard, both of which exist
 * to police an ADMIN actor authoring a grant, not the system boot-strapping
 * its own baseline. Restricting this to freshly-inserted rows (via `.returning()`
 * on the conflict-ignoring insert, which Postgres populates ONLY with rows it
 * actually inserted) is what keeps a re-run of this function on an existing
 * org from resurrecting a Member baseline an admin deliberately cleared.
 *
 * Depends on nothing but the `Organization` row — in particular NOT on the
 * org's system user — so it can run inside the org-creation transaction.
 *
 * Deliberately NOT plan-gated: a Free org gets the Member/Field-Tech baseline
 * through system profiles it cannot edit, which is today's member-baseline
 * behavior (§0.26).
 *
 * @param organizationId - Org to seed.
 * @param db - Optional connection OR transaction. Pass the tx when calling from
 *   inside the org-creation transaction so an org cannot commit without profiles.
 *   The union (rather than a cast at each call site) keeps the transaction a
 *   compile-time guarantee — this function only ever calls `.insert()`, which both
 *   shapes support.
 */
export async function ensureSystemProfiles(
  organizationId: string,
  db: Database | Transaction = database
): Promise<void> {
  // `id` is intentionally omitted — the column's `$defaultFn(createId)` mints it.
  const values: PermissionProfileInsert[] = SYSTEM_PROFILE_SEEDS.map((seed) => ({
    organizationId,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    icon: seed.icon,
    seat: seed.seat,
    appliesTo: seed.appliesTo,
    role: seed.role,
    baseLevel: seed.baseLevel,
    ceiling: null,
    agentPolicy: seed.agentPolicy,
    isSystem: true,
  }))

  const insertedProfiles = await db
    .insert(schema.PermissionProfile)
    .values(values)
    .onConflictDoNothing({
      target: [schema.PermissionProfile.organizationId, schema.PermissionProfile.slug],
    })
    .returning({ id: schema.PermissionProfile.id, slug: schema.PermissionProfile.slug })

  // Postgres only returns the rows an `onConflictDoNothing` insert actually
  // inserted — a pre-existing profile is silently skipped and absent here — so
  // this is exactly "the system profiles that did not already exist for this
  // org", never a pre-existing (possibly admin-edited or baseline-cleared) row.
  const grantValues: PermissionGrantInsert[] = insertedProfiles.flatMap((profile) => {
    const levels = SYSTEM_SEED_BY_SLUG.get(profile.slug as SystemProfileSlug)?.levels
    if (!levels) return []
    return [{ organizationId, granteeType: 'profile' as const, granteeId: profile.id, levels }]
  })

  if (grantValues.length === 0) return

  // `id` is intentionally omitted — same `$defaultFn(createId)` as above.
  await db
    .insert(schema.PermissionGrant)
    .values(grantValues)
    .onConflictDoNothing({
      target: [
        schema.PermissionGrant.organizationId,
        schema.PermissionGrant.granteeType,
        schema.PermissionGrant.granteeId,
      ],
    })
}

/**
 * Which system profile a HUMAN principal with a null binding resolves to (§1.3).
 * Nothing is ever stamped onto the member row, so a system-profile edit
 * propagates to every null-bound holder immediately.
 *
 * ```
 * role === 'OWNER'      → owner
 * role === 'ADMIN'      → admin
 * seatType === 'worker' → field_tech
 * otherwise             → member
 * ```
 */
export function systemProfileFor(
  role: OrganizationRole,
  seatType: SeatType
): Extract<SystemProfileSlug, 'owner' | 'admin' | 'field_tech' | 'member'> {
  if (role === 'OWNER') return 'owner'
  if (role === 'ADMIN') return 'admin'
  if (seatType === 'worker') return 'field_tech'
  return 'member'
}

/**
 * Which system profile an AGENT DRAFT with a null `Agent.permissionProfileId`
 * resolves to (§1.3): `internal → agent`, `chat → chat_agent`. A published
 * `AgentVersion` never performs this fallback — it carries its own self-contained
 * policy snapshot.
 */
export function systemProfileForAgentKind(
  kind: AgentKind
): Extract<SystemProfileSlug, 'agent' | 'chat_agent'> {
  return kind === 'chat' ? 'chat_agent' : 'agent'
}
