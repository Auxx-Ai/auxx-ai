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
import { User } from './user'

/**
 * An immutable, numbered snapshot of an {@link Agent}'s behavior config — the
 * agent analogue of {@link ProcedureVersion}, minus the draft row. The Agent row
 * itself IS the draft working copy (autosave, toolset/scope/bindings services,
 * and Kopilot builder tools all write it live); publishing snapshots the row's
 * six behavior fields here and repoints `Agent.activeVersionId`. Production
 * runtime / cache / pinned eval runs read the active version; the builder Chat
 * tab and draft eval runs read the live Agent row.
 *
 * Every row is published, so `versionNumber` is `NOT NULL` (no partial unique
 * index, unlike `ProcedureVersion` which carries a null-numbered draft).
 *
 * **Versioned scope:** `prompt`, `toolsets`, `knowledge`, `appAccounts`,
 * `toolRestrictions`, `modelId`. Identity (`name`/`slug`/`description`/`config`),
 * lifecycle, `AgentProcedure` links, and `AgentTrigger` rows are deliberately
 * NOT versioned — see plans/agents/agent-versions/build-plan.md §"Decisions".
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

    /** sha256 of the stable-stringified six-field behavior snapshot. */
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
