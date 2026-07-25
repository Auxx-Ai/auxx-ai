// packages/database/src/db/schema/permission-profile.ts

import { createId } from '@paralleldrive/cuid2'
import type { SeatType } from '../../enums'
import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'

/**
 * The four exact rungs an agent permission policy can express. Unlike the human
 * additive ladder (`Level` in `@auxx/lib`), `'none'` here is LOAD-BEARING — an
 * agent profile must be able to remove authority, not just add it. See
 * plans/permissions/v2/19-permission-profiles.md §0.5.
 */
export type AgentAccessLevel = 'none' | 'read' | 'read_write' | 'full'

/**
 * A total exact policy over one keyspace: an explicit `default` (so keys created
 * after publication have a deterministic posture) plus sparse `overrides`.
 *
 * `T` is left as bare `string` at the schema layer — the real keyspaces
 * (`AreaSlug`, entity `apiSlug`, resource id) are `@auxx/lib` concepts and
 * `@auxx/database` is tier 1. The lib layer re-declares the same structural
 * shape with narrowed key types and casts on read.
 */
export type ExactAgentPolicy<T extends string = string> = {
  default: AgentAccessLevel
  overrides: Partial<Record<T, AgentAccessLevel>>
}

/**
 * `PermissionProfile.agentPolicy` — the exact, SET-semantics policy an agent
 * profile carries across every leveled authorization domain the runtime can
 * enforce: coarse areas, entity definitions, and shareable resource instances.
 *
 * Deliberately structural (string-keyed) rather than importing lib's `Area` /
 * apiSlug types — same posture as `Agent.toolsets` / `AgentVersion.prompt`,
 * which stay generic jsonb because schema is tier 1 and cannot see lib. The
 * difference is that the *shape* is expressible here, so the column is
 * `$type<AgentPermissionPolicy>()` instead of `$type<Record<string, unknown>>()`
 * and only the key unions are widened.
 *
 * Never fed into the additive `PermissionGrant` / `ResourceAccess` reducers —
 * those skip `'none'`, which would silently drop the whole point of this map
 * (§2.3).
 */
export type AgentPermissionPolicy = {
  /** Exact rule per capability area slug. */
  areas: ExactAgentPolicy
  /** Exact rule per entity-definition `apiSlug` (slug, not CUID — §3). */
  definitions: ExactAgentPolicy
  /** Posture for resource types absent from {@link AgentPermissionPolicy.resources}. */
  resourceDefault: AgentAccessLevel
  /** Exact rule per resource type → per instance id. */
  resources: Partial<Record<string, ExactAgentPolicy>>
}

/**
 * PermissionProfile — a named, reusable capability shape bound to a principal.
 *
 * For a **human** it supplies the per-area **base** (one sparse
 * `PermissionGrant` row with `granteeType:'profile'`, `granteeId` = this id)
 * plus that same profile's intrinsic **ceiling**. There is deliberately no
 * second "ceiling profile" binding: one profile owns both halves (§0.14).
 * Composition is `profileLevels[a] ?? baseLevel ?? ROLE_DEFAULTS[role][a]`,
 * raised by groups/personal overrides, clamped by `ceiling.areas`, then clamped
 * last by the seat ceiling (§2.1).
 *
 * For an **agent draft** it instead carries {@link AgentPermissionPolicy} — exact
 * SET semantics, resolved into an immutable snapshot at publish time.
 *
 * `OWNER` / `ADMIN` / `USER` / field-seat / agent defaults ship as **per-org
 * system rows** (`isSystem: true`), seeded sparsely over `ROLE_DEFAULTS` so a
 * newly added capability area stays admin-accessible on deploy without a
 * backfill (§0.6/§0.7). A null binding on a principal resolves to the matching
 * system row in code (§1.3) — nothing is ever stamped.
 *
 * `seat`, `appliesTo`, `slug` and `isSystem` are IMMUTABLE after creation
 * (§0.18): editing `seat` under existing holders would leave them on a profile
 * whose declared class no longer matches their billed `seatType`.
 *
 * See plans/permissions/v2/19-permission-profiles.md §1.1.
 */
export const PermissionProfile = pgTable(
  'PermissionProfile',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Organization scope — profiles are per-org rows, including system ones (§0.27). */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /**
     * Stable per-org identifier. System rows use the reserved slugs
     * `'owner' | 'admin' | 'member' | 'field_tech' | 'agent' | 'chat_agent'`;
     * custom profiles get an authored slug. Also the future join key for
     * SCIM/IdP mapping and cross-org templates. IMMUTABLE.
     */
    slug: text().notNull(),

    name: text().notNull(),
    description: text(),

    /** Presentation only — `{ iconId, color }` for the profile list/header. */
    icon: jsonb().$type<{ iconId: string; color: string }>(),

    /**
     * The seat class this profile is authored for. DECLARED, never inferred from
     * content — inferring would create a billing cliff where adding one area
     * silently moves N members onto full seats (§0.17). Assignment only ever
     * offers matching-`seat` profiles, so it is never a billing event. IMMUTABLE.
     */
    seat: text().$type<SeatType>().default('full').notNull(),

    /** Which principal kind may bind this profile. IMMUTABLE. */
    appliesTo: text().$type<'member' | 'agent' | 'any'>().default('member').notNull(),

    /**
     * Human fallback level (a `Level` rung, `0..3`) for every area this profile's
     * grant row does not set. `Full` for owner/admin; `null` on the sparse
     * member/field-tech rows so unset areas fall through to `ROLE_DEFAULTS`
     * (§0.7). Agent profiles leave this null — their defaults live inside
     * `agentPolicy`.
     */
    baseLevel: integer(),

    /**
     * Human-only intrinsic cap, applied AFTER group/personal raising and BEFORE
     * the seat ceiling (§2.1). Shape:
     * `{ areas?: { [areaSlug]: Level }, defs?: { mode: 'only' | 'except', slugs: string[] } | null }`.
     * `defs` uses apiSlugs (resolved server-side) so a definition created later
     * inherits the mode's posture: `only` fails closed, `except` fails open
     * (§0.13). Generic jsonb here; lib narrows on read.
     */
    ceiling: jsonb().$type<Record<string, unknown>>(),

    /**
     * Agent-only exact policy — see {@link AgentPermissionPolicy}. Null for
     * human profiles.
     */
    agentPolicy: jsonb().$type<AgentPermissionPolicy>(),

    /**
     * Seeded template row. Never deletable (so a null binding always has
     * somewhere to resolve) and its `slug`/`seat`/`appliesTo` are locked.
     * IMMUTABLE.
     */
    isSystem: boolean().default(false).notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One profile per slug per org — also the lookup path for `systemProfileFor`.
    uniqueIndex('PermissionProfile_organizationId_slug_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.slug.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from PermissionProfile table */
export type PermissionProfileEntity = typeof PermissionProfile.$inferSelect

/** Type for inserting into PermissionProfile table */
export type PermissionProfileInsert = typeof PermissionProfile.$inferInsert
