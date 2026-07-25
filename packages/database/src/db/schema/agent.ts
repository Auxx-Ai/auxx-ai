// packages/database/src/db/schema/agent.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'
import { PermissionProfile } from './permission-profile'
import { User } from './user'

/**
 * Which input locks a mention-sourced toolset/knowledge entry. A `tool:`/record
 * chip enables its target from the agent **prompt** or from any enabled attached
 * **procedure** doc; the two reconcile independently so the hot prompt-autosave
 * path never reads procedures. See plans/evals/procedure-mention-toolset-reconciliation-plan.md.
 */
export type MentionSource = 'prompt' | 'procedure'

/**
 * One mention lock on a {@link ToolsetEntry}. `target: '*'` locks the whole
 * toolset (explicit bundles, `toolset:<slug>` chips); a registered tool name
 * locks just that tool (implicit toolsets). Written by the prompt/procedure
 * reconcilers; replaced per-`source` on every reconcile pass. See
 * plans/mcp/v4/tool-first-catalog.md Phase 3.
 */
export interface ToolsetMention {
  target: string
  source: MentionSource
}

/**
 * One entry inside `Agent.toolsets`. Replaces the old `AgentToolset` join
 * table. See plans/kopilot/agents/ui/single-row-agent.md §1.
 */
export interface ToolsetEntry {
  slug: string
  /** Optional AppInstallation id for app toolsets. Null/absent for native toolsets. */
  appInstallationId?: string | null
  /**
   * Toolset-shaped overrides — `{ enabledTools?: string[] }` (per-tool
   * allow-list, implicit toolsets only) plus the reconciler-private
   * `mentionOverrides` pre-image (`{ enabledWas?: false, addedNames?: string[] }`):
   * what mention passes overrode on this entry, applied back when the mentions
   * covering a target empty. Never read outside the reconcilers.
   */
  config: Record<string, unknown>
  enabled: boolean
  /**
   * Pure creation provenance — how this entry came to exist. The reconcilers
   * never mutate it; lock state lives in {@link ToolsetEntry.mentions}.
   */
  source: 'manual' | 'mention' | 'auto_default'
  /**
   * Mention locks on this entry. Non-empty ⇒ the row is forced `enabled: true`
   * and the locked targets are frozen in the UI. Replaced per-source by the
   * matching reconciler. Replaces the old `mentionedBy` tag list.
   */
  mentions?: ToolsetMention[]
}

/**
 * One entry inside `Agent.knowledge`. Replaces the old `AgentResourceScope`
 * table.
 *
 * `recordId` is `${entityDefinitionId}:${entityInstanceId}` for instance-level
 * rules, or just `${entityDefinitionId}` (no colon) for definition-level rules
 * ("every record under this definition"). See plans/kopilot/agents/ui/single-row-agent.md §1.
 */
export interface KnowledgeEntry {
  recordId: string
  mode: 'include_descendants' | 'include_one' | 'exclude'
  source: 'manual' | 'mention'
  /**
   * When `source === 'mention'`, the inputs that lock this record (prompt and/or
   * an enabled attached procedure doc). Same semantics as
   * {@link ToolsetEntry.mentionedBy}. Absent on manual rows.
   */
  mentionedBy?: MentionSource[]
}

/**
 * One entry inside `Agent.appAccounts`. Pins the agent's execution to a
 * specific `Credential.id` (workspace or personal — doesn't
 * matter; the resolver doesn't branch). Keyed by app id (slug). See
 * plans/kopilot/apps/agent-credentials.md §2.
 */
export interface AppAccountBinding {
  credId: string
}

/**
 * Source of a platform-resolved tool-input binding (plans/chat/v8 phase-2).
 *
 * Structural mirror of `@auxx/types/field`'s `VarSource` — duplicated here
 * (rather than imported) to keep the dependency direction clean: schema is
 * tier-1 and `@auxx/types` is not a dependency. The runtime narrows `ref` to a
 * `VarRef` (`ResourceFieldId | FieldPath`).
 */
export type AgentVarSource =
  | { kind: 'var'; ref: string | string[] }
  | { kind: 'const'; value: unknown }
  | { kind: 'model' }

/**
 * `Agent.toolRestrictions` shape — the thin per-agent **override** map (tool
 * registered-name → input name → {@link AgentVarSource}). Stores only
 * deliberate admin overrides; the common case is empty because each tool ships
 * its own author-default `inputBindings`. Effective binding = override ??
 * author-default, resolved per turn. See plans/chat/v8 phase-4/phase-5.
 *
 * (The column name is retained from v6; its contents are the v8 binding map.)
 */
export type AgentToolBindings = Record<string, Record<string, AgentVarSource>>

/**
 * Optional identity/presentation bag stored on the Agent row itself.
 *
 * During draft (`Agent.userId IS NULL`) this is the **only** source of these
 * fields — no backing User exists yet to hold them. After
 * `completeAgentSetup` runs, User-owned fields (`name`, `avatarAssetId`)
 * are mirrored onto the synthetic User row and the User value wins on
 * read; non-User-owned fields (`color`, `iconId`) keep `config` as their
 * canonical home.
 *
 * Read priority for User-owned fields: `User.<field> ?? Agent.config.<field> ?? null`.
 *
 * See plans/kopilot/agents/dm/option-d-defer-user-plan.md §3.
 */
export interface AgentConfig {
  name?: string
  avatarAssetId?: string
  color?: string
  iconId?: string
}

/**
 * Discriminates an agent's invocation surface. `'internal'` agents run from
 * Kopilot / triggers / autonomous runs (admin-facing). `'chat'` agents are
 * visitor-facing: they run on inbound chat messages, get a filtered
 * (chat-safe) toolset, and carry a `Subject` (anchors + identityVerified) on
 * every tool call. Chosen at creation and immutable thereafter. See
 * plans/chat/v5, plans/chat/v8.
 */
export type AgentKind = 'internal' | 'chat'

/**
 * A user-authored Kopilot agent. Backed by a synthetic User row
 * (userType = 'AGENT'). Optional configuration layer on top of the
 * master Kopilot runtime.
 */
export const Agent = pgTable(
  'Agent',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /**
     * The synthetic User row backing this agent. 1:1 when set.
     *
     * `null` while the agent is mid-build (no User row exists yet). The User
     * is materialized inside `completeAgentSetup`. See
     * plans/kopilot/agents/dm/option-d-defer-user-plan.md §1.
     */
    userId: text()
      .unique()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** The human who created the agent. */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),

    /**
     * Optional **run-as delegation**: when set, every run of this agent resolves
     * its `CapabilitySet` from THIS user instead of the agent's own permission
     * profile ("acts exactly as this user"). See
     * plans/permissions/v2/14-agent-permissions.md §0.6/§4.3.
     *
     * It changes the **capability source only** — the engine identity
     * (`AiAgentSession.userId`, authorship, realtime attribution) stays the
     * agent's own `userId`, so audit trails remain honest. Invoker intersection
     * for human-triggered runs (§0.5) still applies on top.
     *
     * Must be an ACTIVE human member at run time; if it is not, the run fails
     * loudly rather than falling back to the agent profile (a silently-widened
     * agent is worse than a stopped one). `onDelete: 'set null'` so deleting the
     * user cleanly unsets the delegation and the run-time assert then surfaces
     * it. `null` (the default) = use the agent's own profile.
     */
    runAsUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /**
     * The **draft** permission-profile selection (§0.16). Draft agents have no
     * `User` and no `OrganizationMember`, so this row is the only authoring
     * target from creation onward; the synthetic member (once materialized)
     * carries membership/role/seat only and never a profile binding.
     *
     * Production does NOT read this column: publish resolves it into an
     * immutable snapshot on `AgentVersion`, so editing/reassigning a draft
     * profile changes draft Chat and draft evals only. `null` resolves by kind
     * (`internal → agent`, `chat → chat_agent`). `onDelete: 'set null'` so
     * deleting a profile drops bound drafts back onto that kind default while
     * already-published snapshots stay byte-identical (§0.24).
     *
     * See plans/permissions/v2/19-permission-profiles.md §1.1/§1.3.
     */
    permissionProfileId: text().references((): AnyPgColumn => PermissionProfile.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    slug: text().notNull(),
    description: text(),

    /**
     * Invocation-surface discriminator — see `AgentKind`. Defaults to
     * `'internal'` so every existing agent backfills to internal and the
     * chat runtime stays dormant until phase 3. Immutable after creation
     * (enforced by `updateAgent`).
     */
    kind: text().$type<AgentKind>().notNull().default('internal'),

    prompt: jsonb().$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * Per-agent toolset configuration. One entry per slug enabled on the
     * agent. Replaces the old `AgentToolset` join table. See
     * plans/kopilot/agents/ui/single-row-agent.md.
     */
    toolsets: jsonb().$type<ToolsetEntry[]>().default(sql`'[]'::jsonb`).notNull(),

    /**
     * Per-agent knowledge access rules. One entry per `recordId`. Replaces
     * the old `AgentResourceScope` table. See
     * plans/kopilot/agents/ui/single-row-agent.md.
     */
    knowledge: jsonb().$type<KnowledgeEntry[]>().default(sql`'[]'::jsonb`).notNull(),

    /**
     * Per-agent app account bindings. One entry per app id (slug). Each
     * entry pins the agent's execution to a specific Credential
     * row (workspace or personal). See
     * plans/kopilot/apps/agent-credentials.md §2.
     */
    appAccounts: jsonb()
      .$type<Record<string, AppAccountBinding>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),

    /**
     * Per-agent tool-binding **override** map — tool registered-name → input →
     * {@link AgentVarSource}. The engine resolves `override ?? author-default`
     * per turn and clamps it onto the args before the tool runs. Usually empty
     * (author defaults cover the common case); empty for master Kopilot. Column
     * name retained from v6; contents are the v8 binding map. See plans/chat/v8.
     */
    toolRestrictions: jsonb().$type<AgentToolBindings>().default(sql`'{}'::jsonb`).notNull(),

    mentionable: boolean().default(true).notNull(),

    modelId: text(),

    /**
     * Pointer into {@link AgentVersion} — the published config production runs.
     * Nullable with NO DB-level FK (same circularity rationale as
     * `Procedure.activeVersionId`); `null` = never published (pre-setup draft).
     * The Agent row itself is the draft working copy — there is deliberately no
     * `draftVersionId` (see plans/agents/agent-versions/build-plan.md, the
     * convention rule). `completeAgentSetup` publishes v1, so every set-up agent
     * always has an active version.
     */
    activeVersionId: text(),

    /**
     * True when the draft (this row's behavior fields) has diverged from the
     * active {@link AgentVersion}. Set by user-facing behavior mutations
     * (prompt/toolsets/knowledge/appAccounts/toolRestrictions/modelId);
     * identity/lifecycle edits and the mention reconciler never set it.
     * Cleared on publish/discard. Only meaningful while `activeVersionId` is set.
     */
    hasUnpublishedChanges: boolean().notNull().default(false),

    /**
     * Optional identity/presentation bag — see `AgentConfig` above. Holds
     * fields that don't live on User (`color`, `iconId`) plus pre-setup
     * values for fields that eventually move to User (`name`,
     * `avatarAssetId`). Readers fall back to `config` when User is null
     * (draft) or doesn't own the field.
     */
    config: jsonb().$type<AgentConfig | null>(),

    /**
     * `null` while the agent is mid-build via the chat-driven setup flow;
     * timestamp when the builder fires `complete_agent_setup` (or the admin
     * clicks the rail escape hatch). The rail UI swaps the setup carousel for
     * the Prompt/Tools/Knowledge tabs when this flips.
     */
    setupCompletedAt: timestamp({ precision: 3 }),

    archivedAt: timestamp({ precision: 3 }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('Agent_organizationId_slug_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.slug.asc().nullsLast()
    ),
    index('Agent_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Agent_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
    index('Agent_organizationId_archivedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.archivedAt.asc().nullsLast()
    ),
    index('Agent_userId_idx').using('btree', table.userId.asc().nullsLast()),
    index('Agent_runAsUserId_idx').using('btree', table.runAsUserId.asc().nullsLast()),
    // Backs the profile-edit draft-dirty fan-out and the profile-delete holder
    // sweep (§8.3/§0.24) — Postgres does not auto-index FK columns.
    index('Agent_organizationId_permissionProfileId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.permissionProfileId.asc().nullsLast()
    ),
  ]
)

export type AgentEntity = typeof Agent.$inferSelect
export type AgentInsert = typeof Agent.$inferInsert
