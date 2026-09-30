// packages/lib/src/accounting/ledger/post/nothing-to-post.ts

// Builds whose entry would have no lines, so no posting will ever link their legs. The catch-up
// sweep and the close's `inventory_unposted` count share this one definition (plans/mrp/22 §8).

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { StockMovementCostBasis } from '../../../resources/registry/enum-values'

/**
 * Build ids with no pending leg, every inventory role netting to zero, and no labour or overhead
 * absorbed: `buildInventoryMovementEntry` returns no entry for them. A subassembly built into Raw
 * Materials at the value of its parts is the common case; its reversal mirrors it and is one too.
 */
export function buildsWithNothingToPost(db: Database, organizationId: string) {
  const leg = alias(schema.StockMovement, 'np_leg')
  const perRole = db
    .select({
      buildId: sql<string>`${leg.buildId}`.as('np_build_id'),
      roleSum: sql<string>`coalesce(sum(${leg.extendedCostMinor}), 0)`.as('np_role_sum'),
      hasPending:
        sql<boolean>`bool_or(${leg.costBasis} IS NOT DISTINCT FROM ${StockMovementCostBasis.PENDING})`.as(
          'np_has_pending'
        ),
    })
    .from(leg)
    .where(and(eq(leg.organizationId, organizationId), isNotNull(leg.buildId)))
    .groupBy(leg.buildId, leg.glRole)
    .as('np_role')

  const absorbing = db
    .select({ buildId: schema.Build.id })
    .from(schema.Build)
    .where(
      and(
        eq(schema.Build.organizationId, organizationId),
        or(ne(schema.Build.laborCost, 0), ne(schema.Build.overheadCost, 0))
      )
    )

  return db
    .select({ buildId: perRole.buildId })
    .from(perRole)
    .where(notInArray(perRole.buildId, absorbing))
    .groupBy(perRole.buildId)
    .having(sql`bool_and(${perRole.roleSum} = 0) AND NOT bool_or(${perRole.hasPending})`)
}

/**
 * Build ids with a leg still waiting for a standard cost. A build posts as one document once every
 * leg is valued (`price-build.ts`), so its valued legs are pending work, not unposted work.
 */
export function buildsWaitingOnACost(db: Database, organizationId: string) {
  const pendingLeg = alias(schema.StockMovement, 'pending_leg')
  return db
    .selectDistinct({ buildId: pendingLeg.buildId })
    .from(pendingLeg)
    .where(
      and(
        eq(pendingLeg.organizationId, organizationId),
        isNotNull(pendingLeg.buildId),
        eq(pendingLeg.costBasis, StockMovementCostBasis.PENDING)
      )
    )
}
