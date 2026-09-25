// packages/lib/src/mrp/client.ts

// Client-safe MRP vocabulary and tuning constants; see plans/mrp/02-data-structures.md.

/** Data-quality flags on a plan item (02 §7 step 10, 01 §3 P3, 04 §6). */
export const MRP_FLAGS = [
  'relief_gaps',
  'unbuilt_sales',
  'no_lead_time',
  'lead_time_drift',
  'overdue_receipt',
  'mirror_drift',
  'wont_make_next_arrival',
  'draft_po_pending',
  'unclassified',
  'not_buffered_bought',
] as const
export type MrpFlag = (typeof MRP_FLAGS)[number]

export const MRP_FLAG_LABELS: Record<MrpFlag, string> = {
  relief_gaps: 'Sales missing from the ledger',
  unbuilt_sales: 'Sold more than was built',
  no_lead_time: 'No lead time',
  lead_time_drift: 'Lead time differs from receipts',
  overdue_receipt: 'Receipt overdue',
  mirror_drift: 'Movement history out of sync',
  wont_make_next_arrival: "Won't make the next arrival",
  draft_po_pending: 'Draft PO not issued',
  unclassified: 'Not bought or made',
  not_buffered_bought: 'Bought part not buffered',
}

export const MRP_SUPPLY_TYPES = ['bought', 'made', 'unclassified'] as const
export type MrpSupplyType = (typeof MRP_SUPPLY_TYPES)[number]
export const MRP_SUPPLY_TYPE_LABELS: Record<MrpSupplyType, string> = {
  bought: 'Bought',
  made: 'Made',
  unclassified: 'Unclassified',
}

export const MRP_ORDER_MODES = ['when_needed', 'scheduled'] as const
export type MrpOrderMode = (typeof MRP_ORDER_MODES)[number]
export const MRP_ORDER_MODE_LABELS: Record<MrpOrderMode, string> = {
  when_needed: 'When needed',
  scheduled: 'Scheduled',
}

export const MRP_SUGGESTION_KINDS = ['build', 'purchase'] as const
export type MrpSuggestionKind = (typeof MRP_SUGGESTION_KINDS)[number]
export const MRP_SUGGESTION_KIND_LABELS: Record<MrpSuggestionKind, string> = {
  build: 'Build',
  purchase: 'Purchase',
}

/** The action list's status tabs (07 §4.1); `all` is the all-parts grid. */
export const MRP_PLAN_TABS = ['all', 'overdue', 'this_week', 'later', 'flagged', 'fine'] as const
export type MrpPlanTab = (typeof MRP_PLAN_TABS)[number]

export const MRP_LIST_SORTS = ['priority', 'orderByDate', 'stockoutDate', 'partName'] as const
export type MrpListSort = (typeof MRP_LIST_SORTS)[number]

export const MRP_LEAD_TIME_SOURCES = ['vendor', 'build', 'none'] as const
export type MrpLeadTimeSource = (typeof MRP_LEAD_TIME_SOURCES)[number]

export const MRP_FACTOR_SOURCES = ['override', 'default'] as const
export type MrpFactorSource = (typeof MRP_FACTOR_SOURCES)[number]

/** `part_mrp_buffer_mode`; null reads as `auto`. */
export const MRP_BUFFER_MODES = ['auto', 'buffered', 'not_buffered'] as const
export type MrpBufferMode = (typeof MRP_BUFFER_MODES)[number]
export const MRP_BUFFER_MODE_LABELS: Record<MrpBufferMode, string> = {
  auto: 'Automatic',
  buffered: 'Buffered',
  not_buffered: 'Not buffered',
}

/** The three VF levels (D15). */
export const MRP_VARIABILITY_LEVELS = ['low', 'medium', 'high'] as const
export type MrpVariabilityLevel = (typeof MRP_VARIABILITY_LEVELS)[number]
export const MRP_VARIABILITY_FACTORS: Record<MrpVariabilityLevel, number> = {
  low: 0.3,
  medium: 0.5,
  high: 0.8,
}
export const MRP_VARIABILITY_LEVEL_LABELS: Record<MrpVariabilityLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/** Lead-time classes behind the default LTF (primer §4.3). */
export const MRP_LEAD_TIME_CLASSES = ['short', 'medium', 'long'] as const
export type MrpLeadTimeClass = (typeof MRP_LEAD_TIME_CLASSES)[number]
export const MRP_LEAD_TIME_CLASS_LABELS: Record<MrpLeadTimeClass, string> = {
  short: 'Short lead time',
  medium: 'Medium lead time',
  long: 'Long lead time',
}
/** A decoupled lead time below `medium` days is short; at or above `long` days it is long. */
export const MRP_LEAD_TIME_CLASS_DAYS = { medium: 10, long: 30 } as const
export const MRP_LEAD_TIME_FACTORS: Record<MrpLeadTimeClass, number> = {
  short: 0.75,
  medium: 0.5,
  long: 0.25,
}

/** Reasons a part is (or is not) proposed as buffered (02 §8); `shared_by_<n>` is built at run time. */
export const MRP_PROPOSAL_REASONS = [
  'no_usage',
  'bought_consumed',
  'long_lead',
  'sold_from_shelf',
  'assemble_to_order',
  'batch_built',
  'unclassified',
] as const
export type MrpProposalReason = (typeof MRP_PROPOSAL_REASONS)[number]
export const MRP_SHARED_BY_REASON_PREFIX = 'shared_by_'

// ── Thresholds for the open questions (02 §9, 01 §5) ──

/** D15: demand class by daily CV. At or below `low` is low, above `high` is high. */
export const MRP_DEMAND_CV_BANDS = { low: 0.5, high: 1 } as const
/** D15: fewer observed usage days than this, and the demand class falls back to medium. */
export const MRP_MIN_USAGE_DAYS_FOR_VF = 30
/** D15 and Q10: fewer clean receipts than this, and supply stats are not trusted. */
export const MRP_MIN_RECEIPTS = 3
/** D15 supply class: low needs all three low bounds, high needs any one high bound. */
export const MRP_SUPPLY_BANDS = {
  /** (p90 − median) ÷ median lead time. */
  spreadLow: 0.2,
  spreadHigh: 0.5,
  onTimeLow: 0.9,
  onTimeHigh: 0.7,
  fillLow: 0.98,
  fillHigh: 0.9,
} as const

/** 02 §6.2: the receipt that brings a line to this share received ends its lead time. */
export const MRP_RECEIVED_SHARE_FOR_LEAD_TIME = 0.9
/** Q10: drift when |median − stated| exceeds the larger of these. */
export const MRP_DRIFT_MIN_DAYS = 3
export const MRP_DRIFT_MIN_SHARE = 0.25

/** Q9 and 02 §8: sold from the shelf when more than this share of sale days had no same-day build (book-zone calendar day). */
export const MRP_SOLD_FROM_SHELF_SHARE = 0.5
/** 02 §8: built in batches when the typical produce quantity is at least this multiple of the typical use. */
export const MRP_BATCH_BUILD_RATIO = 3
/** 02 §8: a subassembly shared by this many buffered-or-sold parents is proposed buffered. */
export const MRP_SHARED_PARENTS_MIN = 2

/** 01 §3 P3: sold − (produced + opening) above this share of sold raises `unbuilt_sales`. */
export const MRP_UNBUILT_SALES_TOLERANCE = 0.1

/** D19: the seasonal index is off under this many clean months, and at full weight from `full`. */
export const MRP_SEASONAL_MONTHS = { min: 12, full: 24 } as const

/** A cushion or stockout further out than this is reported as none. */
export const MRP_PROJECTION_HORIZON_DAYS = 730
