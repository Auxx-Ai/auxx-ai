// packages/lib/src/seed/entity-migrations/migrations/134-bank-account-has-posted.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:134')

/** The def that receives the field. */
const BANK_ACCOUNT_ENTITY_TYPE = 'bank_account'

/** Listed by REGISTRY KEY, so a later unrelated field cannot join this payload. */
const FIELD_KEYS = ['hasPosted'] as const

/** The link a bank line carries to its account. Read as `relatedEntityId`. */
const LINK_ATTRIBUTE = 'bank_transaction_bank_account'

/** The posting id a coded or transferred line carries. `NOT NULL` is the backfill. */
const POSTING_ATTRIBUTE = 'bank_transaction_gl_posting_id'

/**
 * Migration 134: `bank_account_has_posted`, the write-once fact that decides
 * whether a bank account can be deleted or only archived
 * (plans/bank-connection/08-removing-a-bank-account.md §5.1, §7.5).
 *
 * ## Why a stored field rather than a query
 *
 * "Has anything on this account ever reached the books" is not answerable from
 * the transaction rows, and that is the whole point. `undoReview` sets
 * `bank_transaction_gl_posting_id` back to `null` and returns the line to
 * `for_review`, so a predicate computed off the rows FLIPS BACK to false - while
 * the `GlPosting` it reversed and the reversal itself both stay in the books
 * forever, with a row on this account as their source document. Compute the gate
 * that way and an account that permanently changed the ledger becomes deletable
 * again the moment somebody undoes the last review.
 *
 * So the fact is RECORDED at the two sites where a bank line first produces an
 * entry (`banking/review/writes.ts`), and 🛑 **nothing ever clears it** - not
 * `undoReview`, not a reversal, not `reverseImport`. It is a high-water mark,
 * not a current state, and the one-way-ness is the feature.
 *
 * ## The backfill is one statement, and it is not a reconciliation
 *
 * `default false` is already correct for every existing row: the bank feed has
 * never been used in production - zero Financial Connections accounts
 * (`plans/accounting/HANDOFF.md` §14.3 item 1) - and nothing has posted from a
 * bank line. The single `INSERT ... SELECT`-shaped pass below over lines that
 * still carry a `glPostingId` is written because it is free, not because there
 * is anything to find.
 *
 * ⚠️ It is deliberately INEXACT and says so: a line that posted and was then
 * undone carries no `glPostingId` any more, so the backfill misses it. That set
 * is empty in practice, and building a reconciliation pass over `GlPosting` to
 * close a hole with nothing in it would be more code than the feature.
 *
 * ## Id space
 *
 * 134 is the next free id. The space is SHARED between
 * `data-migrations/migrations/` (which reaches 131) and
 * `seed/entity-migrations/migrations/` (which reaches 133), and has already
 * collided once, at 103.
 *
 * **No DDL.** The field is a `CustomField` row on an existing def and the
 * backfill writes `FieldValue` rows; nothing here touches a Postgres table.
 *
 * Idempotent - `ensureCustomFields` skips a field that already exists, and the
 * backfill only inserts where no `FieldValue` is present.
 */
export const migration134BankAccountHasPosted: EntityMigration = {
  id: '134-bank-account-has-posted',
  description:
    'Add bank_account_has_posted, the write-once high-water mark that decides whether removing ' +
    'a bank account deletes it or archives it, and stamp it on any account that still holds a ' +
    'posted bank line',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(BANK_ACCOUNT_ENTITY_TYPE)
    // Absent rather than failed: an org short of migration 125 has no
    // `bank_account` def to widen, and the seeder creates the field with the
    // rest of the registry.
    if (!def) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of FIELD_KEYS) {
      const field = BANK_ACCOUNT_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`bank_account registry is missing the key "${key}" (migration 134)`)
      }
      fields[key] = field
    }

    const created = await ensureCustomFields(
      db,
      organizationId,
      BANK_ACCOUNT_ENTITY_TYPE,
      def.id,
      fields,
      existing,
      state
    )

    const fieldId = created.get(
      `${BANK_ACCOUNT_ENTITY_TYPE}:${BANK_ACCOUNT_FIELDS.hasPosted!.id}`
    )?.id
    if (!fieldId) {
      throw new Error(
        `migration 134 could not resolve the bank_account_has_posted field for ${def.id}`
      )
    }

    const backfilled = await backfillHasPosted(db, organizationId, def.id, fieldId)

    const changed = state.fieldsCreated > 0 || backfilled > 0
    // A new field is invisible to every read path until the per-org caches that
    // serve it are dropped. `runEntityMigrationsForOrg` does this after the
    // whole batch, but `up()` can also be invoked directly, so it clears its own.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 134 applied', { organizationId, ...state, backfilled })
    }
    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Stamp `true` on every account that still holds a line carrying a posting id.
 *
 * Returns how many rows were inserted. Exported so the backfill can be exercised
 * on its own, the way 128's is.
 */
export async function backfillHasPosted(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string
): Promise<number> {
  const linkField = await findFieldByAttribute(db, organizationId, LINK_ATTRIBUTE)
  const postingField = await findFieldByAttribute(db, organizationId, POSTING_ATTRIBUTE)
  // An org whose `bank_transaction` def is short either field has no posted bank
  // line to find, which is the ordinary case and not a failure.
  if (!linkField || !postingField) return 0

  const posted = db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, postingField),
        isNotNull(schema.FieldValue.valueText)
      )
    )

  const links = await db
    .select({ bankAccountId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, linkField),
        inArray(schema.FieldValue.entityId, posted)
      )
    )

  const accountIds = [...new Set(links.map((row) => row.bankAccountId).filter((id) => !!id))]
  if (accountIds.length === 0) return 0

  const present = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, accountIds as string[])
      )
    )
  const alreadyWritten = new Set(present.map((row) => row.entityId))

  const now = new Date()
  const inserts = (accountIds as string[])
    .filter((accountId) => !alreadyWritten.has(accountId))
    .map((accountId) => ({
      organizationId,
      entityId: accountId,
      entityDefinitionId,
      fieldId,
      sortKey: generateKeyBetween(null, null),
      valueBoolean: true,
      updatedAt: now,
    }))
  if (inserts.length === 0) return 0

  await db.insert(schema.FieldValue).values(inserts)
  return inserts.length
}

/** One `CustomField.id` by its `systemAttribute`, or null when the org lacks it. */
async function findFieldByAttribute(
  db: Database,
  organizationId: string,
  systemAttribute: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, systemAttribute)
      )
    )
    .limit(1)
  return row?.id ?? null
}
