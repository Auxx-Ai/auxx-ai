// packages/database/src/db/schema/sequence.ts
// Drizzle tables for the Sequences feature (outbound email cadences).
// Hand-written — see plans/sequences/plan.md §3.4. Not part of the original
// split-schema.ts generation.

import { createId } from '@paralleldrive/cuid2'
import { textCollateC } from './_collations'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  sequenceExitReason,
  sequenceRunStatus,
  sequenceStatus,
  sequenceSuppressionReason,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Integration } from './integration'
import { Organization } from './organization'
import { Thread } from './thread'
import { User } from './user'
import { WorkflowApp } from './workflow-app'
import { WorkflowRun } from './workflow-run'

/**
 * Auto-enrollment trigger for a sequence. Colon `noun:verb` form is the canonical
 * event-catalog naming (plans/events/00-event-catalog-review.md §5); these five are the seed
 * of that future catalog (plans/dispatch/19-client-notifications.md §4.3). Deliberately a
 * plain string union over `text()`, not a pgEnum — new triggers must be addable without a
 * migration (locked decision, plans/dispatch/19-client-notifications.md §4.1).
 */
export type SequenceTriggerType =
  | 'manual'
  | 'visit:scheduled'
  | 'visit:en_route'
  | 'visit:completed'
  | 'work_order:completed'
  | 'invoice:sent'

/**
 * A draft or published outbound email cadence. Compiles to a hidden,
 * system-owned `WorkflowApp` (marked via `ownerType`/`ownerId`, see
 * `workflow-app.ts`) that the workflow engine executes per-enrollment.
 */
export const Sequence = pgTable(
  'Sequence',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    status: sequenceStatus().default('draft').notNull(),
    /** Hidden system-owned workflow app that executes this sequence's steps (1:1). */
    workflowAppId: text()
      .notNull()
      .references((): AnyPgColumn => WorkflowApp.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /**
     * Pinned sending mailbox for every step (§6 — sender is fixed per sequence).
     * Nullable while drafting; `publishSequence` requires it before anything sends.
     */
    integrationId: text().references((): AnyPgColumn => Integration.id, {
      onUpdate: 'cascade',
      onDelete: 'restrict',
    }),
    /**
     * Optional pinned signature. `SignatureIntegrationShare` — the per-channel
     * gate this used to name — was dropped by plan 36 §7.4 (dead code since its
     * only writer was stubbed out). Pinning an id is now gated at the request
     * edge on per-instance `view` (`sequence.update`); sequence EXECUTION stays
     * uncapped, since it runs as the system and reads no member capabilities.
     */
    signatureEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** Delivery window start, `HH:MM` (24h, local to `deliveryTimezone`). */
    deliveryStartTime: text(),
    /** Delivery window end, `HH:MM`. */
    deliveryEndTime: text(),
    /** IANA timezone, e.g. `America/New_York`. */
    deliveryTimezone: text(),
    deliveryBusinessDaysOnly: boolean().default(false).notNull(),
    publishedAt: timestamp({ precision: 3 }),
    /** Set on any draft edit after publish; cleared on republish. */
    hasUnpublishedChanges: boolean().default(false).notNull(),
    /**
     * Auto-enrollment trigger (plans/dispatch/19-client-notifications.md §4.1/§4.3).
     * `'manual'` = Recipients-tab/contact-detail/bulk enrollment only (today's only mode).
     */
    triggerType: text().$type<SequenceTriggerType>().default('manual').notNull(),
    /** Derived from `triggerType`, stored for the enroll/exit code paths. */
    subjectKind: text(),
    /** Reply-detection hook exits the run only when this is true (per-sequence toggle). */
    exitOnReply: boolean().default(true).notNull(),
    /** Org-wide unsubscribe suppression check; seeded transactional sequences set false. */
    respectSuppression: boolean().default(true).notNull(),
    /** Unsubscribe footer on every send; seeded transactional sequences set false. */
    includeUnsubscribeFooter: boolean().default(true).notNull(),
    /** Seed idempotency + code lookup key, e.g. `visit_reminders`. Unique per org. */
    templateKey: text(),
    /**
     * `ConditionGroup[]` (`@auxx/lib/conditions` — `conditionGroupsSchema`), evaluated at
     * enroll only. Null = enroll everything. Typed `unknown[]` at the schema layer (packages
     * lower than `lib` can't import its types) — the lib layer casts.
     */
    enrollmentFilter: jsonb().$type<unknown[]>(),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Sequence_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Sequence_organizationId_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    // Trigger-lookup path (§4.3): find enabled event-sequences for a given org+trigger.
    index('Sequence_organizationId_triggerType_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.triggerType.asc().nullsLast()
    ),
    uniqueIndex('Sequence_workflowAppId_key').using('btree', table.workflowAppId.asc().nullsLast()),
    // Seed idempotency + code lookup (§4.1).
    uniqueIndex('Sequence_organizationId_templateKey_key')
      .using('btree', table.organizationId.asc().nullsLast(), table.templateKey.asc().nullsLast())
      .where(sql`${table.templateKey} IS NOT NULL`),
  ]
)

/**
 * Draft source of truth for a sequence's steps — publish compiles these rows
 * into the hidden `Workflow.graph`. Step 1 always opens a new thread (subject
 * set); steps 2..N reply into it.
 */
export const SequenceStep = pgTable(
  'SequenceStep',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    sequenceId: text()
      .notNull()
      .references((): AnyPgColumn => Sequence.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Fractional sort key (`generateKeyBetween` from `@auxx/utils`) — needs C collation. */
    sortOrder: textCollateC().notNull().default('a0'),
    /** Wait BEFORE this step; step 1 is always 0/0. */
    delayDays: integer().default(0).notNull(),
    delayHours: integer().default(0).notNull(),
    /**
     * `'relative'` = existing delayDays/delayHours-from-enrollment semantics.
     * `'anchor'` = signed offset from the subject's anchor date (§4.2), e.g. `startTime - 2d`.
     */
    timingMode: text().default('relative').notNull(),
    /** Signed day offset from the subject anchor date; only read when `timingMode='anchor'`. */
    anchorOffsetDays: integer().default(0).notNull(),
    /** `'HH:MM'` in the sequence's `deliveryTimezone`; only read when `timingMode='anchor'`. */
    anchorTimeOfDay: text(),
    /** Send channel for this step. Email-only in v1; reserved for SMS. */
    channel: text().default('email').notNull(),
    /** Used when this step opens the thread (step 1). */
    subject: text(),
    /** Canonical TipTap document JSON — placeholder nodes resolve structurally at send time. */
    bodyJson: jsonb().$type<Record<string, unknown>>(),
    /** @deprecated Legacy editor projection. Sequence publication and sends never read this column. */
    bodyHtml: text(),
    attachmentIds: jsonb().$type<string[]>().default([]),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('SequenceStep_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('SequenceStep_sequenceId_sortOrder_idx').using(
      'btree',
      table.sequenceId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast()
    ),
  ]
)

/**
 * One row per enrollment — 1:1 with a `WorkflowRun`. Recipient email is
 * frozen at enrollment time; a linear run exits at most once (`exitReason`/
 * `exitMetadata` fold the separate interruption table from questions.md §22).
 */
export const SequenceRun = pgTable(
  'SequenceRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    sequenceId: text()
      .notNull()
      .references((): AnyPgColumn => Sequence.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workflowRunId: text()
      .notNull()
      .references((): AnyPgColumn => WorkflowRun.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Contact this run is enrolled for. Nullable so a deleted contact doesn't erase run history. */
    recipientEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** Frozen at enrollment (§3) — survives contact email edits/merges. */
    recipientEmail: text().notNull(),
    /** `'visit' | 'work_order' | 'invoice'` — null for manual (contact-only) enrollments. */
    subjectKind: text(),
    /** `WorkOrderVisit.id` or `EntityInstance.id`, per `subjectKind`. Null for manual runs. */
    subjectId: text(),
    /** Set once step 1 sends; steps 2..N reply into this thread. */
    threadId: text().references((): AnyPgColumn => Thread.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /**
     * Stored capability token for the public unsubscribe link (`generateId()` from
     * `@auxx/utils`, minted at enrollment). Stored-token lookup, not HMAC-signed —
     * mirrors `quote-public-token.ts`'s pattern (the codebase has no HMAC-token
     * precedent to reuse instead).
     */
    unsubscribeToken: text().notNull(),
    status: sequenceRunStatus().default('active').notNull(),
    exitReason: sequenceExitReason(),
    /** e.g. `{ messageId }` — shape varies by `exitReason`. */
    exitMetadata: jsonb().$type<Record<string, unknown>>(),
    /** Powers per-step sent counts (`runs WHERE lastCompletedStep >= n`). */
    lastCompletedStep: integer().default(0).notNull(),
    lastSentAt: timestamp({ precision: 3 }),
    enrolledById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    enrolledAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    exitedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('SequenceRun_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('SequenceRun_sequenceId_status_idx').using(
      'btree',
      table.sequenceId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    // Reply-detection hot path (Phase 2): inbound message -> active SequenceRun by threadId.
    index('SequenceRun_threadId_idx').using('btree', table.threadId.asc().nullsLast()),
    uniqueIndex('SequenceRun_workflowRunId_key').using(
      'btree',
      table.workflowRunId.asc().nullsLast()
    ),
    uniqueIndex('SequenceRun_unsubscribeToken_key').using(
      'btree',
      table.unsubscribeToken.asc().nullsLast()
    ),
    // One active manual (subject-less) run per (sequence, recipient) — re-enrollment allowed
    // after exit/completion. Re-scoped (client-notifications §4.1) to exclude subject-scoped
    // runs, which get their own unique below — a contact can otherwise have at most one active
    // manual run AND one active subject run per sequence simultaneously.
    uniqueIndex('SequenceRun_sequenceId_recipient_active_key')
      .using(
        'btree',
        table.sequenceId.asc().nullsLast(),
        table.recipientEntityInstanceId.asc().nullsLast()
      )
      .where(sql`${table.status} = 'active' AND ${table.subjectId} IS NULL`),
    // One active run per (sequence, subject) — event-triggered enrollments.
    uniqueIndex('SequenceRun_sequenceId_subject_active_key')
      .using('btree', table.sequenceId.asc().nullsLast(), table.subjectId.asc().nullsLast())
      .where(sql`${table.status} = 'active' AND ${table.subjectId} IS NOT NULL`),
    // Any-run-ever dedup lookup for the enrollment sweep (§4.3) — not status-scoped.
    index('SequenceRun_sequenceId_subjectId_idx').using(
      'btree',
      table.sequenceId.asc().nullsLast(),
      table.subjectId.asc().nullsLast()
    ),
  ]
)

/**
 * Org-wide unsubscribe suppression, keyed by normalized email. Blocks all
 * future enrollments across every sequence in the org.
 */
export const SequenceSuppression = pgTable(
  'SequenceSuppression',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Normalized (lowercased/trimmed) email address. */
    email: text().notNull(),
    contactEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    reason: sequenceSuppressionReason().default('unsubscribe').notNull(),
    /** Provenance — which run triggered the suppression, if any. */
    sequenceRunId: text().references((): AnyPgColumn => SequenceRun.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('SequenceSuppression_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    uniqueIndex('SequenceSuppression_organizationId_email_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.email.asc().nullsLast()
    ),
  ]
)

export type SequenceEntity = typeof Sequence.$inferSelect
export type CreateSequenceInput = typeof Sequence.$inferInsert
export type UpdateSequenceInput = Partial<CreateSequenceInput>

export type SequenceStepEntity = typeof SequenceStep.$inferSelect
export type CreateSequenceStepInput = typeof SequenceStep.$inferInsert
export type UpdateSequenceStepInput = Partial<CreateSequenceStepInput>

export type SequenceRunEntity = typeof SequenceRun.$inferSelect
export type CreateSequenceRunInput = typeof SequenceRun.$inferInsert
export type UpdateSequenceRunInput = Partial<CreateSequenceRunInput>

export type SequenceSuppressionEntity = typeof SequenceSuppression.$inferSelect
export type CreateSequenceSuppressionInput = typeof SequenceSuppression.$inferInsert
export type UpdateSequenceSuppressionInput = Partial<CreateSequenceSuppressionInput>
