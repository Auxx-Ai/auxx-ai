// packages/lib/src/returns/evidence-pack-build.ts

/**
 * The document registry's entry point for the chargeback evidence pack
 * (plans/money/tasks/54-returns.md section 7).
 *
 * Three lines of orchestration and nothing else: read the sources, resolve the
 * contact and the org's document settings, hand both to the pure assembly in
 * `evidence-pack-payload.ts`, and hash the result for the render-or-reuse
 * cache.
 *
 * It lives apart from the assembly on purpose. `documents/payload.ts`,
 * `resources/crud` and the org cache are heavy server-only graphs, and the
 * assembly is the part worth testing - keeping it in a module whose every
 * import is type-only is what lets the six sections and the sentences they
 * assert be covered without a fixture organization.
 */

import { stableHash } from '@auxx/utils/hash'
import { getOrgCache } from '../cache'
import { loadPdfContact } from '../documents/payload'
import { resolveDocumentSettings } from '../documents/resolve-settings'
import { NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud'
import { parseRecordId, type RecordId } from '../resources/resource-id'
import { defaultEvidenceDatabase } from './evidence-pack-database'
import {
  assembleReturnEvidencePack,
  type ReturnEvidencePackPdfPayload,
} from './evidence-pack-payload'
import { readReturnEvidenceSources } from './evidence-pack-reads'
import { getReturn } from './reads'

/**
 * Build one return's evidence-pack payload and its content hash.
 *
 * The registry hands every builder `(organizationId, userId, recordId)` and no
 * connection, so this resolves the module database the same way every payload
 * builder in `documents/payload.ts` does.
 *
 * 🛑 Nothing in here refuses on missing data. The only failure is a return that
 * does not exist in this organization: a return with no order, no contact and
 * no ticket is the dock case and gets a pack that says so.
 */
export async function buildReturnEvidencePackPayload(params: {
  organizationId: string
  userId: string
  recordId: RecordId
}): Promise<{ payload: ReturnEvidencePackPdfPayload; hash: string }> {
  const { organizationId, userId, recordId } = params
  const { entityInstanceId } = parseRecordId(recordId)
  const db = defaultEvidenceDatabase()

  const returnResult = await getReturn(db, organizationId, entityInstanceId)
  if (returnResult.isErr()) throw returnResult.error
  const returnRecord = returnResult.value
  if (!returnRecord) {
    throw new NotFoundError('That return does not exist in this organization')
  }

  const sources = await readReturnEvidenceSources(db, organizationId, returnRecord)
  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const [contact, settings] = await Promise.all([
    loadPdfContact(cache, handler, organizationId, sources.contactRecordId),
    resolveDocumentSettings(organizationId),
  ])

  const payload = assembleReturnEvidencePack({ organizationId, sources, contact, settings })
  return { payload, hash: stableHash(payload) }
}
