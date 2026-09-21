// packages/lib/src/interactions/hooks.ts
//
// The interactive-lane caller: a contact's address changed, or a company's domain did.
//
// This is half of the same core-plus-two-callers shape `geocoding/address-normalize-hook.ts`
// and `phone-geo/derive-geo-hook.ts` use. The post-hook chain is gated on `publishEvents`,
// so it does NOT run for connector or import writes (`field-value-mutations.ts`) — that lane
// runs `resolveInteractionsBatch` below, through the sync dispatch (plans/events/10 §4.4).
// One mechanism per lane, both calling `resolveInteractions`.
//
// ⚠️ Def-slug keyed, NOT field-type keyed. The address and phone hooks key on their
// `FieldType` because every ADDRESS_STRUCT / PHONE_INTL field anywhere wants the same
// derivation; an EMAIL field on a purchase order does not want participant adoption. So the
// registration is per def and the handler filters on `systemAttribute` — one string
// comparison for every unrelated contact write.
//
// Fire-and-forget, like the address hook: a derivation must never fail, or slow, a save.

import { createScopedLogger } from '@auxx/logger'
import type {
  BatchCore,
  EntityFieldChangeEvent,
  EntityFieldChangeHandler,
} from '../field-hooks/types'
import { parseRecordId } from '../resources/resource-id'
import { resolveInteractions } from './resolve'

const logger = createScopedLogger('interactions')

/**
 * Contact attributes whose write can change which participants belong to the record.
 *
 * `primary_phone` is here for the same reason `PHONE_IDENTIFIER_FIELDS` lists it: older and
 * connector-provisioned orgs carry it instead of `phone`.
 */
const CONTACT_IDENTIFIER_ATTRS = new Set(['primary_email', 'phone', 'primary_phone'])

/** Company attributes whose write can change which contacts belong to the record. */
const COMPANY_ATTRS = new Set(['company_domain'])

/**
 * A contact's email or phone was written.
 *
 * Fires on CREATE as well, which is the point: an interactive create writes `primary_email`,
 * so the record is resolved the moment it exists. (There is deliberately no lifecycle
 * `created` rule anywhere for this — the sync lane's creates are in the manifest's
 * `createdRecordIds`, which the integrity pass reads.)
 */
export const resolveInteractionsOnIdentifierChange: EntityFieldChangeHandler = async (event) => {
  if (!CONTACT_IDENTIFIER_ATTRS.has(event.field?.systemAttribute ?? '')) return
  fireAndForget(event)
}

/**
 * A company's domain was written.
 *
 * Also reached one hop after enrichment: `enrichCompany` writes a derived `company_domain`
 * in its terminal update, so a company imported with only a website gets its contacts
 * attached as soon as enrichment resolves the domain.
 */
export const resolveInteractionsOnCompanyDomainChange: EntityFieldChangeHandler = async (event) => {
  if (!COMPANY_ATTRS.has(event.field?.systemAttribute ?? '')) return
  fireAndForget(event)
}

/**
 * The sync lane's selection (plans/events/10 §4.4). `contact_employer` is here and not in the
 * two inline sets because it moves which company a contact belongs to, which is a bulk run's
 * whole point; the inline door reaches that through the company hook instead.
 */
const BATCH_TRIGGER_ATTRS = new Set([
  ...CONTACT_IDENTIFIER_ATTRS,
  ...COMPANY_ATTRS,
  'contact_employer',
])

/**
 * The sync lane's core: every identifier-touched contact and company of one finalize, resolved
 * in ONE call.
 *
 * Selection reads membership, never deltas (plans/company/v5-interaction-resolution.md §4): the
 * import this was written for created 20,414 contacts and tier-2 deltas cap at 5,000, so a rule
 * would have fired for a quarter of them. A created record reaches here the same way an edited
 * one does — a create records its written keys in `touched`
 * (`field-values/create-values.ts` → `captureSyncFieldWrite`).
 */
export const resolveInteractionsBatch: BatchCore = async ({ organizationId, db, targets }) => {
  const recordIds = new Set<string>()
  for (const target of targets) {
    if (!BATCH_TRIGGER_ATTRS.has(target.field?.systemAttribute ?? '')) continue
    recordIds.add(parseRecordId(target.recordId).entityInstanceId)
  }
  if (recordIds.size === 0) return

  const summary = await resolveInteractions({
    organizationId,
    recordIds: [...recordIds],
    reason: 'sync',
    db,
  })

  logger.info('interaction resolution batch done', {
    organizationId,
    selected: recordIds.size,
    ...summary,
  })
}

/**
 * `resolveInteractions` never rejects, but the record-id parse can throw on a malformed id
 * and this must not surface into the user's write either way. A bare `void` would leave an
 * unhandled rejection if that ever changed.
 */
function fireAndForget(event: EntityFieldChangeEvent): void {
  void (async () => {
    const { entityInstanceId } = parseRecordId(event.recordId)
    await resolveInteractions({
      organizationId: event.organizationId,
      recordIds: [entityInstanceId],
      reason: 'field',
    })
  })().catch((error) => {
    logger.warn('Interaction resolution hook failed', {
      organizationId: event.organizationId,
      recordId: event.recordId,
      systemAttribute: event.field?.systemAttribute,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
