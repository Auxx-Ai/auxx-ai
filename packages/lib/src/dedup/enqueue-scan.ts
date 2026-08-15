// packages/lib/src/dedup/enqueue-scan.ts
//
// The enqueue side of the coalesced scan. There is exactly ONE scan job
// (`duplicateScanJob`) and four doors into it; this module owns two of them —
// the mutation seam and the sync-manifest consumer — and the ONLY thing that
// distinguishes them is the jobId and the delay.
//
// Queue modules are imported DYNAMICALLY (the `enqueue-scheduled-message-job`
// idiom): `jobs/queues` pulls in bullmq + the Redis connection, and a static
// import would drag both into every module that merely writes a record.

/** BullMQ job name. Must match the `jobMappings` key in `maintenance-worker.ts`. */
export const DUPLICATE_SCAN_JOB_NAME = 'duplicateScanJob'

/**
 * How long a mutation-seam scan waits in the delayed set before it runs.
 *
 * This delay IS the burst absorber. BullMQ collapses a repeated `add` with the
 * same jobId while the job is still delayed, so a first-connect mailbox sync
 * creating hundreds of contacts through `findOrCreate` yields ONE job rather
 * than one per contact.
 */
export const DUPLICATE_SCAN_DELAY_MS = 45_000

/** Scope for one `duplicateScanJob` — see `jobs/dedup/duplicate-scan-job.ts`. */
interface ScanJobData {
  organizationId?: string
  entityDefinitionId?: string
  recordIds?: string[]
  dryRun?: boolean
}

async function addScanJob(
  data: ScanJobData,
  opts: { jobId: string; delay: number }
): Promise<string | undefined> {
  const { getQueue } = await import('../jobs/queues')
  const { Queues } = await import('../jobs/queues/types')

  const job = await getQueue(Queues.maintenanceQueue).add(DUPLICATE_SCAN_JOB_NAME, data, {
    jobId: opts.jobId,
    delay: opts.delay,
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: false,
  })
  return job.id
}

/**
 * Enqueue a coalesced duplicate scan for one (organization, entity definition).
 *
 * **No recordId is passed, deliberately.** The handler is watermark-driven — it
 * finds every record in the definition whose
 * `GREATEST(updatedAt, max(FieldValue.updatedAt))` has moved past
 * `lastDuplicateScanAt` — so the seam stays a two-argument fire-and-forget and a
 * burst of writes collapses onto ONE delayed job under the org+def jobId.
 *
 * A per-record jobId (the shape the first design used) only dedupes re-writes of
 * the *same* record. Ingest fires the mutation seam live even during a backfill,
 * so an initial mailbox sync would enqueue one job per created contact. Org+def
 * coalescing absorbs any burst source without threading batch-awareness through
 * the CRUD seam; the cost is that a single interactive edit runs the indexed
 * watermark query instead of a direct-recordId scan — milliseconds.
 *
 * **Known race, accepted:** BullMQ drops a same-jobId `add` while the job is
 * already *running* (only the delayed state coalesces), so records dirtied
 * mid-run wait for the next trigger or the 6h sweep. The watermark guarantees
 * they are delayed, never lost.
 *
 * Call it fire-and-forget off the write path — a scan must never be able to fail
 * a mutation:
 *
 * @example
 * ```typescript
 * enqueueDuplicateScan(orgId, entityDefinitionId).catch(() => {})
 * ```
 */
export async function enqueueDuplicateScan(
  organizationId: string,
  entityDefinitionId: string
): Promise<string | undefined> {
  return addScanJob(
    { organizationId, entityDefinitionId },
    {
      jobId: `dup-scan:${organizationId}:${entityDefinitionId}`,
      delay: DUPLICATE_SCAN_DELAY_MS,
    }
  )
}

/**
 * How long a continuation waits — short, because there is a known backlog to
 * drain rather than a burst to absorb.
 */
export const DUPLICATE_SCAN_CONTINUATION_DELAY_MS = 5_000

/**
 * Continue a scan that hit its per-definition record cap.
 *
 * The watermark query is oldest-dirty-first and bounded, so in a definition with
 * more than `RECORDS_PER_DEFINITION` dirty records a freshly created record
 * sorts LAST and would wait for the next write or the 6h sweep. The handler
 * therefore requeues itself, and the backlog drains in bounded chunks.
 *
 * 🔴 **A different jobId from {@link enqueueDuplicateScan}, and the cursor is
 * part of it.** The org+def jobId is held by the job that is currently RUNNING —
 * BullMQ drops a same-jobId `add` in that state, so reusing it would make this
 * call a silent no-op, which is exactly the bug being fixed. Keying on the
 * watermark the tick stopped at makes each continuation distinct while still
 * collapsing a redundant re-add at the same position.
 */
export async function enqueueDuplicateScanContinuation(
  organizationId: string,
  entityDefinitionId: string,
  cursor: string
): Promise<string | undefined> {
  return addScanJob(
    { organizationId, entityDefinitionId },
    {
      jobId: `dup-scan:cont:${organizationId}:${entityDefinitionId}:${cursor}`,
      delay: DUPLICATE_SCAN_CONTINUATION_DELAY_MS,
    }
  )
}

/** Parameters for {@link enqueueDuplicateScanForRecords}. */
export interface EnqueueScanForRecordsParams {
  organizationId: string
  /** `RecordId`s (`entityDefinitionId:instanceId`) — the handler groups them per definition. */
  recordIds: string[]
  /**
   * Stable per-RUN id — `runId` for a connector sync, `importRef` for a CSV
   * import. This is what makes a redelivered pointer event a no-op.
   */
  scopeKey: string
}

/**
 * Enqueue the scan for an explicit set of records — the `sync:records:changed`
 * manifest door (connector runs and CSV imports, which write with `skipEvents`
 * and therefore never reach the mutation seam).
 *
 * Runs with no delay: the manifest is published at the END of a run, so there is
 * no burst left to absorb and the whole point of this door is that a connector
 * record's pairs appear right after its run rather than up to 6h later.
 *
 * `jobId: 'dup-scan:{runId|importRef}'` gives at-most-once per run. That is the
 * ONLY idempotency this door needs — the dedup consumer must never `claim` the
 * manifest, because the claim is the record-rules consumer's once-only latch and
 * a second claimant would starve it. Pair upserts are idempotent anyway, so a
 * duplicate delivery that slips past the jobId is harmless.
 */
export async function enqueueDuplicateScanForRecords(
  params: EnqueueScanForRecordsParams
): Promise<string | undefined> {
  const { organizationId, recordIds, scopeKey } = params
  if (recordIds.length === 0) return undefined

  return addScanJob({ organizationId, recordIds }, { jobId: `dup-scan:${scopeKey}`, delay: 0 })
}
