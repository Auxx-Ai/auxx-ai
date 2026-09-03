// packages/lib/src/records/name-case/backfill.ts
//
// One-off casing repair for contact names already in the database.
//
// The pre-hook (`./hook.ts`) covers every name written from now on; this catches what
// is already stored — most of it from a connector backfill or a mail/SMS ingest that
// predates the hook. Measured on the dev org: 1,622 of 14,824 contacts (~11%).
//
// NOT a `DataMigration`, deliberately. This is a judgement-carrying cosmetic rewrite of
// user data, so it is run per-org on purpose with a `dryRun` that prints the diff,
// rather than silently on deploy. See plans/records/contact-name-casing-plan.md §5.
//
// ⚠️ **Writes through `UnifiedCrudHandler`, never `FieldValue` directly.** `full_name`
// is a composite computed over `first_name`/`last_name`, and `EntityInstance.displayName`
// is denormalized from it — a direct `FieldValue` update leaves the record still
// DISPLAYING the old value everywhere it is listed. Same reason documented on
// `ingest/contacts/repair-name.ts`.
//
// Idempotent: `toDisplayCase` returns its input unchanged for anything already
// well-cased, so a second run finds nothing and writes nothing.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toDisplayCase } from '@auxx/utils/name-case'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { toRecordId } from '../../resources/resource-id'

const logger = createScopedLogger('name-case-backfill')

/** Contacts pulled per round. Bounded so one org with a large book cannot balloon the heap. */
const BATCH_SIZE = 500

export interface NameCaseBackfillOptions {
  /** Restrict to one organization. Omit to sweep every org. */
  organizationId?: string
  /** Report what would change without writing. */
  dryRun?: boolean
  /** Safety ceiling on records rewritten in one run. */
  maxRecords?: number
  /** Receives every `old -> new` pair, for a caller that wants to print them. */
  onChange?: (change: NameCaseChange) => void
}

export interface NameCaseChange {
  organizationId: string
  recordId: string
  attribute: 'first_name' | 'last_name'
  from: string
  to: string
}

export interface NameCaseBackfillSummary {
  /** Rows read and considered. */
  scanned: number
  /** Values `toDisplayCase` would rewrite. */
  changed: number
  /** Distinct records written (a record with both names repaired counts once). */
  recordsWritten: number
  organizations: number
}

/**
 * SQL pre-filter for "entirely upper-case" or "entirely lower-case".
 *
 * Narrowing in SQL rather than reading every name and filtering in JS is what keeps
 * this to ~1.6k rows instead of ~29k on the sample org. It is deliberately LOOSER than
 * `toDisplayCase` — it is only a candidate filter, and `toDisplayCase` is still the
 * single authority on what actually changes (it returns its input untouched for
 * anything it declines, so a false positive here costs a comparison, not a bad write).
 */
const CASING_CANDIDATE = sql`(
  ("valueText" ~ '^[^a-z]*$' AND "valueText" ~ '[A-Z]')
  OR ("valueText" ~ '^[^A-Z]*$' AND "valueText" ~ '[a-z]')
)`

/**
 * Repair the casing of stored contact names.
 *
 * @returns counts; the per-value detail goes to {@link NameCaseBackfillOptions.onChange}.
 */
export async function backfillContactNameCasing(
  db: Database,
  options: NameCaseBackfillOptions = {}
): Promise<NameCaseBackfillSummary> {
  const { organizationId, dryRun = false, maxRecords = 100_000, onChange } = options

  // The name field ids per org, scoped to the CONTACT def. `systemAttribute` alone is too
  // broad — org-created `leads`/`vendors` defs reuse `first_name`, and this change is
  // scoped to contacts exactly as the hook is.
  const fieldRows = await db
    .select({
      organizationId: schema.CustomField.organizationId,
      entityDefinitionId: schema.CustomField.entityDefinitionId,
      systemAttribute: schema.CustomField.systemAttribute,
      fieldId: schema.CustomField.id,
    })
    .from(schema.CustomField)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.CustomField.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityDefinition.entityType, 'contact'),
        inArray(schema.CustomField.systemAttribute, ['first_name', 'last_name']),
        organizationId ? eq(schema.CustomField.organizationId, organizationId) : undefined
      )
    )

  const summary: NameCaseBackfillSummary = {
    scanned: 0,
    changed: 0,
    recordsWritten: 0,
    organizations: 0,
  }
  if (fieldRows.length === 0) return summary

  const byOrg = new Map<string, { entityDefinitionId: string; fieldIds: Map<string, string> }>()
  for (const row of fieldRows) {
    // `CustomField.entityDefinitionId` is nullable in the schema even though the join
    // above can only match rows that have one. Skip rather than assert: the id becomes
    // half of the `RecordId` every write is addressed by, and a bad one would write to
    // the wrong def rather than fail loudly.
    if (!row.systemAttribute || !row.entityDefinitionId) continue
    const entry = byOrg.get(row.organizationId) ?? {
      entityDefinitionId: row.entityDefinitionId,
      fieldIds: new Map<string, string>(),
    }
    entry.fieldIds.set(row.fieldId, row.systemAttribute)
    byOrg.set(row.organizationId, entry)
  }
  summary.organizations = byOrg.size

  // Imported lazily for the reason documented on `repair-name.ts`: a static edge from a
  // lib leaf into `UnifiedCrudHandler` widens the graph into the org-cache cycle and
  // breaks `vi.mock` interception in lib tests.
  const [{ UnifiedCrudHandler }, { SystemUserService }] = await Promise.all([
    import('../../resources/crud/unified-handler'),
    import('../../users/system-user-service'),
  ])

  for (const [orgId, { entityDefinitionId, fieldIds }] of byOrg) {
    if (summary.recordsWritten >= maxRecords) break

    const rows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
      .where(
        and(
          eq(schema.FieldValue.organizationId, orgId),
          inArray(schema.FieldValue.fieldId, [...fieldIds.keys()]),
          // An archived contact is not shown anywhere; repairing one would only add
          // churn and re-dirty it for the duplicate scanner.
          isNull(schema.EntityInstance.archivedAt),
          CASING_CANDIDATE
        )
      )

    // Group by record so a contact whose first AND last name both need repair is ONE
    // `update` — one `updatedAt` bump, one realtime frame, one duplicate re-scan.
    const patches = new Map<string, Record<string, string>>()
    for (const row of rows) {
      summary.scanned++
      const attribute = fieldIds.get(row.fieldId)
      const current = row.valueText
      if (!attribute || !current) continue

      const repaired = toDisplayCase(current)
      if (repaired === current || typeof repaired !== 'string') continue

      summary.changed++
      onChange?.({
        organizationId: orgId,
        recordId: row.entityId,
        attribute: attribute as NameCaseChange['attribute'],
        from: current,
        to: repaired,
      })

      const patch = patches.get(row.entityId) ?? {}
      patch[attribute] = repaired
      patches.set(row.entityId, patch)
    }

    if (dryRun || patches.size === 0) continue

    const systemUserId = await SystemUserService.getSystemUserForActions(orgId)
    const handler = new UnifiedCrudHandler(orgId, systemUserId, db)

    const entries = [...patches.entries()]
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      for (const [entityInstanceId, patch] of entries.slice(i, i + BATCH_SIZE)) {
        if (summary.recordsWritten >= maxRecords) break
        try {
          await handler.update(toRecordId(entityDefinitionId, entityInstanceId), patch)
          summary.recordsWritten++
        } catch (error) {
          // One bad record must not end the pass — the same fault-boundary rule the
          // connector sink learned when a single malformed value killed a 4,222-row import.
          logger.warn('Name casing repair failed for one record (skipped)', {
            organizationId: orgId,
            entityInstanceId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }

  return summary
}
