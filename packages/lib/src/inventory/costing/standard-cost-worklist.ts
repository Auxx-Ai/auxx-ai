// packages/lib/src/inventory/costing/standard-cost-worklist.ts

// Reads only: what Set costs and Set counts show per part (09 D-SC3/D-SC4). No permission checks.

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { requireCachedEntityDefId } from '../../cache'
import { readSystemRecords, systemFieldMap } from '../../resources/system-records'
import {
  isServicePartKind,
  isUsableStoredStandard,
  resolveStandardCostSource,
  type StandardCostOriginValue,
  type StandardCostSourceValue,
} from './client'
import { loadOrgSubpartEdges, type SubpartRow } from './cost-calculator'
import { guard } from './guard'

const WORKLIST_ATTRIBUTES = [
  'part_sku',
  'part_kind',
  'part_standard_cost',
  'part_standard_cost_source',
  'part_standard_cost_origin',
  'part_purchase_cost',
  'part_channel_cost',
] as const

/** One part's standard-cost state. Money is minor units at rate precision. */
export interface StandardCostWorklistPart {
  partId: string
  name: string
  sku: string | null
  /** Stored `part_kind`, `null` when unset. */
  kind: string | null
  hasBom: boolean
  /** A usable stored standard, or `null`. */
  standardCost: number | null
  standardCostSource: StandardCostSourceValue | null
  standardCostOrigin: StandardCostOriginValue | null
  purchaseCost: number | null
  channelCost: number | null
  /** Distinct live BOM parents across the org. */
  usedIn: number
  /** BOM parts: distinct uncosted leaves below, walking through unvalued subassemblies. */
  uncostedLeafCount: number
  /** Not asked for: an uncosted leaf under a requested BOM part without a standard. */
  isLeaf: boolean
}

/** The stored facts {@link buildStandardCostWorklist} joins with the BOM. */
export interface WorklistPartFacts {
  partId: string
  name: string
  sku: string | null
  kind: string | null
  standardCost: number | null
  standardCostSource: StandardCostSourceValue | null
  standardCostOrigin: StandardCostOriginValue | null
  purchaseCost: number | null
  channelCost: number | null
}

/**
 * Every stocked part (no `partIds`), or the requested parts followed by the uncosted leaves under
 * those with a BOM and no standard, each leaf once.
 */
export async function readStandardCostWorklist(
  db: Database,
  organizationId: string,
  input: { partIds?: readonly string[] } = {}
): Promise<Result<StandardCostWorklistPart[], Error>> {
  return guard(
    async () => {
      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const fields = await systemFieldMap(db, organizationId, WORKLIST_ATTRIBUTES)
      const [records, edges] = await Promise.all([
        readSystemRecords(db, organizationId, { defId: partDefId, fields }),
        loadOrgSubpartEdges(db, organizationId),
      ])
      const facts: WorklistPartFacts[] = records.map((row) => {
        const origin = row.option('part_standard_cost_origin')
        const standard = row.number('part_standard_cost')
        return {
          partId: row.id,
          name: row.displayName ?? '',
          sku: row.text('part_sku'),
          kind: row.option('part_kind'),
          standardCost: isUsableStoredStandard(standard, origin != null) ? standard : null,
          standardCostSource: resolveStandardCostSource(row.option('part_standard_cost_source')),
          standardCostOrigin: (origin as StandardCostOriginValue | null) ?? null,
          purchaseCost: row.number('part_purchase_cost'),
          channelCost: row.number('part_channel_cost'),
        }
      })
      return buildStandardCostWorklist(facts, edges, input.partIds)
    },
    'Failed to read the standard cost worklist',
    { organizationId, partIds: input.partIds?.length ?? 'all' }
  )
}

/** The pure join behind {@link readStandardCostWorklist}. */
export function buildStandardCostWorklist(
  facts: readonly WorklistPartFacts[],
  edges: readonly SubpartRow[],
  requested?: readonly string[]
): StandardCostWorklistPart[] {
  const byId = new Map(facts.map((part) => [part.partId, part]))
  const children = new Map<string, Set<string>>()
  const parents = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!byId.has(edge.parentPartId) || !byId.has(edge.childPartId)) continue
    if (!children.has(edge.parentPartId)) children.set(edge.parentPartId, new Set())
    children.get(edge.parentPartId)?.add(edge.childPartId)
    if (!parents.has(edge.childPartId)) parents.set(edge.childPartId, new Set())
    parents.get(edge.childPartId)?.add(edge.parentPartId)
  }

  const leafMemo = new Map<string, ReadonlySet<string>>()
  const uncostedLeaves = (partId: string, path: Set<string>): ReadonlySet<string> => {
    const known = leafMemo.get(partId)
    if (known) return known
    const leaves = new Set<string>()
    path.add(partId)
    for (const childId of children.get(partId) ?? []) {
      const child = byId.get(childId)
      if (!child || child.standardCost != null || path.has(childId)) continue
      if (children.has(childId)) {
        for (const leaf of uncostedLeaves(childId, path)) leaves.add(leaf)
      } else if (!isServicePartKind(child.kind)) {
        leaves.add(childId)
      }
    }
    path.delete(partId)
    leafMemo.set(partId, leaves)
    return leaves
  }

  const toRow = (part: WorklistPartFacts, isLeaf: boolean): StandardCostWorklistPart => ({
    ...part,
    hasBom: children.has(part.partId),
    usedIn: parents.get(part.partId)?.size ?? 0,
    uncostedLeafCount: children.has(part.partId) ? uncostedLeaves(part.partId, new Set()).size : 0,
    isLeaf,
  })

  if (!requested) {
    return facts.filter((part) => !isServicePartKind(part.kind)).map((part) => toRow(part, false))
  }

  const rows: StandardCostWorklistPart[] = []
  const listed = new Set<string>()
  for (const partId of requested) {
    const part = byId.get(partId)
    if (!part || listed.has(partId)) continue
    listed.add(partId)
    rows.push(toRow(part, false))
  }
  const leafIds = new Set<string>()
  for (const row of rows) {
    if (!row.hasBom || row.standardCost != null) continue
    for (const leaf of uncostedLeaves(row.partId, new Set())) {
      if (!listed.has(leaf)) leafIds.add(leaf)
    }
  }
  const leaves = [...leafIds]
    .map((id) => byId.get(id) as WorklistPartFacts)
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const leaf of leaves) rows.push(toRow(leaf, true))
  return rows
}
