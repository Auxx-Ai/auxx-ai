// packages/lib/src/files/remote-image/fetch-record-image.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { FieldValueService } from '../../field-values/field-value-service'
import { quietSession } from '../../resources/crud/write-origin'
import { toRecordId } from '../../resources/resource-id'
import { SystemUserService } from '../../users/system-user-service'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import { fetchAndStoreRemoteImage, isRetryableFetchError } from '../fetch-remote-image'
import type { FetchRecordImageJobData } from './enqueue'

const logger = createScopedLogger('files:remote-image')

const ORG_WINDOW_LIMIT = 500
const ORG_WINDOW_MS = 60 * 60 * 1000

const QUIET_CONNECTOR_IMAGE = quietSession(
  'connector image fetch — machine-derived copy of a source image URL, not a user edit'
)

export type FetchRecordImageOutcome =
  | { outcome: 'written'; assetId: string }
  | { outcome: 'skipped'; why: 'unchanged' | 'record-gone' | 'archived' }
  | { outcome: 'deferred'; retryInMs: number }
  | { outcome: 'failed'; reason: string }

/**
 * Download a connector-sourced image URL into the record's FILE field as
 * `[{ ref, sourceUrl }]`. `err` means a transient failure the caller should retry.
 */
export async function fetchRecordImage(
  db: Database,
  input: FetchRecordImageJobData
): Promise<Result<FetchRecordImageOutcome, Error>> {
  const { organizationId, entityDefinitionId, instanceId, fieldId, url } = input

  const instance = await db.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, instanceId),
      eq(schema.EntityInstance.organizationId, organizationId)
    ),
    columns: { archivedAt: true },
  })
  if (!instance) return ok({ outcome: 'skipped', why: 'record-gone' })
  if (instance.archivedAt) return ok({ outcome: 'skipped', why: 'archived' })

  const rows = await db
    .select({ valueJson: schema.FieldValue.valueJson })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, instanceId),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
  if (rows.some((row) => sourceUrlOf(row.valueJson) === url)) {
    return ok({ outcome: 'skipped', why: 'unchanged' })
  }

  const { allowed, remainingMs } = await checkFixedWindowLimit({
    key: `remote-image:org:${organizationId}`,
    limit: ORG_WINDOW_LIMIT,
    windowMs: ORG_WINDOW_MS,
  })
  if (!allowed) return ok({ outcome: 'deferred', retryInMs: remainingMs ?? ORG_WINDOW_MS })

  const userId = await SystemUserService.getSystemUserForActions(organizationId)

  let stored: Awaited<ReturnType<typeof fetchAndStoreRemoteImage>>
  try {
    stored = await fetchAndStoreRemoteImage({
      db,
      url,
      organizationId,
      userId,
      pathPrefix: 'connector-images',
      purpose: 'connector-image',
      name: fileNameOf(url),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (isRetryableFetchError(error)) {
      return err(error instanceof Error ? error : new Error(reason))
    }
    logger.warn('Connector image fetch gave up', {
      orgId: organizationId,
      recordId: instanceId,
      url,
      reason,
    })
    return ok({ outcome: 'failed', reason })
  }

  const service = new FieldValueService(organizationId, userId, db, undefined, {
    session: QUIET_CONNECTOR_IMAGE,
  })
  try {
    await service.setValuesForEntity({
      recordId: toRecordId(entityDefinitionId, instanceId),
      values: [{ fieldId, value: [{ ref: stored.ref, sourceUrl: url }] }],
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }

  return ok({ outcome: 'written', assetId: stored.assetId })
}

/** FILE values are stored wrapped (`{ v: { ref, sourceUrl } }`); tolerate the bare shape too. */
function sourceUrlOf(valueJson: unknown): string | null {
  if (!valueJson || typeof valueJson !== 'object') return null
  const inner = (valueJson as { v?: unknown }).v ?? valueJson
  if (!inner || typeof inner !== 'object') return null
  const sourceUrl = (inner as { sourceUrl?: unknown }).sourceUrl
  return typeof sourceUrl === 'string' ? sourceUrl : null
}

function fileNameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last).slice(0, 200) : 'image'
  } catch {
    return 'image'
  }
}
