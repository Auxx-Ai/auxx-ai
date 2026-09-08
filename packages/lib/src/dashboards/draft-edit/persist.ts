// packages/lib/src/dashboards/draft-edit/persist.ts

/**
 * The ONE seam through which every draft-edit mutation writes a dashboard's
 * layout (`plans/dashboard/v3/01-draft-edit-module.md` §5). SERVER-ONLY.
 *
 * {@link persistLayout} CALLS {@link saveDraft} rather than writing the
 * `Dashboard` row itself, for the same reason `graph-edit/persist.ts` goes
 * through `WorkflowService.update`: everything `saveDraft` already does on a
 * write (draft-schema validation, the `hasUnpublishedChanges` reconciliation
 * against the active version's `configHash`) has to keep happening, and there
 * must not be a second row-writer to keep in sync.
 *
 * THE SEAM: the Redis turn snapshot (`turn-snapshot.ts`) is captured BEFORE
 * this write and the `dashboard:draft-updated` signal
 * ({@link publishDraftUpdatedSignal}) fires AFTER it. Both wrap
 * {@link persistLayout} in the mutation pipeline and in the turn-revert path,
 * never inside it, so a non-pipeline caller keeps a bare persist.
 *
 * TWO HASHES, and confusing them is the easy mistake here. `configHash`
 * (inside `saveDraft`) answers "does the draft differ from what is published"
 * and drives the dirty pill. `layoutHash` answers "did the draft move under
 * me" and is the CAS token. They are computed by the same function over
 * different documents and mean entirely different things.
 *
 * No permission checks live here (house rule).
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import type { DashboardLayoutDoc } from '../client'
import { saveDraft } from '../version-mutations'
import type { DashboardEditScope } from './types'

/** What a mutation hands the persist seam. */
export interface PersistLayoutInput {
  doc: DashboardLayoutDoc
  /**
   * CAS token from `loadDraftContext`. A save landing between that load and
   * this write comes back as a `ConflictError` telling the caller to re-read
   * and retry, instead of silently winning. Omitting it is last-write-wins and
   * is only correct for a caller that has no prior read to be stale against.
   */
  expectedLayoutHash?: string
}

/** What the persist wrote. `layoutHash` chains into the next mutation's CAS. */
export interface PersistLayoutOutcome {
  layoutHash: string
  hasUnpublishedChanges: boolean
}

/**
 * Persist a mutated draft layout. Callers must have validated the doc first
 * (structural errors reject before this runs) and asserted
 * `assertEditInstance('dashboard', id)` at the router or capability layer.
 *
 * The draft-schema rejection and the hash-CAS both surface as
 * `err(AuxxError)`, never swallowed.
 */
export async function persistLayout(
  db: Database,
  scope: DashboardEditScope,
  input: PersistLayoutInput
): Promise<Result<PersistLayoutOutcome, AuxxError>> {
  const saved = await saveDraft(db, scope.organizationId, scope.dashboardId, input.doc, {
    ...(input.expectedLayoutHash !== undefined
      ? { expectedLayoutHash: input.expectedLayoutHash }
      : {}),
  })
  if (saved.isErr()) {
    const error = saved.error
    if (error instanceof AuxxError) return err(error)
    return err(new UnprocessableEntityError(`Failed to save the dashboard draft: ${error.message}`))
  }
  return ok({
    layoutHash: saved.value.layoutHash,
    hasUnpublishedChanges: saved.value.hasUnpublishedChanges,
  })
}

/**
 * Fire the `dashboard:draft-updated` refresh signal on the org channel AFTER a
 * successful persist. Signal only: an open dashboard refetches and adopts the
 * draft, and nothing in the payload is applied directly
 * (`feedback_builder_ui_refresh_via_realtime`). Fire-and-forget, so a realtime
 * hiccup never fails a mutation that already persisted.
 *
 * The realtime barrel is LAZY-imported on purpose: statically importing it
 * breaks `vi.mock` at collection as the module graph grows
 * (`project_realtime_barrel_import_cycle`). Same reason `graph-edit/persist.ts`
 * does it.
 */
export async function publishDraftUpdatedSignal(
  organizationId: string,
  data: { dashboardId: string; widgetIds?: string[]; reason: 'kopilot' | 'system' }
): Promise<void> {
  try {
    const { getRealtimeService, publishDashboardDraftUpdated } = await import('../../realtime')
    await publishDashboardDraftUpdated(getRealtimeService(), organizationId, data)
  } catch {
    // Fire-and-forget: the draft write already succeeded.
  }
}
