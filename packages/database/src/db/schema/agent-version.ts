// packages/database/src/db/schema/agent-version.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Agent } from './agent'
import { Organization } from './organization'
import type { AgentAccessLevel, ExactAgentPolicy } from './permission-profile'
import { User } from './user'

/**
 * One authority reduction the publish-time author clamp applied (plan 19 §2.4a) —
 * `min(resolvedProfilePolicy, publisherEffectiveCapabilities)`. Recorded on the
 * snapshot so an audit can answer *"who authorized this authority, and what did
 * we refuse them"*, and so the publish UI can say **"Deals reduced from Full to
 * Read — you hold Read"** instead of silently downgrading.
 */
export type AgentPolicyClampEntry = {
  /** Which keyspace was reduced. */
  domain: 'area' | 'definition' | 'resource'
  /**
   * The reduced key: an area slug, an entity `apiSlug`, `'<resourceType>'` for a
   * resource-type default, or `'<resourceType>:<instanceId>'` for one instance.
   * `null` = the keyspace's own `default` rung.
   */
  key: string | null
  /** The rung the profile asked for. */
  from: AgentAccessLevel
  /** The rung the publisher's own authority permitted. */
  to: AgentAccessLevel
}

/**
 * `AgentVersion.permissionPolicy` — the **immutable, self-contained**
 * authorization envelope a published agent version runs under (plan 19 §2.3).
 *
 * Resolved at publish from the draft `Agent.permissionProfileId` and then clamped
 * by the publishing human's own effective capabilities (§2.4a). Production never
 * resolves through the mutable profile at run time, so editing or deleting the
 * source profile cannot change a running agent — only publishing or restoring a
 * version can.
 *
 * **Totality.** Every keyspace carries an explicit `default`, because entity
 * definitions and shareable resources may be created *after* publication. There
 * is therefore no run-time `inherit`: a lookup always returns exactly one of
 * `none | read | read_write | full`. `overrides` stay sparse — the `default` is
 * the answer for any key they do not name.
 *
 * Structural/`string`-keyed for the same reason {@link AgentPermissionPolicy} is:
 * the real keyspaces (area slug, entity `apiSlug`, resource id) are `@auxx/lib`
 * concepts and `@auxx/database` is tier 1. Lib narrows on read.
 */
export type PublishedAgentPermissionPolicy = {
  /** Audit metadata only — deliberately NOT an FK, so profile deletion is safe. */
  sourceProfileId: string | null
  /** The source profile's `updatedAt` at publish time, ISO-8601. */
  sourceProfileUpdatedAt: string | null
  /** The human whose authority bounded this snapshot (§2.4a). `null` = system publish. */
  publishedByUserId: string | null
  /** Every reduction the author clamp applied; `[]` when the publisher held everything. */
  clamp: AgentPolicyClampEntry[]
  /** Exact rule per capability area slug. */
  areas: ExactAgentPolicy
  /** Exact rule per entity-definition `apiSlug` (slug, not CUID — §3). */
  definitions: ExactAgentPolicy
  /** Posture for resource types absent from {@link PublishedAgentPermissionPolicy.resources}. */
  resourceDefault: AgentAccessLevel
  /** Exact rule per resource type → per instance id. */
  resources: Partial<Record<string, ExactAgentPolicy>>
}

/**
 * An immutable, numbered snapshot of an {@link Agent}'s behavior config **and its
 * authorization envelope** — the agent analogue of {@link ProcedureVersion},
 * minus the draft row. The Agent row itself IS the draft working copy (autosave,
 * toolset/scope/bindings services, and Kopilot builder tools all write it live);
 * publishing snapshots the row's behavior fields here, resolves the draft
 * permission profile into {@link permissionPolicy}, and repoints
 * `Agent.activeVersionId`. Production runtime / cache / pinned eval runs read the
 * active version; the builder Chat tab and draft eval runs read the live Agent
 * row and its live profile binding.
 *
 * Every row is published, so `versionNumber` is `NOT NULL` (no partial unique
 * index, unlike `ProcedureVersion` which carries a null-numbered draft).
 *
 * **Versioned scope:** the six behavior fields — `prompt`, `toolsets`,
 * `knowledge`, `appAccounts`, `toolRestrictions`, `modelId` — plus
 * `permissionPolicy`, the resolved authorization snapshot (plan 19 §2.3). The
 * behavior fields say what the agent *does*; `permissionPolicy` says what it is
 * *allowed* to do, and both are required: a tool without permission is denied,
 * and permission without a tool does nothing (§2.4). Identity
 * (`name`/`slug`/`description`/`config`), lifecycle, the draft
 * `Agent.permissionProfileId` binding, `AgentProcedure` links, and `AgentTrigger`
 * rows are deliberately NOT versioned — see
 * plans/agents/agent-versions/build-plan.md §"Decisions" and plan 19 §0.3.
 *
 * **Two documented immutability exceptions** (writes to an already-published
 * row): (1) `reconcileAgentProcedureMentions` amends the derived
 * (`source: 'mention'`) `toolsets`/`knowledge` entries on the active version in
 * place when an attached procedure's mentions change — never authored config —
 * and recomputes `configHash` so the no-op-republish check stays honest;
 * (2) `label` is annotation metadata (not behavior) and is editable via
 * `agent.renameVersion`. Both are confined and intentional.
 *
 * The behavior columns are mirrored (not a single config jsonb) so the cache
 * projection selects them directly and the mention amendment targets one column.
 * They stay GENERIC jsonb because `@auxx/database` can't see lib's
 * `ToolsetEntry`/`KnowledgeEntry`/`AppAccountBinding` types; the lib layer casts
 * on read — same posture as `ProcedureVersion.compiled`.
 *
 * See plans/agents/agent-versions/build-plan.md §1.
 */
export const AgentVersion = pgTable(
  'AgentVersion',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    agentId: text()
      .notNull()
      .references((): AnyPgColumn => Agent.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    versionNumber: integer().notNull(),
    label: text(),

    // Behavior snapshot — mirrored columns (see table JSDoc).
    prompt: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    toolsets: jsonb().$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
    knowledge: jsonb().$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
    appAccounts: jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    toolRestrictions: jsonb().$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    modelId: text(),

    /**
     * The resolved, self-contained authorization envelope for this version — see
     * {@link PublishedAgentPermissionPolicy}. `NOT NULL`: an agent version with
     * no policy would have to fail either open (an escalation) or closed (a dead
     * agent), and neither is an acceptable default.
     *
     * Unlike the behavior columns this one IS shaped (`$type` carries the real
     * structure) because the shape is expressible without lib's types; only the
     * key unions are widened to `string`.
     */
    permissionPolicy: jsonb().$type<PublishedAgentPermissionPolicy>().notNull(),

    /**
     * sha256 of the stable-stringified behavior snapshot **plus the
     * authorization-only projection of {@link permissionPolicy}** (areas /
     * definitions / resource rules). The audit metadata inside the policy
     * (`publishedByUserId`, `sourceProfileUpdatedAt`, `clamp`) is deliberately
     * EXCLUDED, so re-publishing identical authority by a different human stays a
     * no-op instead of minting a version that differs only by byline.
     */
    configHash: text().notNull(),

    editorId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AgentVersion_agentId_idx').on(table.agentId),
    uniqueIndex('AgentVersion_agentId_versionNumber_key').on(table.agentId, table.versionNumber),
  ]
)

export type AgentVersionEntity = typeof AgentVersion.$inferSelect
export type AgentVersionInsert = typeof AgentVersion.$inferInsert

// NOTE: do NOT export runtime VALUES from a schema file. Every schema module is
// `export *`'d into `@auxx/database`'s `schema` namespace, and several call sites
// index that namespace dynamically (`schema[tableKey]`), so a non-table export
// widens their index type and breaks them. The all-`full` legacy policy literal
// this migration needs therefore lives in
// `@auxx/lib/permissions/profiles/agent-policy` (`legacyFullAgentPolicy`), not here.
