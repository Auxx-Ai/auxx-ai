// packages/lib/src/builds/backfill-preflight.ts

/**
 * What a `completed` backfill would write, computed before anything is written.
 *
 * `plans/money/tasks/44-auto-build-cutoff-and-backfill.md` §7.3 gates 2, 3 and 4.
 *
 * The consent a completed run asks for is *"N builds, M stock movements, on an
 * append-only ledger correctable only by reversing"*, and both numbers have to
 * be real or the sentence is theatre. `completeBuild` also aborts per build when
 * a component has no `part_standard_cost`, and discovering that on build 400 of
 * 900 is the wrong time to discover it.
 *
 * ## Why this lives in lib, and did not
 *
 * ⚠️ It was composed in `routers/builds.ts` for the whole of 44's build, from
 * `explodeBuildComponents` and `readPartQuantitiesOnHand`, because gates 3 and 4
 * need component-level data the `BackfillPlan` contract does not carry. 44 §11.3
 * recorded that as misplaced rather than wrong, and 45 §5 carried it forward:
 * per `docs/lib-module-guide.md` §6 a router asserts and calls, and arithmetic
 * this load-bearing belongs where it can be unit tested without a tRPC caller.
 *
 * ## 🛑 Gate 4 is a WARNING's input, never a gate's
 *
 * Negative projected on hand is a true statement about a ledger missing its
 * receipts, and refusing on it would make the backfill unusable on exactly the
 * organization that needs it most: one importing history it never had stock
 * records for. The remedy is opening stock, and that is the person's call to
 * make first. This function therefore REPORTS and never refuses.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { readPartQuantitiesOnHand } from './auto-build-queries'
import type { BackfillPlan, BackfillPreflight } from './backfill-types'
import { explodeBuildComponents, readPartNames } from './build-queries'
import { guard } from './guard'

/**
 * Explode every part in the plan and total what the run would consume.
 *
 * ⚠️ **Exploded once per part at its WHOLE range quantity, not once per bucket.**
 * Component quantities are linear in the produced quantity, so the total is
 * identical either way and a twenty-part plan costs twenty round trips instead
 * of ninety-four.
 *
 * @param plan what the run would raise, from `planBackfill`.
 * @returns the counts and the two lists, or `err` when a part cannot be
 *   exploded. Unlike `executeBackfill` this one DOES fail as a whole: it writes
 *   nothing, and a preflight that silently omitted a part would under-report the
 *   consent it exists to obtain.
 */
export async function computeBackfillPreflight(
  db: Database,
  organizationId: string,
  plan: BackfillPlan
): Promise<Result<BackfillPreflight, Error>> {
  return guard(
    async () => {
      let movementCount = 0
      const unpriced = new Set<string>()
      const consumed = new Map<string, number>()

      const explosions = await Promise.all(
        plan.parts.map((part) =>
          explodeBuildComponents(db, organizationId, {
            partId: part.partId,
            quantityProduced: part.quantityToBuild,
          })
        )
      )

      for (const [index, explosion] of explosions.entries()) {
        const part = plan.parts[index]
        if (!part) continue
        if (explosion.isErr()) throw explosion.error
        const components = explosion.value.components
        // One `build_produce` per build, plus one `build_consume` per component
        // per build. The component set is the same for every bucket of a part.
        movementCount += part.buckets.length * (components.length + 1)
        for (const missing of explosion.value.missingStandardPartIds) unpriced.add(missing)
        for (const line of components) {
          consumed.set(line.partId, (consumed.get(line.partId) ?? 0) + line.quantityConsumed)
        }
      }

      const componentIds = [...consumed.keys()]
      const [onHand, names] = await Promise.all([
        readPartQuantitiesOnHand(db, organizationId, componentIds),
        readPartNames(db, organizationId, [...componentIds, ...unpriced]),
      ])

      return {
        buildCount: plan.buildCount,
        movementCount,
        unpricedParts: [...unpriced].map((partId) => ({
          partId,
          partName: names.get(partId) ?? null,
        })),
        projectedOnHand: componentIds
          .map((partId) => {
            const available = onHand.get(partId) ?? 0
            const used = consumed.get(partId) ?? 0
            return {
              partId,
              partName: names.get(partId) ?? null,
              onHand: available,
              consumed: used,
              projected: available - used,
            }
          })
          // Worst first: the rows that matter are the ones the run drives negative.
          .sort((a, b) => a.projected - b.projected),
      }
    },
    'Failed to compute the backfill preflight',
    { organizationId, parts: plan.parts.length }
  )
}
