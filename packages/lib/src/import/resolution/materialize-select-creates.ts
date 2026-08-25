// packages/lib/src/import/resolution/materialize-select-creates.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { mintOrMatchOptions } from '../../custom-fields/mint-options'
import { optionMatchKey } from '../../resources/registry/option-helpers'
import type { ResolvedValue } from '../types/resolution'
import {
  groupSelectCreates,
  loadPendingSelectCreates,
  type PendingSelectCreateRow,
} from './get-select-create-counts'
import { type ResolutionRowWriteById, updateResolutionsById } from './write-resolution-rows'

const logger = createScopedLogger('materialize-select-creates')

/** Options for {@link materializeSelectCreates} */
export interface MaterializeSelectCreatesOptions {
  organizationId: string
  /** Import job whose `status: 'create'` option resolutions should be minted */
  jobId: string
}

/** A label that could not become an option, with the reason */
export interface SelectCreateFailure {
  /** `CustomField.id`, or null when the column's field could not be resolved */
  fieldId: string | null
  /** The column's `targetFieldKey`, always present for the message */
  targetFieldKey: string
  /** The label that was refused */
  value: string
  error: string
}

/** Outcome of materializing one job's pending option creates */
export interface MaterializeSelectCreatesResult {
  /** Distinct options actually appended */
  created: number
  /** Appended options per grown field, keyed by `CustomField.id` */
  byField: Record<string, number>
  /** Distinct labels that could not be minted, with the reason */
  failures: SelectCreateFailure[]
}

/**
 * Append the option labels that `select:create` deferred, then rewrite their
 * resolutions to point at the resulting option keys.
 *
 * Call this ONCE, at the start of execution, BEFORE `getAllJobResolutions` loads
 * the map the executor builds rows from — the same two-phase lifecycle
 * `materializeRelationCreates` uses, and for the same reason: a user who
 * abandons the wizard at the preview must not be left with a taxonomy full of
 * options nothing references.
 *
 * Until this existed, `select:create` resolved, wrote `status: 'create'`, and
 * was then consumed by nobody: `buildRecordData` passed the raw LABEL through to
 * the write path, which stored it as an `optionId` belonging to no option. Every
 * such value read back as an unknown chip.
 *
 * Exactly one option is minted per distinct folded label per field, so two
 * columns naming "Steel" grow the field once. Re-running is a no-op: every row
 * it succeeds on is left `status: 'valid'` and no longer loads.
 *
 * 🛑 The write goes through {@link mintOrMatchOptions}, never `updateCustomField`
 * — that path REPLACES the option array and cascade-deletes the `FieldValue`
 * rows of every key that left the list, so sending only the additions would
 * destroy every existing value of the field.
 *
 * A field that fails the authority gate fails ITS rows, not the import. The
 * relation materializer throws instead, because a dropped LINK produces a row
 * that looks complete and is not; a refused option is visible as a row error and
 * the other columns still import.
 *
 * @param db - Database instance
 * @param options - Job and org
 * @returns What was created and what could not be
 */
export async function materializeSelectCreates(
  db: Database,
  options: MaterializeSelectCreatesOptions
): Promise<MaterializeSelectCreatesResult> {
  const { organizationId, jobId } = options

  const pending = await loadPendingSelectCreates(db, jobId)
  if (pending.length === 0) {
    return { created: 0, byField: {}, failures: [] }
  }

  const { groups, rejected } = await groupSelectCreates(organizationId, pending)

  const byField: Record<string, number> = {}
  const failures: SelectCreateFailure[] = []
  const writes: ResolutionRowWriteById[] = []
  // `(field, folded label)` already reported. A set rather than a scan of
  // `failures`, because a whole column can fail and the scan would be quadratic
  // in the number of distinct labels.
  const reported = new Set<string>()
  const fail = (fieldId: string | null, row: PendingSelectCreateRow, reason: string) =>
    pushFailure({ writes, failures, reported }, fieldId, row, reason)
  let created = 0

  for (const group of groups) {
    try {
      // ONE call per field, carrying every label the whole job wants. The minter
      // takes a row lock on the `CustomField` row and re-reads the option list
      // under it, so a per-label call would be one lock acquisition per label
      // for a single outcome.
      const result = await mintOrMatchOptions(db, {
        fieldId: group.fieldId,
        organizationId,
        labels: group.labels,
      })
      // The ids come back positionally against the labels that were accepted.
      // `groupSelectCreates` already folds and dedupes them exactly the way the
      // minter does, so nothing should ever be dropped — but a silent shift here
      // would write real option keys onto the WRONG rows, which is worse than a
      // row error, so the invariant is checked rather than trusted.
      if (result.ids.length !== group.labels.length) {
        throw new Error('Option keys did not line up with the labels they were minted from')
      }

      const keyByLabel = new Map<string, string>()
      group.labels.forEach((label, index) => {
        const key = result.ids[index]
        if (key) keyByLabel.set(optionMatchKey(label), key)
      })

      created += result.minted
      if (result.minted > 0) byField[group.fieldId] = result.minted

      for (const row of group.rows) {
        const key = keyByLabel.get(optionMatchKey(row.label))
        if (!key) {
          fail(group.fieldId, row, 'The option could not be resolved.')
          continue
        }
        writes.push({
          id: row.resolutionId,
          status: 'valid',
          resolvedValues: [{ type: 'value', value: key }] satisfies ResolvedValue[],
          isValid: true,
          errorMessage: null,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to mint import select options', {
        jobId,
        fieldId: group.fieldId,
        labels: group.labels.length,
        error: message,
      })
      for (const row of group.rows) fail(group.fieldId, row, message)
    }
  }

  for (const bucket of rejected) {
    for (const row of bucket.rows) fail(null, row, bucket.reason)
  }

  // ONE batched write for every group and every rejection. Bucketing per field
  // is not enough on its own: a file naming 3k new tags in one column is one
  // bucket but 3k rows, and a job spreading them over six fields is six. Both
  // flatten to the same keyed list here, so the statement count is
  // ceil(rows / 500) however the outcomes distribute.
  await updateResolutionsById(db, writes)

  logger.info('Materialized select option creates', {
    jobId,
    created,
    failures: failures.length,
  })
  return { created, byField, failures }
}

/** The three accumulators {@link pushFailure} appends to. */
interface FailureSink {
  writes: ResolutionRowWriteById[]
  failures: SelectCreateFailure[]
  /** `(field, folded label)` pairs already present in `failures` */
  reported: Set<string>
}

/**
 * Record one row as an error resolution, and the label behind it as a failure.
 *
 * The row becomes `{ type: 'error' }` rather than keeping the raw label, because
 * the label was never a valid `optionId` — leaving it in place would put back
 * exactly the orphan value this whole function exists to prevent.
 *
 * The failure list is deduped per `(field, folded label)`, so a reason reported
 * once covers the 500 rows that share it, while the write list keeps one entry
 * per row because every row has to be rewritten.
 */
function pushFailure(
  sink: FailureSink,
  fieldId: string | null,
  row: PendingSelectCreateRow,
  reason: string
): void {
  const error = `Could not create option "${row.label}": ${reason}`
  sink.writes.push({
    id: row.resolutionId,
    status: 'error',
    resolvedValues: [{ type: 'error', error }] satisfies ResolvedValue[],
    isValid: false,
    errorMessage: error,
  })
  const key = `${fieldId ?? ''}::${optionMatchKey(row.label)}`
  if (sink.reported.has(key)) return
  sink.reported.add(key)
  sink.failures.push({ fieldId, targetFieldKey: row.targetFieldKey, value: row.label, error })
}
