// packages/lib/src/inventory/builds/movement-account-drift-plan.ts

import { isServicePartKind } from '../costing/client'
import { resolveInventoryRoleForPartKind } from '../movements/client'

/** One movement whose frozen account differs from its part's current kind. */
export interface DriftedMovement {
  id: string
  /** The role stamped on the movement. */
  role: string
  /** Signed extended cost, minor units; null when unvalued. */
  extendedCostMinor: number | null
  /** A member of a standing `inventory_movement` entry. */
  posted: boolean
}

/** One leg of a part's correcting entry: signed minor units, debit positive. */
export interface AccountCorrectionLeg {
  role: string
  amountMinor: number
}

/** What fixing one part takes. */
export interface PartAccountDriftPlan {
  expectedRole: string
  /** Unposted movements to restamp, by the role they carry now. */
  restamps: { fromRole: string; movementIds: string[] }[]
  unpostedCount: number
  /** Posted drifted movements whose value the books still hold in the old role. */
  postedCount: number
  /** The correcting entry; empty when the books already match. */
  correction: AccountCorrectionLeg[]
  /** Every role a drifted movement carries, for the copy. */
  fromRoles: string[]
}

/** The inventory role the part's current kind maps to; null for a service, which has none. */
export function expectedInventoryRole(kind: string | null | undefined): string | null {
  if (kind && isServicePartKind(kind)) return null
  return resolveInventoryRoleForPartKind(kind)
}

/**
 * Split one part's drifted movements into restamps and a correcting entry. Posted rows keep their
 * stamp; `fixedByRole` is what earlier fix entries already moved, so a re-run corrects only the
 * rest and a kind changed back unwinds an earlier fix.
 */
export function planPartAccountDrift(input: {
  expectedRole: string
  movements: readonly DriftedMovement[]
  fixedByRole?: ReadonlyMap<string, number>
}): PartAccountDriftPlan {
  const { expectedRole, movements } = input
  const restampsByRole = new Map<string, string[]>()
  const booked = new Map<string, number>()
  const fromRoles = new Set<string>()
  let postedCount = 0

  for (const movement of movements) {
    if (movement.role === expectedRole) continue
    fromRoles.add(movement.role)
    if (movement.posted) {
      postedCount++
      const minor = Math.round(movement.extendedCostMinor ?? 0)
      booked.set(movement.role, (booked.get(movement.role) ?? 0) + minor)
    } else {
      const ids = restampsByRole.get(movement.role) ?? []
      ids.push(movement.id)
      restampsByRole.set(movement.role, ids)
    }
  }
  for (const [role, minor] of input.fixedByRole ?? []) {
    booked.set(role, (booked.get(role) ?? 0) + minor)
  }

  const correction: AccountCorrectionLeg[] = []
  let moved = 0
  for (const [role, minor] of [...booked].sort(([a], [b]) => a.localeCompare(b))) {
    if (role === expectedRole || minor === 0) continue
    correction.push({ role, amountMinor: -minor })
    moved += minor
  }
  if (moved !== 0) correction.push({ role: expectedRole, amountMinor: moved })

  const restamps = [...restampsByRole].map(([fromRole, movementIds]) => ({
    fromRole,
    movementIds,
  }))
  return {
    expectedRole,
    restamps,
    unpostedCount: restamps.reduce((sum, r) => sum + r.movementIds.length, 0),
    postedCount: correction.length > 0 ? postedCount : 0,
    correction,
    fromRoles: [...fromRoles].sort(),
  }
}
