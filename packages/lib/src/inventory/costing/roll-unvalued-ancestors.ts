// packages/lib/src/inventory/costing/roll-unvalued-ancestors.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { isBuildablePartKind } from './client'
import { buildParentGraph, buildSubpartGraph, loadOrgSubpartEdges } from './cost-calculator'
import { guard } from './guard'
import { rollStandardCost } from './standard-cost'
import { loadStandardCostWriteContext } from './standard-cost-queries'
import { widenToAncestors } from './standard-cost-roll'

const logger = createScopedLogger('costing:roll-unvalued-ancestors')

/**
 * After a door writes first standards on `partIds`, roll their BOM ancestors that have none yet
 * and whose whole BOM now has one (09 D-SC7). Returns the parts the roll wrote; `[]` when no
 * ancestor is ready, which is normal while another leaf is still uncosted.
 */
export async function rollUnvaluedAncestors(
  db: Database,
  organizationId: string,
  userId: string,
  partIds: readonly string[]
): Promise<Result<string[], Error>> {
  return guard(
    async () => {
      if (partIds.length === 0) return []
      const [context, edges] = await Promise.all([
        loadStandardCostWriteContext(db, organizationId),
        loadOrgSubpartEdges(db, organizationId),
      ])
      if (edges.length === 0) return []
      const subpartGraph = buildSubpartGraph(edges)
      const named = new Set(partIds)
      const ancestors = [...widenToAncestors(partIds, buildParentGraph(edges))].filter(
        (id) => !named.has(id) && context.allPartIds.has(id)
      )

      // Ready: every leaf below already has a standard, so the roll infers no leaf cost (D-SC1).
      const ready = new Map<string, boolean>()
      const isReady = (partId: string): boolean => {
        if (context.standardCosts.get(partId) != null) return true
        const known = ready.get(partId)
        if (known !== undefined) return known
        ready.set(partId, false) // a cycle reads as not ready
        const children = subpartGraph.get(partId) ?? []
        const kind = context.partKinds.get(partId) ?? 'component'
        const result =
          isBuildablePartKind(kind) &&
          children.length > 0 &&
          children.every((edge) => isReady(edge.childId))
        ready.set(partId, result)
        return result
      }
      const toRoll = ancestors.filter((id) => context.standardCosts.get(id) == null && isReady(id))
      if (toRoll.length === 0) return []

      const rolled = await rollStandardCost(db, organizationId, userId, {
        partIds: toRoll,
        effectiveAt: new Date(),
      })
      if (rolled.isErr()) throw rolled.error
      logger.info('Rolled unvalued BOM parents after a first standard', {
        organizationId,
        requested: toRoll.length,
        written: rolled.value.writtenPartIds.length,
      })
      return rolled.value.writtenPartIds
    },
    'Failed to roll the parents of a first standard',
    { organizationId, parts: partIds.length }
  )
}
