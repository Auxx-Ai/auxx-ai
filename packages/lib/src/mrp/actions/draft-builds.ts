// packages/lib/src/mrp/actions/draft-builds.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { createBuild } from '../../inventory/builds/build-mutations'
import { createGuard } from '../../utils/guard'
import {
  type ActionRefusal,
  positiveQuantity,
  readActionItems,
  resolveActionRun,
  runNote,
  uniqueByPart,
} from './shared'

const guard = createGuard('mrp:draft-builds')

export interface DraftBuildsInput {
  /** Defaults to the latest completed run. */
  runId?: string
  /** `quantity` overrides the run's `suggestedQty`. */
  items: Array<{ partId: string; quantity?: number }>
}

export interface DraftBuildsResult {
  runId: string
  created: Array<{ partId: string; buildId: string }>
  refused: ActionRefusal[]
}

/**
 * One planned build per selected made part, through `createBuild` as the requesting user.
 * A refused part is reported in `refused` and never stops the others (08 §4).
 */
export async function draftBuilds(
  db: Database,
  organizationId: string,
  userId: string,
  input: DraftBuildsInput
): Promise<Result<DraftBuildsResult, Error>> {
  return guard(
    async () => {
      const run = await resolveActionRun(db, organizationId, input.runId)
      const selected = uniqueByPart(input.items)
      const items = await readActionItems(
        db,
        organizationId,
        run.id,
        selected.map((s) => s.partId)
      )

      const result: DraftBuildsResult = { runId: run.id, created: [], refused: [] }
      for (const pick of selected) {
        const item = items.get(pick.partId)
        if (!item) {
          result.refused.push({ partId: pick.partId, reason: 'Not planned in this MRP run' })
          continue
        }
        if (item.suggestionKind !== 'build') {
          result.refused.push({ partId: pick.partId, reason: 'The run does not suggest a build' })
          continue
        }
        const quantity = positiveQuantity(pick.quantity ?? item.suggestedQty)
        if (quantity === null) {
          result.refused.push({ partId: pick.partId, reason: 'No quantity to build' })
          continue
        }

        const created = await createBuild(db, organizationId, userId, {
          partId: pick.partId,
          quantityPlanned: quantity,
          notes: runNote(run, [pick.partId]),
          source: 'manual',
        })
        if (created.isErr()) {
          result.refused.push({ partId: pick.partId, reason: created.error.message })
          continue
        }
        result.created.push({ partId: pick.partId, buildId: created.value.buildId })
      }
      return result
    },
    'Failed to draft MRP builds',
    { organizationId, runId: input.runId, items: input.items.length }
  )
}
