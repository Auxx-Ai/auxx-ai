// packages/lib/src/mrp/types.ts

import type { DayKey, MonthKey } from '@auxx/utils/calendar-day'
import type {
  MrpBufferMode,
  MrpFactorSource,
  MrpFlag,
  MrpLeadTimeSource,
  MrpOrderMode,
  MrpSuggestionKind,
  MrpSupplyType,
} from './client'

/** `part_kind` values; null reads as `component`. */
export type MrpPartKind = 'component' | 'subassembly' | 'finished_good' | 'service'
/** `part_cost_source` values (D12). */
export type MrpCostSource = 'vendor' | 'bom' | 'none'

/** One part and its planning settings, as read from the part record (02 §4). */
export interface PartInput {
  id: string
  kind: MrpPartKind | null
  costSource: MrpCostSource | null
  quantityOnHand: number
  bufferMode: MrpBufferMode | null
  buildLeadTimeDays: number | null
  buildCycleDays: number | null
  leadTimeFactorOverride: number | null
  variabilityFactorOverride: number | null
  /** Any live vendor part points at this part (the D12 structural fallback). */
  hasVendorPart: boolean
  /** Any subpart edge has this part as parent. */
  hasBomChildren: boolean
}

export interface VendorPartInput {
  id: string
  partId: string
  /** `vendor_part_contact`, the supplier company. */
  supplierId: string | null
  leadTimeDays: number | null
  /** Per each (D14). */
  minOrderQty: number | null
  /** Eaches per purchase unit. */
  purchaseRatio: number | null
  isPreferred: boolean
}

/** A supplier company's ordering settings (02 §4.2). */
export interface SupplierInput {
  id: string
  /** Null reads as `when_needed`. */
  orderMode: MrpOrderMode | null
  orderCycleDays: number | null
  nextOrderDate: DayKey | null
  /** Latest `purchase_order_ordered_at` among the supplier's issued or closed POs. */
  lastIssuedOrderedAt: DayKey | null
}

/** An open PO line. Pass issued AND draft lines: drafts only raise `draft_po_pending` (D17). */
export interface OpenPoLineInput {
  id: string
  purchaseOrderId: string
  partId: string
  vendorPartId: string | null
  supplierId: string | null
  status: 'draft' | 'issued'
  /** Ordered − received, > 0. */
  quantityOpen: number
  orderedAt: DayKey | null
  expectedAt: DayKey | null
}

/** A `planned` or `in_progress` build: on order for its produced part. */
export interface OpenBuildInput {
  id: string
  partId: string
  /** Planned − produced, > 0. */
  quantityOpen: number
  /** When it is expected to complete; null → today + the part's build lead time. */
  dueDay: DayKey | null
}

/** One row of the mirror's dense daily series (`readDailySeries`, 02 §6.1). */
export interface DailySeriesPoint {
  partId: string
  day: DayKey
  /** Consumption class, positive. */
  consumed: number
  /** Scrap class, positive. */
  scrapped: number
  /** Signed sum of every movement that day. */
  net: number
  onHandEod: number
}

/** Per-day, per-type activity for the §8 proposal signals; quantities positive, counts are movement rows. */
export interface DailyActivity {
  partId: string
  day: DayKey
  /** `sale` + `ship`. */
  saleQty: number
  saleCount: number
  produceQty: number
  produceCount: number
  consumeQty: number
  consumeCount: number
}

/** One calendar month of a part's history, for seasonality (02 §6.5). */
export interface MonthlyBucket {
  partId: string
  month: MonthKey
  /** `sale` + `ship`: the finished good's own index is learned from this. */
  sold: number
  /** Every consumption-class movement. */
  consumed: number
  /** Days in the month with `onHandEod <= 0` and zero consumption; such months are dropped. */
  stockoutDays: number
}

/** A part's consumption attributed to one parent (7a); `parentId === partId` is a direct sale. */
export interface WhereUsedShare {
  partId: string
  parentId: string
  quantity: number
}

/** One PO line and the receipts linked to it by `purchaseOrderLineId` (02 §6.2). */
export interface ReceiptObservation {
  purchaseOrderLineId: string
  partId: string
  vendorPartId: string | null
  /** When the PO record was created, for the "created after its receipt" exclusion. */
  createdAt: DayKey
  orderedAt: DayKey | null
  expectedAt: DayKey | null
  quantityOrdered: number
  receipts: { day: DayKey; quantity: number }[]
}

/** A BOM edge from the org-wide edge list. */
export type { SubpartRow } from '../inventory/costing/cost-calculator'

/** The `mrp.*` settings the run uses (08 §6); null factors mean "class-based". */
export interface RunSettings {
  aduWindowDays: number
  defaultLeadTimeFactor: number | null
  defaultVariabilityFactor: number | null
}

/** Twelve numbers, Jan..Dec; null when seasonality is off for the part. */
export type SeasonalIndex = number[]

/** A quantity expected to land on a day (open PO line or build), for projections. */
export interface ProjectedReceipt {
  day: DayKey
  quantity: number
}

/** One `MrpPlanRunItem` row minus what the writer adds (run id, org id, `runAsOf`, `isLatest`). */
export interface PlanItem {
  partId: string
  supplyType: MrpSupplyType
  buffered: boolean
  proposedBuffered: boolean
  proposalReasons: string[]
  adu: number | null
  sigma: number | null
  cv: number | null
  stockoutDaysExcluded: number | null
  onHand: number
  onOrder: number
  openDemand: number
  netFlow: number
  leadTimeDays: number | null
  leadTimeSource: MrpLeadTimeSource
  decoupledLeadTimeDays: number | null
  observedLeadTimeDays: number | null
  observedReceipts: number | null
  leadTimeFactor: number | null
  leadTimeFactorSource: MrpFactorSource | null
  variabilityFactor: number | null
  variabilityFactorSource: MrpFactorSource | null
  orderCycleDays: number | null
  orderMode: MrpOrderMode
  nextOrderDate: DayKey | null
  nextArrivalDate: DayKey | null
  followingArrivalDate: DayKey | null
  pullsOrderForward: boolean | null
  seasonalIndex: SeasonalIndex | null
  baseAdu: number | null
  topOfRed: number | null
  topOfYellow: number | null
  topOfGreen: number | null
  stockoutDate: DayKey | null
  orderByDate: DayKey | null
  priority: number | null
  suggestionKind: MrpSuggestionKind | null
  suggestedQty: number | null
  suggestedPurchaseUnits: number | null
  suggestedVendorPartId: string | null
  suggestedSupplierId: string | null
  flags: MrpFlag[]
  isOverdue: boolean
}
