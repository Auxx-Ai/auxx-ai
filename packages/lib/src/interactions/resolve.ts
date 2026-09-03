// packages/lib/src/interactions/resolve.ts
//
// The entry point every caller funnels through: given some record ids, give those records
// the correspondence history they already have but cannot see.
//
// Four phases, in order:
//   A. adopt the unlinked `Participant` rows carrying the contacts' addresses
//   B. backfill the `ThreadParticipant` rollup so the records get their mail
//   C. recompute `first/lastInteractionAt` for the contacts, then their companies
//   D. attach domain-matching contacts to the companies in the batch, then re-run C for them
//
// 🔴 **Batch, never fan out.** Every phase is a set operation, so 500 records cost the same
// four round trips as one. That is the opposite of company enrichment, where one record is
// one outbound HTTP fetch and one job per record is correct. A 20k-row import must cost ~41
// statements here, not 20k invocations — which is also why this runs inline in its callers
// instead of behind a queue.
//
// Never throws. Every phase logs and swallows, and each returns a count, so the caller
// reports an outcome without having to decide what a partial failure means. The whole thing
// is idempotent (monotonic guards on the stamps, `IS NULL` guards on the links), so a second
// run over the same ids writes nothing.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { adoptParticipants, backfillThreadParticipants } from './adopt'
import { attachContactsToCompanies } from './employer-attach'
import { contactIdentifiers, type RecordIdentifier } from './identifiers'
import { employerCompanyIds, recomputeCompanyStamps, recomputeContactStamps } from './recompute'

const logger = createScopedLogger('interactions')

/** Records per phase-A/C batch. See the file header for why this is a batch size at all. */
export const RECORDS_PER_BATCH = 500

/** Why resolution was asked for. Reporting only — no phase branches on it. */
export type ResolveReason = 'sync' | 'field' | 'backfill'

export interface ResolveInteractionsInput {
  organizationId: string
  /** `EntityInstance.id`s. Anything that is not a contact or a company is dropped. */
  recordIds: readonly string[]
  reason: ResolveReason
  db?: Database
}

export interface ResolveInteractionsSummary {
  contacts: number
  companies: number
  participantsAdopted: number
  /** Participants whose address matched but which belong to another contact (duplicates). */
  participantsSkippedLinkedElsewhere: number
  threadParticipantsBackfilled: number
  contactsStamped: number
  companiesStamped: number
  employersAttached: number
}

const EMPTY: ResolveInteractionsSummary = {
  contacts: 0,
  companies: 0,
  participantsAdopted: 0,
  participantsSkippedLinkedElsewhere: 0,
  threadParticipantsBackfilled: 0,
  contactsStamped: 0,
  companiesStamped: 0,
  employersAttached: 0,
}

/**
 * Resolve interaction history for a set of records.
 *
 * Splitting by entity type is a database read rather than a caller promise: callers hand
 * over whatever their door gave them (a manifest's membership, one hook's record, a sweep
 * page), and this is also the org-ownership check — the query is scoped to the org, so an
 * id belonging to another one resolves to nothing.
 */
export async function resolveInteractions(
  input: ResolveInteractionsInput
): Promise<ResolveInteractionsSummary> {
  const { organizationId, reason } = input
  const db = input.db ?? defaultDb
  const recordIds = [...new Set(input.recordIds)]
  if (!organizationId || recordIds.length === 0) return { ...EMPTY }

  const summary: ResolveInteractionsSummary = { ...EMPTY }

  try {
    const { contactIdsByDef, companyIds } = await splitByEntityType(organizationId, recordIds, db)
    const contactIds = [...contactIdsByDef.values()].flat()
    summary.contacts = contactIds.length
    summary.companies = companyIds.length
    if (contactIds.length === 0 && companyIds.length === 0) return summary

    // ── Phases A + C, batched ────────────────────────────────────────────────
    // Every address seen across the batches, kept for the one thread-rollup pass below.
    const allIdentifiers: RecordIdentifier[] = []
    const stampedContactIds: string[] = []

    // Batched per DEFINITION, because the identifier read resolves its fields from the def.
    // An org has one contact def in practice; keying on it anyway costs nothing and keeps a
    // second one from reading the first one's field ids.
    for (const [definitionId, idsForDef] of contactIdsByDef) {
      for (let offset = 0; offset < idsForDef.length; offset += RECORDS_PER_BATCH) {
        const batch = idsForDef.slice(offset, offset + RECORDS_PER_BATCH)
        const identifiers = await contactIdentifiers(organizationId, definitionId, batch, db)
        if (identifiers.length > 0) {
          allIdentifiers.push(...identifiers)
          const adoption = await adoptParticipants(organizationId, identifiers, db)
          summary.participantsAdopted += adoption.adopted
          summary.participantsSkippedLinkedElsewhere += adoption.conflicts
        }
        // Runs even when this batch adopted nothing: a contact whose participant was linked
        // by ingest long ago can still be missing its stamps (created before the columns
        // existed, or stamped only on one side).
        summary.contactsStamped += await recomputeContactStamps(organizationId, batch, db)
        stampedContactIds.push(...batch)
      }
    }

    // ── Phase B, once for the whole run ──────────────────────────────────────
    summary.threadParticipantsBackfilled = await backfillThreadParticipants(
      organizationId,
      allIdentifiers,
      db
    )

    // ── Phase D, then the company half of C ──────────────────────────────────
    if (companyIds.length > 0) {
      summary.employersAttached = await attachContactsToCompanies(organizationId, companyIds, db)
    }

    // Companies to propagate to: the ones in the batch, plus the employers of every contact
    // we just touched — a contact that lit up must not leave its already-linked company
    // blank until the nightly sweep.
    const targets = new Set<string>(companyIds)
    for (const id of await employerCompanyIds(organizationId, stampedContactIds, db)) {
      targets.add(id)
    }
    for (const batch of chunk([...targets], RECORDS_PER_BATCH)) {
      summary.companiesStamped += await recomputeCompanyStamps(organizationId, batch, db)
    }

    logger.info('Interaction resolution done', { organizationId, reason, ...summary })
    return summary
  } catch (error) {
    logger.error('Interaction resolution failed', {
      organizationId,
      reason,
      records: recordIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return summary
  }
}

interface SplitRecords {
  /** Contact ids grouped by their definition — the identifier read is per def. */
  contactIdsByDef: Map<string, string[]>
  companyIds: string[]
}

/**
 * Partition the ids into contacts and companies, dropping everything else.
 *
 * Keyed on `EntityDefinition.entityType`, never on a slug or a field the caller passed:
 * that is the same rule the integrity passes follow, and it is what keeps a stray record
 * from another definition out of a participant claim.
 */
async function splitByEntityType(
  organizationId: string,
  recordIds: readonly string[],
  db: Database
): Promise<SplitRecords> {
  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...recordIds]),
        // An archived record is not a correspondence subject: no claim, no stamp.
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const split: SplitRecords = { contactIdsByDef: new Map(), companyIds: [] }
  for (const row of rows) {
    if (row.entityType === 'contact') {
      const forDef = split.contactIdsByDef.get(row.entityDefinitionId) ?? []
      forDef.push(row.id)
      split.contactIdsByDef.set(row.entityDefinitionId, forDef)
    } else if (row.entityType === 'company') {
      split.companyIds.push(row.id)
    }
  }
  return split
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
