// packages/lib/src/import/resolution/materialize-file-fetches.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { fetchAndStoreRemoteImage, isRetryableFetchError } from '../../files/fetch-remote-image'
import { calculateStorageUsage, UNLIMITED } from '../../files/lifecycle/quota-cleanup'
import type { ResolvedValue } from '../types/resolution'
import { retryWithBackoff } from '../utils/retry-with-backoff'
import { loadPendingFileFetches, type PendingFileFetchRow } from './get-file-fetch-counts'
import { type ResolutionRowWriteById, updateResolutionsById } from './write-resolution-rows'

const logger = createScopedLogger('materialize-file-fetches')

/** Downloads in flight per job; the import worker runs 2 jobs, so ≤ 8 per process. */
const CONCURRENCY = 4

/** URLs downloaded between write-backs, so a crashed attempt does not re-download them on retry. */
const WRITE_BACK_EVERY = 25

/** Progress of one job's image downloads, by distinct URL */
export interface FileFetchProgress {
  downloaded: number
  failed: number
  total: number
}

/** Options for {@link materializeFileFetches} */
export interface MaterializeFileFetchesOptions {
  organizationId: string
  jobId: string
  /** Recorded as the `MediaAsset` creator */
  userId: string
  onProgress?: (progress: FileFetchProgress) => void | Promise<void>
}

/** Outcome of materializing one job's pending image downloads */
export interface MaterializeFileFetchesResult extends FileFetchProgress {
  /** Bytes stored across every downloaded image */
  bytes: number
}

/**
 * Download every distinct `file:url` image of a job into a `MediaAsset`, then rewrite its
 * resolutions to `{ ref, sourceUrl }` (or to an error the executor turns into a row warning).
 *
 * Runs at execution start, before `getAllJobResolutions`, so an abandoned wizard leaves no assets.
 */
export async function materializeFileFetches(
  db: Database,
  options: MaterializeFileFetchesOptions
): Promise<MaterializeFileFetchesResult> {
  const { organizationId, jobId, userId, onProgress } = options

  const pending = await loadPendingFileFetches(db, jobId)
  if (pending.length === 0) return { downloaded: 0, failed: 0, total: 0, bytes: 0 }

  const rowsByUrl = new Map<string, PendingFileFetchRow[]>()
  for (const row of pending) {
    const rows = rowsByUrl.get(row.url)
    if (rows) rows.push(row)
    else rowsByUrl.set(row.url, [row])
  }
  const urls = [...rowsByUrl.keys()]

  // One SUM query up front; each fetch then skips its own quota check.
  const usage = await calculateStorageUsage({ db, organizationId })
  let used = usage.totalUsed
  const limit = usage.quotaLimit
  // Checked before each fetch, so concurrent downloads can overshoot by at most CONCURRENCY images.
  const overQuota = () => limit !== UNLIMITED && used >= limit

  const progress: FileFetchProgress = { downloaded: 0, failed: 0, total: urls.length }
  let bytes = 0
  let buffer: ResolutionRowWriteById[] = []
  let sinceFlush = 0

  const flush = async () => {
    const writes = buffer
    buffer = []
    sinceFlush = 0
    await updateResolutionsById(db, writes)
    await onProgress?.({ ...progress })
  }

  const record = (url: string, write: Omit<ResolutionRowWriteById, 'id'>) => {
    for (const row of rowsByUrl.get(url) ?? []) buffer.push({ id: row.resolutionId, ...write })
    sinceFlush++
  }

  const handle = async (url: string) => {
    try {
      if (overQuota()) throw new Error('Storage limit reached')
      const result = await retryWithBackoff(
        () =>
          fetchAndStoreRemoteImage({
            db,
            url,
            organizationId,
            userId,
            pathPrefix: 'import-images',
            purpose: 'import-image',
            name: nameFromUrl(url),
            skipQuotaCheck: true,
          }),
        { maxAttempts: 3, initialDelayMs: 500, isRetryable: isRetryableFetchError }
      )
      used += result.size
      bytes += result.size
      progress.downloaded++
      record(url, {
        status: 'valid',
        resolvedValues: [
          { type: 'value', value: { ref: result.ref, sourceUrl: url } },
        ] satisfies ResolvedValue[],
        isValid: true,
        errorMessage: null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      progress.failed++
      record(url, {
        status: 'error',
        resolvedValues: [{ type: 'error', error: message }] satisfies ResolvedValue[],
        isValid: false,
        errorMessage: message,
      })
    }
    if (sinceFlush >= WRITE_BACK_EVERY) await flush()
  }

  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]!
      await handle(url)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  await flush()

  logger.info('Materialized import image downloads', { jobId, ...progress, bytes })
  return { ...progress, bytes }
}

/** `MediaAsset.name` from the URL's last path segment. */
function nameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment).slice(0, 200) : 'image'
  } catch {
    return 'image'
  }
}
