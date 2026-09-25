// packages/lib/src/mrp/reads/part-item.ts

import { type Database, schema } from '@auxx/database'
import { daysBetween } from '@auxx/utils/calendar-day'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { chunkArray } from '../../import/utils/chunk-array'
import {
  buildParentGraph,
  buildSubpartGraph,
  type SubpartRow,
} from '../../inventory/costing/cost-calculator'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import type { MrpBufferMode } from '../client'
import { guard } from './guard'
import { readPartLabels, readRecordNames, readVendorParts, type VendorPartRow } from './labels'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

const I = schema.MrpPlanRunItem

const PART_PLANNING_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_sku',
  'part_kind',
  'part_cost_source',
  'part_quantity_on_hand',
  'part_stock_status',
  'part_mrp_buffer_mode',
  'part_build_lead_time_days',
  'part_build_cycle_days',
  'part_mrp_lead_time_factor',
  'part_mrp_variability_factor',
] as const)

/** A BOM is at most this deep in practice; the cap only stops a malformed graph. */
const MAX_BOM_DEPTH = 25
/** Paths, not parts: a DAG with heavy sharing expands, so the tree stops here. */
const MAX_BOM_NODES = 2000

/** The part's planning settings as stored now, shown beside the run's values (07 §4.5). */
export interface PartPlanningFields {
  id: string
  name: string | null
  sku: string | null
  kind: string | null
  costSource: string | null
  quantityOnHand: number | null
  stockStatus: string | null
  bufferMode: MrpBufferMode | null
  buildLeadTimeDays: number | null
  buildCycleDays: number | null
  leadTimeFactor: number | null
  variabilityFactor: number | null
}

/** One node of the part's BOM subtree (07 §4.6); `key` is the path, so a shared part appears once per path. */
export interface BomNode {
  key: string
  parentKey: string | null
  partId: string
  depth: number
  quantityPer: number
  hasChildren: boolean
  /** Distinct parents of this part across the org's BOM ("shared ×N"). */
  parentCount: number
  name: string | null
  sku: string | null
  stockStatus: string | null
  item: Pick<
    MrpPlanItemRow,
    | 'onHand'
    | 'orderByDate'
    | 'stockoutDate'
    | 'suggestionKind'
    | 'suggestedQty'
    | 'buffered'
    | 'isOverdue'
  > | null
}

export interface MrpPartItem {
  run: MrpRunRef | null
  item: (MrpPlanItemRow & { daysOfCover: number | null }) | null
  part: PartPlanningFields | null
  vendorPart: VendorPartRow | null
  supplier: { id: string; name: string | null } | null
  bom: BomNode[]
}

/** The part's subtree below `rootId`, depth-first, cycle-safe. */
export function walkBom(
  rootId: string,
  edges: readonly SubpartRow[]
): Omit<BomNode, 'name' | 'sku' | 'stockStatus' | 'item'>[] {
  const children = buildSubpartGraph(edges)
  const parents = buildParentGraph(edges)
  const out: Omit<BomNode, 'name' | 'sku' | 'stockStatus' | 'item'>[] = []
  const visit = (partId: string, parentKey: string, depth: number, path: Set<string>) => {
    if (depth > MAX_BOM_DEPTH) return
    for (const edge of children.get(partId) ?? []) {
      if (out.length >= MAX_BOM_NODES) return
      if (path.has(edge.childId)) continue
      const key = `${parentKey}/${edge.childId}`
      out.push({
        key,
        parentKey: depth === 1 ? null : parentKey,
        partId: edge.childId,
        depth,
        quantityPer: edge.qty,
        hasChildren: (children.get(edge.childId)?.length ?? 0) > 0,
        parentCount: new Set(parents.get(edge.childId) ?? []).size,
      })
      visit(edge.childId, key, depth + 1, new Set(path).add(edge.childId))
    }
  }
  visit(rootId, rootId, 1, new Set([rootId]))
  return out
}

/** One part's stored run item, labels, current planning fields, preferred vendor part and BOM subtree. */
export async function readPartItem(
  db: Database,
  organizationId: string,
  input: { partId: string; runId?: string | null }
): Promise<Result<MrpPartItem, Error>> {
  return guard(
    async () => {
      const run = await loadRun(db, organizationId, input.runId)
      const [part, edges] = await Promise.all([
        readPartPlanningFields(db, organizationId, input.partId),
        getOrgCache().get(organizationId, 'subpartEdges'),
      ])
      const tree = walkBom(input.partId, edges ?? [])
      const treeIds = [...new Set(tree.map((n) => n.partId))]

      const items = run
        ? await readItems(db, organizationId, run.id, [input.partId, ...treeIds])
        : new Map<string, MrpPlanItemRow>()
      const item = items.get(input.partId) ?? null

      const [vendorPart] = item?.suggestedVendorPartId
        ? await readVendorParts(db, organizationId, { ids: [item.suggestedVendorPartId] })
        : []
      const supplierId = item?.suggestedSupplierId ?? vendorPart?.supplierId ?? null
      const [labels, supplierNames] = await Promise.all([
        readPartLabels(db, organizationId, treeIds),
        supplierId
          ? readRecordNames(db, organizationId, 'company', [supplierId])
          : new Map<string, string | null>(),
      ])

      return {
        run,
        item:
          item && run
            ? {
                ...item,
                daysOfCover: item.stockoutDate ? daysBetween(run.asOfDay, item.stockoutDate) : null,
              }
            : null,
        part,
        vendorPart: vendorPart ?? null,
        supplier: supplierId
          ? { id: supplierId, name: supplierNames.get(supplierId) ?? null }
          : null,
        bom: tree.map((node) => {
          const label = labels.get(node.partId)
          const nodeItem = items.get(node.partId)
          return {
            ...node,
            name: label?.name ?? null,
            sku: label?.sku ?? null,
            stockStatus: label?.stockStatus ?? null,
            item: nodeItem
              ? {
                  onHand: nodeItem.onHand,
                  orderByDate: nodeItem.orderByDate,
                  stockoutDate: nodeItem.stockoutDate,
                  suggestionKind: nodeItem.suggestionKind,
                  suggestedQty: nodeItem.suggestedQty,
                  buffered: nodeItem.buffered,
                  isOverdue: nodeItem.isOverdue,
                }
              : null,
          }
        }),
      }
    },
    'Failed to read the plan item for a part',
    { organizationId, partId: input.partId, runId: input.runId }
  )
}

/** A run's items for these parts, keyed by part id. */
export async function readItems(
  db: Database,
  organizationId: string,
  runId: string,
  partIds: readonly string[]
): Promise<Map<string, MrpPlanItemRow>> {
  const out = new Map<string, MrpPlanItemRow>()
  for (const chunk of chunkArray([...new Set(partIds)], 500)) {
    const rows = await db
      .select()
      .from(I)
      .where(
        and(
          eq(I.organizationId, organizationId),
          eq(I.mrpPlanRunId, runId),
          inArray(I.partId, chunk)
        )
      )
    for (const row of rows) out.set(row.partId, row)
  }
  return out
}

async function readPartPlanningFields(
  db: Database,
  organizationId: string,
  partId: string
): Promise<PartPlanningFields | null> {
  const ctx = await systemFields(db, organizationId, 'part', PART_PLANNING_PICK)
  if (!ctx) return null
  const [r] = await readSystemRecords(db, organizationId, ctx, {
    ids: [partId],
    includeArchived: true,
  })
  if (!r) return null
  return {
    id: r.id,
    name: r.displayName,
    sku: r.text('part_sku'),
    kind: r.option('part_kind'),
    costSource: r.option('part_cost_source'),
    quantityOnHand: r.number('part_quantity_on_hand'),
    stockStatus: r.option('part_stock_status'),
    bufferMode: r.option('part_mrp_buffer_mode') as MrpBufferMode | null,
    buildLeadTimeDays: r.number('part_build_lead_time_days'),
    buildCycleDays: r.number('part_build_cycle_days'),
    leadTimeFactor: r.number('part_mrp_lead_time_factor'),
    variabilityFactor: r.number('part_mrp_variability_factor'),
  }
}
