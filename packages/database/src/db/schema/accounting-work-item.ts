// packages/database/src/db/schema/accounting-work-item.ts
// One row per piece of parked accounting work; success deletes it. The sentence,
// severity and status are functions of `reasonCode` (lib `accounting/work-items/codes.ts`),
// never stored. See plans/accounting/tasks/91-one-entry-per-event.md §4.6.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { Organization } from './organization'

/** Where the work stopped. Export state stays on `ExportBatch` (89). */
export const ACCOUNTING_WORK_STAGES = ['evidence', 'money', 'post', 'issue'] as const

export const AccountingWorkItem = pgTable(
  'AccountingWorkItem',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    /** `money_transaction`, `fulfillment`, `credit_memo`, `payout`, `financial_source_acceptance`. */
    sourceKind: text().notNull(),
    sourceId: text().notNull(),
    /** 0 unless one source is worked more than once at the same stage. */
    occurrence: integer().notNull().default(0),
    stage: text().notNull().$type<(typeof ACCOUNTING_WORK_STAGES)[number]>(),
    /** Closed vocabulary, `WORK_ITEM_CODES` in lib. */
    reasonCode: text().notNull(),
    // Wake keys: the writes that fix a problem target these.
    role: text(),
    railId: text(),
    glAccountId: text(),
    periodKey: text(),
    externalRef: text(),
    /** What the drawer renders beyond the keys. */
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer().notNull().default(1),
    /** Null: excluded from the sweep until a wake or a person sets it. */
    nextAttemptAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('AccountingWorkItem_source_key').on(
      t.organizationId,
      t.sourceKind,
      t.sourceId,
      t.occurrence,
      t.stage
    ),
    index('AccountingWorkItem_reason_idx').on(t.organizationId, t.reasonCode),
    index('AccountingWorkItem_due_idx').on(t.organizationId, t.nextAttemptAt),
    check(
      'AccountingWorkItem_stage_check',
      sql`${t.stage} IN ('evidence','money','post','issue') AND ${t.attempts} >= 0 AND ${t.occurrence} >= 0`
    ),
  ]
)

export type AccountingWorkItemEntity = typeof AccountingWorkItem.$inferSelect
export type CreateAccountingWorkItemInput = typeof AccountingWorkItem.$inferInsert
export type AccountingWorkStage = (typeof ACCOUNTING_WORK_STAGES)[number]
