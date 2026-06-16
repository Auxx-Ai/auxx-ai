// packages/lib/src/chat/visit-fields.ts

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { FieldValueService } from '../field-values/field-value-service'
import type { ServiceContext, VisitInfo } from './types'

const log = createScopedLogger('chat-visit-fields')

/**
 * Thread visit systemAttribute → `VisitInfo` key. These map onto the
 * FieldValue-backed `visit_*` thread fields defined in `thread-fields.ts`
 * (keyed by `thread.id`, like `thread_tags`).
 */
const VISIT_FIELDS = [
  ['visit_ip', 'ipAddress'],
  ['visit_user_agent', 'userAgent'],
  ['visit_referrer', 'referrer'],
  ['visit_url', 'url'],
  ['visit_city', 'city'],
  ['visit_region', 'region'],
  ['visit_country', 'country'],
  ['visit_timezone', 'timezone'],
] as const satisfies ReadonlyArray<readonly [SystemAttribute, keyof VisitInfo]>

/**
 * Write/overwrite a thread's visit fields from a `VisitInfo` snapshot.
 *
 * Single-value `setValuesForEntity` is last-write-wins (DELETE+INSERT), so on
 * resume this just overwrites with the latest visit. Best-effort — a failure
 * must never block chat session init/resume (mirrors the geo lookup in
 * `passport.ts`). No-ops silently before the visit fields are seeded into the
 * org (resolveFieldIds simply won't find the systemAttribute).
 */
export async function writeThreadVisitFields(
  ctx: ServiceContext,
  threadId: string,
  visit: VisitInfo | undefined
): Promise<void> {
  if (!visit) return
  try {
    // Trusted system write — these fields are read-only to users (display layer)
    // but the chat runtime must be able to set/patch them.
    const svc = new FieldValueService(ctx.organizationId, undefined, ctx.db, undefined, {
      bypassFieldGuards: new Set(VISIT_FIELDS.map(([attr]) => attr)),
    })

    // `setValuesForEntity` resolves each systemAttribute string to its real
    // fieldId internally, so we can key by systemAttribute directly.
    const values = VISIT_FIELDS.flatMap(([systemAttribute, visitKey]) => {
      const value = visit[visitKey]
      if (value == null || value === '') return []
      return [{ fieldId: systemAttribute, value }]
    })
    if (values.length === 0) return

    await svc.setValuesForEntity({ recordId: toRecordId('thread', threadId), values })
  } catch (err) {
    log.warn('Failed to write thread visit fields', {
      threadId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
