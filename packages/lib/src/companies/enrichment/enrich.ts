// packages/lib/src/companies/enrichment/enrich.ts
// The single entry point every enrichment door funnels through.
//
// ⚠️ It reads live record state and NEVER trusts the triggering event's values. Two
// reasons, both load-bearing:
//
//   1. `fanOutEntityHandler` builds a handler's `values` from
//      `event.eventDataByRecordId?.[recordId] ?? {}`. FIELD firings carry no `eventData`,
//      so a handler that read `event.values.company_domain` would see `{}` and skip every
//      time it was reached from the `company_domain` / `company_website` doors.
//   2. The interactive field door does not carry real values at all — it presents
//      `INTERACTIVE_FIELD_WRITE` against `oldValue: undefined` so the transition always
//      matches. It fires when a user CLEARS the domain just as loudly as when they set it.
//      Only a live read can tell those apart.
//
// It also never throws. Every failure mode is a terminal status on the record; a throwing
// job would be retried by BullMQ, and a retried website fetch is exactly the "called too
// often" behaviour the guards exist to prevent.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { SystemUserService } from '../../users/system-user-service'
import { checkFixedWindowLimit } from '../../utils/rate-limiter/fixed-window'
import {
  CLAIM_TTL_MS,
  type CompanyEnrichmentState,
  type EnrichmentStatus,
  type EnrichReason,
  type EnrichSkipReason,
  ORG_WINDOW_LIMIT,
  ORG_WINDOW_MS,
  shouldEnrich,
} from './guards'
import { fetchAndStoreLogo, fetchWebsiteMetadata, isEmptyMetadata } from './metadata'

const logger = createScopedLogger('companies:enrichment')

/** The seven fields enrichment reads or writes. Nothing else is touched. */
const FIELDS = [
  'company_domain',
  'company_website',
  'company_enrichment_status',
  'company_enriched_at',
  'company_name',
  'company_notes',
  'company_logo',
] as const

export interface EnrichCompanyInput {
  organizationId: string
  companyInstanceId: string
  reason: EnrichReason
  db?: Database
}

export type CompanyEnrichmentOutcome =
  | { outcome: 'enriched'; domain: string; applied: string[] }
  | { outcome: 'failed'; domain: string; error?: string }
  | { outcome: 'skipped'; why: EnrichSkipReason | 'claimed' | 'rate-limited' | 'not-configured' }

/**
 * Enrich one company from its website.
 *
 * Reads live state, applies {@link shouldEnrich}, takes a short Redis claim, checks the
 * per-org budget, fetches, and writes ONE terminal update. Returns what happened rather
 * than throwing, so callers (job, script, sweep) can count outcomes.
 *
 * The derived domain, when the domain came from `company_website`, is written in that SAME
 * terminal update rather than up front. Writing it earlier would re-enter the
 * `company_domain` door with the record still on a non-terminal status, so the re-fired
 * job would fetch the site a second time.
 */
export async function enrichCompany(input: EnrichCompanyInput): Promise<CompanyEnrichmentOutcome> {
  const { organizationId, companyInstanceId, reason } = input
  const db = input.db ?? defaultDb

  const companyDefId = await getCachedEntityDefId(organizationId, 'company')
  if (!companyDefId) {
    logger.debug('Org has no company definition', { organizationId })
    return { outcome: 'skipped', why: 'not-configured' }
  }

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...FIELDS])

  // The def-id filter matters: `customFields` is an ORG-wide projection, and a
  // systemAttribute is only unique within its def.
  const fieldIdByAttr = new Map<string, string>()
  for (const attr of FIELDS) {
    const field = fields[attr]
    if (field && field.entityDefinitionId === companyDefId) fieldIdByAttr.set(attr, field.id)
  }

  // `company_domain` is what enrichment is keyed on and `company_enrichment_status` is
  // what records the answer. Without both there is nothing coherent to do.
  if (!fieldIdByAttr.has('company_domain') || !fieldIdByAttr.has('company_enrichment_status')) {
    logger.warn('Company def is missing the enrichment fields', { organizationId, companyDefId })
    return { outcome: 'skipped', why: 'not-configured' }
  }

  const state = await readState(db, organizationId, companyInstanceId, fieldIdByAttr)
  const decision = shouldEnrich(state, reason, new Date())

  const recordId = toRecordId(companyDefId, companyInstanceId)
  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const crud = new UnifiedCrudHandler(organizationId, systemUserId, db)

  if (decision.action === 'skip') {
    if (decision.writeStatus) {
      await crud
        .update(recordId, { company_enrichment_status: decision.writeStatus })
        .catch((err: unknown) => {
          logger.warn('Could not mark company skipped', {
            organizationId,
            companyId: companyInstanceId,
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
    logger.debug('Enrichment skipped', {
      organizationId,
      companyId: companyInstanceId,
      reason,
      why: decision.why,
    })
    return { outcome: 'skipped', why: decision.why }
  }

  const { domain, derivedFromWebsite } = decision

  // In-flight claim. Keyed on the DOMAIN as well as the record, so correcting a domain
  // enriches immediately while re-saving the same one inside the window does not.
  if (reason !== 'manual' && !(await claim(organizationId, companyInstanceId, domain))) {
    logger.debug('Enrichment already claimed', {
      organizationId,
      companyId: companyInstanceId,
      domain,
    })
    return { outcome: 'skipped', why: 'claimed' }
  }

  // Per-org budget. Deliberately writes NO status when it blocks: the record must stay
  // eligible so `companyEnrichmentSweepJob` drains the remainder in a later window.
  const { allowed, count } = await checkFixedWindowLimit({
    key: `enrich:org:${organizationId}`,
    limit: ORG_WINDOW_LIMIT,
    windowMs: ORG_WINDOW_MS,
  })
  if (!allowed) {
    logger.info('Company enrichment rate limited for org', { organizationId, count })
    return { outcome: 'skipped', why: 'rate-limited' }
  }

  try {
    await crud.update(recordId, { company_enrichment_status: 'pending' })

    const metadata = await fetchWebsiteMetadata(`https://${domain}`, domain)
    const logoAssetId = await fetchAndStoreLogo({ organizationId, userId: systemUserId, metadata })

    // Reached the site and got nothing usable. That is a `failed`, not an `enriched` with
    // an empty payload: `failed` carries the shorter retry window and reads correctly in
    // the UI as "we tried and could not get anything".
    if (isEmptyMetadata(metadata) && !logoAssetId) {
      await writeTerminal(crud, recordId, 'failed', derivedFromWebsite ? domain : null, {})
      logger.info('Company enrichment found nothing usable', {
        organizationId,
        companyId: companyInstanceId,
        domain,
      })
      return { outcome: 'failed', domain, error: 'no-usable-metadata' }
    }

    // Never overwrite what a person put there. `company_name` is replaced only while it is
    // still the raw domain the mail path seeded it with; notes and logo are filled only
    // when empty.
    const applied: Record<string, unknown> = {}
    if (metadata.siteName && nameIsReplaceable(state.name, domain)) {
      applied.company_name = metadata.siteName
    }
    if (metadata.description && isBlank(state.notes)) applied.company_notes = metadata.description
    if (logoAssetId && isBlank(state.logoRef))
      applied.company_logo = { ref: `asset:${logoAssetId}` }

    await writeTerminal(crud, recordId, 'enriched', derivedFromWebsite ? domain : null, applied)

    logger.info('Company enriched', {
      organizationId,
      companyId: companyInstanceId,
      domain,
      reason,
      derivedFromWebsite,
      applied: Object.keys(applied),
    })
    return { outcome: 'enriched', domain, applied: Object.keys(applied) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    logger.error('Company enrichment failed', {
      organizationId,
      companyId: companyInstanceId,
      domain,
      error,
    })
    await writeTerminal(crud, recordId, 'failed', derivedFromWebsite ? domain : null, {}).catch(
      () => {}
    )
    return { outcome: 'failed', domain, error }
  }
}

/**
 * One update carrying the terminal status, the timestamp, any derived domain, and whatever
 * the fetch produced. Single write on purpose: each `crud.update` re-enters the field-hook
 * and record-rule machinery, so splitting this would multiply the dispatch it triggers.
 */
async function writeTerminal(
  crud: UnifiedCrudHandler,
  recordId: RecordId,
  status: Extract<EnrichmentStatus, 'enriched' | 'failed'>,
  derivedDomain: string | null,
  applied: Record<string, unknown>
): Promise<void> {
  await crud.update(recordId, {
    ...applied,
    ...(derivedDomain ? { company_domain: derivedDomain } : {}),
    company_enrichment_status: status,
    company_enriched_at: new Date(),
  })
}

/** `SET NX PX`. Fails OPEN when Redis is down — the stored status is the durable guard. */
async function claim(
  organizationId: string,
  companyInstanceId: string,
  domain: string
): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return true
    const key = `enrich:claim:${organizationId}:${companyInstanceId}:${domain}`
    return !!(await redis.set(key, '1', 'PX', CLAIM_TTL_MS, 'NX'))
  } catch {
    return true
  }
}

/**
 * Read the seven field values off the record.
 *
 * Raw column reads rather than `FieldValueService`: the four storage columns in play here
 * are unambiguous (TEXT/URL land in `valueText`, DATETIME in `valueDate`, SINGLE_SELECT in
 * `optionId`, FILE in `valueJson`) and this runs once per job on a hot path.
 */
async function readState(
  db: Database,
  organizationId: string,
  companyInstanceId: string,
  fieldIdByAttr: Map<string, string>
): Promise<CompanyEnrichmentState> {
  const idToAttr = new Map([...fieldIdByAttr].map(([attr, id]) => [id, attr]))

  const rows = await db
    .select({
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueDate: schema.FieldValue.valueDate,
      valueJson: schema.FieldValue.valueJson,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, companyInstanceId),
        inArray(schema.FieldValue.fieldId, [...idToAttr.keys()])
      )
    )

  const state: CompanyEnrichmentState = {
    domain: null,
    website: [],
    status: null,
    enrichedAt: null,
    name: null,
    notes: null,
    logoRef: null,
  }

  for (const row of rows) {
    switch (idToAttr.get(row.fieldId)) {
      case 'company_domain':
        state.domain = row.valueText
        break
      // Multi-value: one row per entry.
      case 'company_website':
        if (row.valueText) state.website.push(row.valueText)
        break
      case 'company_enrichment_status':
        state.status = asStatus(row.optionId)
        break
      // `FieldValue.valueDate` is declared `mode: 'string'`, so this is an ISO string on
      // the way out, not a Date. An unparseable one reads as "never enriched", which fails
      // toward re-enriching rather than toward silently never enriching again.
      case 'company_enriched_at':
        state.enrichedAt = parseDate(row.valueDate)
        break
      case 'company_name':
        state.name = row.valueText
        break
      case 'company_notes':
        state.notes = row.valueText
        break
      case 'company_logo':
        state.logoRef = assetRefOf(row.valueJson)
        break
    }
  }

  return state
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function asStatus(optionId: string | null): EnrichmentStatus | null {
  switch (optionId) {
    case 'pending':
    case 'enriched':
    case 'failed':
    case 'skipped':
      return optionId
    default:
      return null
  }
}

/** FILE values are stored wrapped: `{ v: { ref: 'asset:<id>' } }`. */
function assetRefOf(valueJson: unknown): string | null {
  if (!valueJson || typeof valueJson !== 'object') return null
  const inner = (valueJson as { v?: unknown }).v ?? valueJson
  if (!inner || typeof inner !== 'object') return null
  const ref = (inner as { ref?: unknown }).ref
  return typeof ref === 'string' && ref.length > 0 ? ref : null
}

/** Empty, whitespace-only, and absent all count as "nothing is there to protect". */
function isBlank(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim().length === 0
}

/**
 * A name we are allowed to replace: blank, or still the raw domain the mail path seeds
 * (`findOrCreateCompanyByDomain` writes `company_name: domain`). Anything else is a name a
 * person chose, and enrichment does not get to argue with it.
 */
function nameIsReplaceable(current: string | null, domain: string): boolean {
  if (isBlank(current)) return true
  const normalized = current!.trim().toLowerCase()
  return normalized === domain || normalized === `www.${domain}`
}
