// packages/database/src/db/schema/record-rule.ts
// Drizzle tables: RecordRule + RecordRuleRun — org-configurable record rules
// ("when field X changes / record created / deleted, and conditions hold, run actions").
// A rule with a fieldId listens on field transitions (dispatched from the '*'
// field-change hook seam); a rule with fieldId = null listens on record lifecycle
// (dispatched from the entity:created/entity:deleted bus events).
// See plans/events/dynamic-field-rules-and-sync-events-plan.md.

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
import { CustomField } from './custom-field'
import { EntityDefinition } from './entity-definition'
import { Organization } from './organization'
import { User } from './user'

/**
 * Transition selector — field transitions require a fieldId; lifecycle rules have
 * fieldId = null; the signal door (`on = 'signal'`) requires `signalKind` and has
 * fieldId = null (see `assertRuleShape`).
 */
export type RecordRuleOn =
  | 'changed'
  | 'increased'
  | 'decreased'
  | 'set'
  | 'cleared'
  | 'created'
  | 'deleted'
  | 'signal'

export const RecordRule = pgTable(
  'RecordRule',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    // The watched field. NULL ⇔ on ∈ ('created','deleted') — a record-lifecycle rule.
    // Cascade: the rule dies with its field.
    fieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    name: text().notNull(),
    // Transition selector. Direction semantics (increased/decreased/set/cleared) live HERE,
    // not in `condition` — the condition evaluator sees one record snapshot and cannot
    // express old→new comparisons.
    on: text().$type<RecordRuleOn>().default('changed').notNull(),
    // The watched signal kind, e.g. 'email:opened'. NULL unless `on = 'signal'` — the
    // signal-door counterpart to `fieldId` (invariant enforced in `assertRuleShape`).
    signalKind: text(),
    // Existing conditions system (`@auxx/lib/conditions` ConditionGroup[]). Groups are
    // AND'd; empty array = always match.
    condition: jsonb().$type<unknown[]>().default([]).notNull(),
    // Ordered action array (RecordRuleAction[] — typed in @auxx/lib/record-rules).
    // Failure semantics: continue-and-report; per-action outcomes land in RecordRuleRun.
    actions: jsonb().$type<unknown[]>().notNull(),
    // Managed rules are provisioned by a feature flow (e.g. inventory-source setup), not the
    // generic builder. They MAY carry `native` actions and are edit/delete-locked in the UI;
    // only `enabled` is user-toggleable. NULL = an ordinary user rule. A nullable text
    // discriminator (not a boolean) so a future managed feature knows WHICH feature owns the
    // row (e.g. to clean up). Extend the union as more managed features land.
    managed: text().$type<'inventory' | null>(),
    // Idempotency key for starter suggested rules (`seedSuggestedRecordRules`, decision 8).
    // NULL for ordinary user-authored rules. Unique per org when set (see index below).
    templateKey: text(),
    enabled: boolean().default(true).notNull(),
    createdByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Hot lookup: the field-change dispatch matches rules by watched field.
    index('RecordRule_organizationId_fieldId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.fieldId.asc().nullsLast()
    ),
    // Lifecycle dispatch matches rules by definition (fieldId is null there).
    index('RecordRule_organizationId_entityDefinitionId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast()
    ),
    // Suggested-rule seeding idempotency (decision 8): one row per (org, templateKey).
    // Partial — templateKey is null for the vast majority of (ordinary user) rules.
    uniqueIndex('RecordRule_organizationId_templateKey_idx')
      .using('btree', table.organizationId.asc().nullsLast(), table.templateKey.asc().nullsLast())
      .where(sql`"templateKey" IS NOT NULL`),
  ]
)

export const RecordRuleRun = pgTable(
  'RecordRuleRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    // Plain text on purpose (no FK): system rules (`system:<key>`) are code-declared,
    // not RecordRule rows, and their runs must be loggable too. Retention pruning
    // handles cleanup for deleted user rules.
    ruleId: text().notNull(),
    // Plain text on purpose (no FK): 'deleted' rules must log runs for records that no
    // longer exist.
    entityInstanceId: text().notNull(),
    // Which door dispatched the firing. 'sync' arrives with the B2 manifest consumer.
    source: text().$type<'interactive' | 'sync'>().default('interactive').notNull(),
    // Trigger context — null for lifecycle rules.
    fieldId: text(),
    oldValue: jsonb(),
    newValue: jsonb(),
    // Per-action outcomes ([{ actionIndex, type, status: 'ok'|'failed'|'skipped', error? }]).
    outcomes: jsonb().$type<unknown[]>().default([]).notNull(),
    status: text().$type<'ok' | 'partial' | 'failed'>().notNull(),
    firedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Run history per rule, newest first.
    index('RecordRuleRun_organizationId_ruleId_firedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.ruleId.asc().nullsLast(),
      table.firedAt.desc().nullsLast()
    ),
    // Retention pruning sweeps by age.
    index('RecordRuleRun_firedAt_idx').using('btree', table.firedAt.asc().nullsLast()),
  ]
)

/** Selected RecordRule entity type */
export type RecordRuleEntity = typeof RecordRule.$inferSelect
/** Selected RecordRuleRun entity type */
export type RecordRuleRunEntity = typeof RecordRuleRun.$inferSelect
