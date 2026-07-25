// packages/lib/src/permissions/profiles/system-profiles.ts

import {
  type AgentKind,
  type Database,
  database,
  type PermissionProfileInsert,
  schema,
  type Transaction,
} from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Level } from '../capabilities/registry'
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
  agentPolicy: AgentPermissionPolicy | null
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
 * The six system profiles seeded into every org (§5.1). Deliberately **sparse
 * over `ROLE_DEFAULTS`** (§0.6): `member` and `field_tech` store nothing at all
 * (null `baseLevel`, no `PermissionGrant` row), so a newly added capability area
 * inherits its shipped code default on deploy instead of needing a backfill into
 * every org's every profile.
 *
 * `owner`/`admin` express "everything" as `baseLevel: Full` rather than an
 * all-Full grant row — which also keeps seeding clear of
 * `assertGrantableLevels`' admin-only rejection.
 *
 * `field_tech`'s cap is `SEAT_CEILINGS`, not a `ceiling` on this row (§0.20) —
 * the seat ceiling is a billing invariant and must never become profile-driven.
 */
export const SYSTEM_PROFILE_SEEDS: readonly SystemProfileSeed[] = [
  {
    slug: 'owner',
    name: 'Owner',
    description: 'Full, unrestricted access. Never limited by a profile ceiling.',
    icon: { iconId: 'crown', color: 'amber' },
    seat: 'full',
    appliesTo: 'member',
    baseLevel: Level.Full,
    agentPolicy: null,
  },
  {
    slug: 'admin',
    name: 'Administrator',
    description: 'Full access to every area, including org settings and billing.',
    icon: { iconId: 'shield', color: 'blue' },
    seat: 'full',
    appliesTo: 'member',
    baseLevel: Level.Full,
    agentPolicy: null,
  },
  {
    slug: 'member',
    name: 'Member',
    description: 'The workspace baseline every teammate starts from.',
    icon: { iconId: 'user', color: 'indigo' },
    seat: 'full',
    appliesTo: 'member',
    baseLevel: null,
    agentPolicy: null,
  },
  {
    slug: 'field_tech',
    name: 'Field Tech',
    description: 'Field seat — assigned schedule, visit reports, and linked records only.',
    icon: { iconId: 'hard-hat', color: 'orange' },
    seat: 'worker',
    appliesTo: 'member',
    baseLevel: null,
    agentPolicy: null,
  },
  {
    slug: 'agent',
    name: 'Internal Agent',
    description: 'Permissive default for internal agents — full access to every domain.',
    icon: { iconId: 'bot', color: 'violet' },
    seat: 'full',
    appliesTo: 'agent',
    baseLevel: null,
    agentPolicy: uniformAgentPolicy('full'),
  },
  {
    slug: 'chat_agent',
    name: 'Chat Agent',
    description: 'Fail-closed default for customer-facing agents — no access until granted.',
    icon: { iconId: 'message-circle', color: 'emerald' },
    seat: 'full',
    appliesTo: 'agent',
    baseLevel: null,
    agentPolicy: uniformAgentPolicy('none'),
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
 * existing org's edited system rows are never clobbered. Writes NO
 * `PermissionGrant` rows (see {@link SYSTEM_PROFILE_SEEDS}) and depends on
 * nothing but the `Organization` row — in particular NOT on the org's system
 * user — so it can run inside the org-creation transaction.
 *
 * Deliberately NOT plan-gated: a Free org gets `ROLE_DEFAULTS` through empty
 * system profiles it cannot edit, which is today's member-baseline behavior
 * (§0.26).
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
    baseLevel: seed.baseLevel,
    ceiling: null,
    agentPolicy: seed.agentPolicy,
    isSystem: true,
  }))

  await db
    .insert(schema.PermissionProfile)
    .values(values)
    .onConflictDoNothing({
      target: [schema.PermissionProfile.organizationId, schema.PermissionProfile.slug],
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
