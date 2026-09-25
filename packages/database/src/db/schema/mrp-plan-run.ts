// packages/database/src/db/schema/mrp-plan-run.ts
// MRP plan outputs: one run per org per plan, one item per part. See plans/mrp/02-data-structures.md §5.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'

export const mrpPlanRunStatus = pgEnum('MrpPlanRunStatus', ['running', 'completed', 'failed'])
export const mrpSupplyType = pgEnum('MrpSupplyType', ['bought', 'made', 'unclassified'])
export const mrpSuggestionKind = pgEnum('MrpSuggestionKind', ['build', 'purchase'])
/** `vendor` = preferred vendor_part_lead_time; `build` = part_build_lead_time_days. Observed never drives the plan (D11). */
export const mrpLeadTimeSource = pgEnum('MrpLeadTimeSource', ['vendor', 'build', 'none'])
export const mrpFactorSource = pgEnum('MrpFactorSource', ['override', 'default'])
export const mrpOrderMode = pgEnum('MrpOrderMode', ['when_needed', 'scheduled'])

export const MrpPlanRun = pgTable(
  'MrpPlanRun',
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
    status: mrpPlanRunStatus().default('running').notNull(),
    /** The "today" the run planned from. */
    asOf: timestamp({ withTimezone: true }).notNull(),
    /** Window, grain and default factors actually used, so a past run can be explained. */
    params: jsonb().notNull(),
    startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp({ withTimezone: true }),
    error: text(),
  },
  (t) => [index('MrpPlanRun_org_asOf_idx').on(t.organizationId, t.asOf)]
)

export const MrpPlanRunItem = pgTable(
  'MrpPlanRunItem',
  {
    mrpPlanRunId: text()
      .notNull()
      .references((): AnyPgColumn => MrpPlanRun.id, { onDelete: 'cascade' }),
    organizationId: text().notNull(),
    partId: text().notNull(),
    supplyType: mrpSupplyType().notNull(), // D12

    // buffering (D8)
    buffered: boolean().notNull(), // effective: override ?? proposed
    proposedBuffered: boolean().notNull(),
    proposalReasons: text().array().notNull(), // e.g. shared_by_4, long_lead, sold_from_shelf

    // usage
    adu: numeric({ mode: 'number' }), // average daily usage
    sigma: numeric({ mode: 'number' }),
    cv: numeric({ mode: 'number' }),
    stockoutDaysExcluded: integer(), // censored days left out of adu

    // position
    onHand: numeric({ mode: 'number' }).notNull(),
    onOrder: numeric({ mode: 'number' }).notNull(), // open PO lines / open builds
    openDemand: numeric({ mode: 'number' }).notNull(), // usually 0 (D10)
    netFlow: numeric({ mode: 'number' }).notNull(),

    // lead time
    leadTimeDays: numeric({ mode: 'number' }),
    leadTimeSource: mrpLeadTimeSource().notNull(),
    decoupledLeadTimeDays: numeric({ mode: 'number' }),
    /** Median from receipts, shown beside the stated value; never used in the math (D11). */
    observedLeadTimeDays: numeric({ mode: 'number' }),
    observedReceipts: integer(),

    // effective factors, so the zones can be explained
    leadTimeFactor: numeric({ mode: 'number' }),
    leadTimeFactorSource: mrpFactorSource(),
    variabilityFactor: numeric({ mode: 'number' }),
    variabilityFactorSource: mrpFactorSource(),
    /** Supplier cycle (scheduled) or `part_build_cycle_days` (made); null for when-needed bought parts. */
    orderCycleDays: numeric({ mode: 'number' }),

    // ordering mode (D16)
    orderMode: mrpOrderMode().notNull(),
    /** Scheduled only: when the next order to the supplier goes out, and when it and the one after land. */
    nextOrderDate: date(),
    nextArrivalDate: date(),
    followingArrivalDate: date(),
    /** Scheduled only: this part's order-by is what moved the supplier's order earlier than its rhythm date. */
    pullsOrderForward: boolean(),

    // seasonality (D19)
    /** Jan..Dec index for this part, after shrinkage; null when off (< 12 months of history). */
    seasonalIndex: jsonb().$type<number[]>(),
    /** ADU with the season taken out; what projections multiply by the index. */
    baseAdu: numeric({ mode: 'number' }),

    // buffer zones (buffered only)
    topOfRed: numeric({ mode: 'number' }),
    topOfYellow: numeric({ mode: 'number' }),
    topOfGreen: numeric({ mode: 'number' }),

    // answers
    stockoutDate: date(),
    orderByDate: date(),
    /** Sort key for the action list: net flow ÷ top of green for buffered parts, days until order-by otherwise. Lower is more urgent (D13). */
    priority: numeric({ mode: 'number' }),
    suggestionKind: mrpSuggestionKind(),
    /** Per each, already rounded to ≥ MOQ and whole purchase units (D14). */
    suggestedQty: numeric({ mode: 'number' }),
    /** The same quantity in the vendor's purchase unit, for the PO draft. */
    suggestedPurchaseUnits: numeric({ mode: 'number' }),
    suggestedVendorPartId: text(),
    /** The company behind `suggestedVendorPartId`; a dashboard group-by can't hop through the vendor part (07 §5.4). */
    suggestedSupplierId: text(),

    /** Data-quality flags, e.g. relief_gaps, unbuilt_sales, no_lead_time, mirror_drift. */
    flags: text().array().notNull(),

    // denormalised for the Parts dashboard widgets (07 §5.4); never read by the run
    /** `MrpPlanRun.asOf`, so a widget can group by run date without a join. */
    runAsOf: timestamp({ withTimezone: true }).notNull(),
    /** True on the newest completed run's rows; flipped false on the previous run's rows in the same transaction. */
    isLatest: boolean().default(false).notNull(),
    /** `orderByDate < asOf` at run time; a widget condition can't compare two columns. */
    isOverdue: boolean().default(false).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.mrpPlanRunId, t.partId] }),
    index('MrpPlanRunItem_org_part_idx').on(t.organizationId, t.partId),
  ]
)

export type MrpPlanRunEntity = typeof MrpPlanRun.$inferSelect
export type MrpPlanRunInsert = typeof MrpPlanRun.$inferInsert
export type MrpPlanRunItemEntity = typeof MrpPlanRunItem.$inferSelect
export type MrpPlanRunItemInsert = typeof MrpPlanRunItem.$inferInsert
