// packages/lib/src/field-hooks/post/company-triggers.ts
// Rule-door adapters for company enrichment. Thin on purpose: these translate a firing
// into an enqueue and nothing else.
//
// The fetch, the parsing, the never-overwrite rules and the whole throttle live in
// `packages/lib/src/companies/enrichment/`, because enrichment is reachable from four
// doors now (record created, `company_domain` changed, `company_website` changed, manual
// or backfill) and a policy split across four adapters would drift within a release.
//
// ⚠️ Neither adapter reads the event's values. A FIELD firing carries no `eventData`, and
// the interactive field door presents a sentinel rather than the real write, so the only
// trustworthy source is the record itself. `enrichCompany` re-reads it.

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { enqueueCompanyEnrichment } from '../../companies/enrichment/enqueue'
import type { EnrichReason } from '../../companies/enrichment/guards'
import type { EntityTriggerHandler } from '../types'

const logger = createScopedLogger('field-hooks:company')

/**
 * Lifecycle door: a company row appeared.
 *
 * This is the only door that fires for a company created with a domain already on it, such
 * as one the mail path minted from a sender address. Shaped as an `EntityTriggerHandler`
 * because `fanOutEntityHandler` in `system-entity-rules.ts` invokes it per record.
 */
export const enrichCompanyOnCreate: EntityTriggerHandler = async (event) => {
  if (event.action !== 'created') return
  await queue(event.organizationId, event.entityInstanceId, 'created')
}

/**
 * Field door: `company_domain` or `company_website` was written.
 *
 * ⚠️ NOT an `EntityTriggerHandler`, and not routed through `fanOutEntityHandler`. That
 * helper bails on any firing without a lifecycle `action` ("Entity triggers are
 * lifecycle-only"), and field firings carry none — routing this through it would silently
 * never run. It takes the native batch event's `recordIds` directly instead.
 *
 * `company_website` is what makes that field mean something. Until this door existed,
 * `company_domain` had exactly one writer in the codebase (the mail ingest path), so a
 * company that did not arrive by email could never be enriched no matter what a user typed
 * into it.
 */
export async function enqueueCompanyEnrichmentForRecords(
  args: { organizationId: string; recordIds: readonly RecordId[] },
  reason: Extract<EnrichReason, 'domain-changed' | 'website-changed'>
): Promise<void> {
  for (const recordId of args.recordIds) {
    const { entityInstanceId } = parseRecordId(recordId)
    await queue(args.organizationId, entityInstanceId, reason)
  }
}

async function queue(
  organizationId: string,
  companyInstanceId: string,
  reason: EnrichReason
): Promise<void> {
  if (!organizationId || !companyInstanceId) return
  const queued = await enqueueCompanyEnrichment({ organizationId, companyInstanceId, reason })
  if (!queued) {
    logger.warn('Company enrichment was not queued', { organizationId, companyInstanceId, reason })
  }
}
