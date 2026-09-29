// packages/lib/src/inventory/builds/movement-account-drift.ts

/**
 * Movements whose frozen inventory account no longer matches their part's kind (plans/mrp/13 §7,
 * 17 §5.2). Every movement type counts, not only backflush legs; "posted" is the ledger's own
 * test, a `member` link on a standing `inventory_movement` entry.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readInventoryAccountFixTotals } from '../../accounting/ledger/reads/inventory-account-fix'
import { findLinkedPostings } from '../../accounting/ledger/reads/list-postings'
import { readPartKinds, readPartNames } from './build-queries'
import { guard } from './guard'
import {
  type DriftedMovement,
  expectedInventoryRole,
  type PartAccountDriftPlan,
  planPartAccountDrift,
} from './movement-account-drift-plan'

const POSTED_CHUNK = 5000

/** One part whose movements carry an account its current kind no longer maps to. */
export interface MovementAccountDriftPart {
  partId: string
  partName: string
  currentKind: string | null
  expectedAccountRole: string
  /** The roles the drifted movements carry now. */
  fromAccountRoles: string[]
  movementCount: number
  unpostedCount: number
  postedCount: number
}

export interface MovementAccountDrift {
  parts: MovementAccountDriftPart[]
  movementCount: number
  unpostedCount: number
  postedCount: number
}

/** The drift plus what fixing each part takes; the fix reads the same thing. */
export interface MovementAccountDriftDetail {
  parts: (MovementAccountDriftPart & { plan: PartAccountDriftPlan })[]
}

/** Parts with drifted movements, services skipped. */
export async function readMovementAccountDrift(
  db: Database,
  organizationId: string
): Promise<Result<MovementAccountDrift, Error>> {
  return guard(
    async () => summarize(await loadMovementAccountDrift(db, organizationId)),
    'Failed to read movement account drift',
    { organizationId }
  )
}

function summarize(detail: MovementAccountDriftDetail): MovementAccountDrift {
  const parts = detail.parts.map(({ plan: _plan, ...part }) => part)
  return {
    parts,
    movementCount: parts.reduce((sum, part) => sum + part.movementCount, 0),
    unpostedCount: parts.reduce((sum, part) => sum + part.unpostedCount, 0),
    postedCount: parts.reduce((sum, part) => sum + part.postedCount, 0),
  }
}

/** Every part that needs a restamp or a correcting entry, with its plan. Throws on a read failure. */
export async function loadMovementAccountDrift(
  db: Database | Transaction,
  organizationId: string,
  options: { partIds?: readonly string[] } = {}
): Promise<MovementAccountDriftDetail> {
  const onlyParts = options.partIds ? [...new Set(options.partIds)] : undefined
  if (onlyParts?.length === 0) return { parts: [] }

  const t = schema.StockMovement
  const movementScope = (extra: SQL[] = []) =>
    and(
      eq(t.organizationId, organizationId),
      isNotNull(t.glRole),
      ...(onlyParts ? [inArray(t.partId, onlyParts)] : []),
      ...extra
    )

  // Pass 1: (part, stamped role) counts, to find the drifted pairs without loading every row.
  const pairs = await db
    .select({ partId: t.partId, role: t.glRole, count: sql<string>`count(*)` })
    .from(t)
    .where(movementScope())
    .groupBy(t.partId, t.glRole)

  const fixTotals = await readInventoryAccountFixTotals(db, organizationId, onlyParts)
  const candidateIds = [
    ...new Set([
      ...pairs.map((pair) => pair.partId).filter((id): id is string => !!id),
      ...fixTotals.keys(),
    ]),
  ]
  const kinds = await readPartKinds(db as Database, organizationId, candidateIds)
  const expected = new Map<string, string>()
  for (const partId of candidateIds) {
    const role = expectedInventoryRole(kinds.get(partId) ?? null)
    if (role) expected.set(partId, role)
  }

  const driftedParts = new Set<string>()
  const driftedRoles = new Set<string>()
  for (const pair of pairs) {
    if (!pair.partId || !pair.role) continue
    const role = expected.get(pair.partId)
    if (!role || role === pair.role) continue
    driftedParts.add(pair.partId)
    driftedRoles.add(pair.role)
  }

  // Pass 2: the drifted rows themselves, with their frozen value.
  const movementsByPart = new Map<string, DriftedMovement[]>()
  if (driftedParts.size > 0) {
    const rows = await db
      .select({ id: t.id, partId: t.partId, role: t.glRole, extendedCost: t.extendedCostMinor })
      .from(t)
      .where(
        movementScope([inArray(t.partId, [...driftedParts]), inArray(t.glRole, [...driftedRoles])])
      )

    const drifted = rows.filter(
      (row) => row.partId && row.role && expected.get(row.partId) !== row.role
    )
    const posted = await readPostedMovementIds(
      db,
      organizationId,
      drifted.map((row) => row.id)
    )
    for (const row of drifted) {
      const list = movementsByPart.get(row.partId) ?? []
      list.push({
        id: row.id,
        role: row.role!,
        extendedCostMinor: row.extendedCost,
        posted: posted.has(row.id),
      })
      movementsByPart.set(row.partId, list)
    }
  }

  const planned = candidateIds.flatMap((partId) => {
    const expectedRole = expected.get(partId)
    if (!expectedRole) return []
    const plan = planPartAccountDrift({
      expectedRole,
      movements: movementsByPart.get(partId) ?? [],
      fixedByRole: fixTotals.get(partId)?.byRole,
    })
    if (plan.unpostedCount === 0 && plan.correction.length === 0) return []
    return [{ partId, plan }]
  })
  const names = await readPartNames(
    db as Database,
    organizationId,
    planned.map((p) => p.partId)
  )

  const parts = planned
    .map(({ partId, plan }) => ({
      partId,
      partName: names.get(partId) ?? partId,
      currentKind: kinds.get(partId) ?? null,
      expectedAccountRole: plan.expectedRole,
      fromAccountRoles: plan.fromRoles,
      movementCount: plan.unpostedCount + plan.postedCount,
      unpostedCount: plan.unpostedCount,
      postedCount: plan.postedCount,
      plan,
    }))
    .sort((a, b) => b.movementCount - a.movementCount || a.partName.localeCompare(b.partName))
  return { parts }
}

/** The movements that sit in a standing entry: the close's and the catch-up sweep's test for booked. */
export async function readPostedMovementIds(
  db: Database | Transaction,
  organizationId: string,
  movementIds: readonly string[]
): Promise<Set<string>> {
  const posted = new Set<string>()
  const ids = [...new Set(movementIds)]
  for (let i = 0; i < ids.length; i += POSTED_CHUNK) {
    const links = await findLinkedPostings(db, organizationId, {
      sourceKind: 'stock_movement',
      sourceIds: ids.slice(i, i + POSTED_CHUNK),
      linkRole: 'member',
      statuses: ['posted'],
    })
    for (const link of links) posted.add(link.sourceId)
  }
  return posted
}
