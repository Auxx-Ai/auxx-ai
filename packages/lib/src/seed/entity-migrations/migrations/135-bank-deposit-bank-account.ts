// packages/lib/src/seed/entity-migrations/migrations/135-bank-deposit-bank-account.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { seedSession, UnifiedCrudHandler } from '../../../resources/crud'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { BANK_DEPOSIT_FIELDS } from '../../../resources/registry/resources/bank-deposit-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { ensureCustomFields, linkNewRelationships, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:135')

/** The GL code a deposit was posted to. Already on every org that has migration 125. */
const CODE_ATTRIBUTE = 'bank_deposit_bank_account'

/** What a bank account is mapped to in the chart. The backfill's only join key. */
const GL_ACCOUNT_ATTRIBUTE = 'bank_account_gl_account'

/** The label the code field carried while it was the ONLY account field on a deposit. */
const OLD_CODE_LABEL = 'Bank Account'

/**
 * Migration 135: `bank_deposit.bankAccount`, the RELATIONSHIP the deposit should
 * always have had, and its inverse `bank_account.deposits`
 * (plans/bank-connection/09-data-connector-debt.md D5,
 * plans/bank-connection/08-removing-a-bank-account.md §3 (3)).
 *
 * ## Why the code field STAYS
 *
 * `bank_deposit_bank_account` holds a GL account code (`'1020'`) and the
 * registry has said since 125 that a later migration converts it. This one does
 * NOT convert it - it adds the relationship beside it, and the two halves mean
 * different things:
 *
 * - the RELATIONSHIP is which bank account the money was banked into. That is
 *   what the operator actually chose (the deposit picker has always made them
 *   pick an account and read the code off its mapping) and it is what the
 *   removal gate reads.
 * - the CODE is which chart account the entry POSTED to, frozen when the entry
 *   was built, exactly the way `GlPostingLine` freezes code and name and holds
 *   no foreign key to the instance (§3 (1)).
 *
 * 🛑 Deriving the code from the relationship later would restate history: remap
 * a bank account to a different chart code and every deposit that posted to the
 * old one silently changes account. Deriving the relationship from the code
 * cannot be done at all - see the backfill.
 *
 * ## The backfill is deliberately incomplete, and refuses to guess
 *
 * A code names at most one chart account but MANY bank accounts: two current
 * accounts at different banks both mapped to `1000 Checking` is ordinary, not an
 * edge case. In the first organization that had any deposits at all, three bank
 * accounts shared the code all four of its deposits carry.
 *
 * So the backfill links a deposit only when the org has EXACTLY ONE bank account
 * mapped to that code, and leaves the rest null. A guess would attach the
 * deposit to the wrong account and then hand that wrong answer to the removal
 * gate, which is worse than a null: null means "unknown", and the code - the
 * fact that IS true - is still on the row and still on the posted entry.
 *
 * ## Id space
 *
 * 135 is the next free id. The space is SHARED between
 * `data-migrations/migrations/` (which reaches 131) and
 * `seed/entity-migrations/migrations/` (which reaches 134), and has already
 * collided once, at 103.
 *
 * **No DDL.** Two `CustomField` rows on existing defs, plus `FieldValue` rows
 * written through `UnifiedCrudHandler` so both halves of the relationship land.
 *
 * Idempotent - `ensureCustomFields` skips a field that already exists,
 * `linkNewRelationships` only writes a null inverse, the relabel is guarded on
 * the old label and the backfill skips a deposit that already has a link.
 */
export const migration135BankDepositBankAccount: EntityMigration = {
  id: '135-bank-deposit-bank-account',
  description:
    'Add bank_deposit.bankAccount (a RELATIONSHIP to bank_account) and its inverse ' +
    'bank_account.deposits, keeping the posted GL code beside it, and link every deposit ' +
    'whose code names exactly one bank account',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const depositDef = existing.entityDefs.get('bank_deposit')
    const accountDef = existing.entityDefs.get('bank_account')
    // Absent rather than failed: an org short of migration 125 has neither def,
    // and the seeder creates both halves with the rest of the registry.
    if (!depositDef || !accountDef) return { ...state, alreadyUpToDate: true }

    const depositFields = pick(BANK_DEPOSIT_FIELDS, ['bankAccount'], 'bank_deposit')
    const accountFields = pick(BANK_ACCOUNT_FIELDS, ['deposits'], 'bank_account')

    // 🛑 The relabel goes FIRST, before the new field is created. `CustomField`
    // is UNIQUE on (name, organizationId, modelType, entityDefinitionId), and
    // the relationship this migration adds is labelled "Bank Account" - the name
    // the CODE field still holds. Creating it first is a 23505 on every org that
    // has the deposit def, which is how this ordering was found.
    const relabelled = await relabelCodeField(db, organizationId, depositDef.id)

    // 🛑 ONE field map spanning BOTH defs. `linkNewRelationships` resolves the
    // inverse out of this map by `<entityType>:<field id>`, so linking the two
    // halves in separate calls would leave each unable to see the other and skip
    // the pair with a debug line.
    const fieldMap = new Map([
      ...(await ensureCustomFields(
        db,
        organizationId,
        'bank_deposit',
        depositDef.id,
        depositFields,
        existing,
        state
      )),
      ...(await ensureCustomFields(
        db,
        organizationId,
        'bank_account',
        accountDef.id,
        accountFields,
        existing,
        state
      )),
    ])

    await linkNewRelationships(
      db,
      fieldMap,
      new Map([
        ['bank_deposit', depositDef.id],
        ['bank_account', accountDef.id],
      ]),
      state
    )

    const relationField = fieldMap.get(`bank_deposit:${BANK_DEPOSIT_FIELDS.bankAccount!.id}`)
    if (!relationField) {
      throw new Error(
        `migration 135 could not resolve the bank_deposit_bank_account_record field for ${depositDef.id}`
      )
    }
    // 🛑 An UNLINKED relationship is worse than a missing one: the field exists,
    // so writes are accepted, but with no inverse the account side reads empty
    // and the removal gate sees no deposits. `linkNewRelationships` only logs a
    // debug line when it cannot find the other half, so it is checked here.
    const linked = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, relationField.id),
      columns: { options: true },
    })
    const inverseId = (linked?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        'migration 135 created bank_deposit.bankAccount but could not link it to ' +
          'bank_account.deposits - the inverse half is missing, and an unlinked relationship ' +
          'writes rows the account side cannot see'
      )
    }

    const backfill = await backfillDepositBankAccount(db, organizationId, {
      depositDefId: depositDef.id,
      accountDefId: accountDef.id,
      relationFieldId: relationField.id,
    })

    const changed =
      state.fieldsCreated > 0 || state.relationshipsLinked > 0 || relabelled || backfill.linked > 0
    // A new field is invisible to every read path until the per-org caches that
    // serve it are dropped. `runEntityMigrationsForOrg` does this after the whole
    // batch, but `up()` can also be invoked directly, so it clears its own.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 135 applied', { organizationId, ...state, ...backfill })
    }
    // ⚠️ Deposits left unlinked are reported, not failed. An ambiguous code is
    // the expected outcome, not a broken migration.
    if (backfill.ambiguous > 0 || backfill.unmatched > 0) {
      logger.warn('Migration 135 left deposits without a bank account', {
        organizationId,
        ...backfill,
      })
    }
    return { ...state, alreadyUpToDate: !changed }
  },
}

/** The registry fields this migration adds, by key, loud if the registry renamed one. */
function pick(
  source: Record<string, ResourceField>,
  keys: readonly string[],
  entityType: string
): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of keys) {
    const field = source[key]
    if (!field) {
      throw new Error(`${entityType} registry is missing the key "${key}" (migration 135)`)
    }
    picked[key] = field
  }
  return picked
}

/**
 * Rename the stored label of the code field, so a deposit does not show two
 * fields both called "Bank Account".
 *
 * ⚠️ Guarded on the OLD label rather than written unconditionally. The field is
 * `configurable: false` so nothing in the product renames it today, but a
 * migration that overwrites a name it did not write is how a customer's edit
 * disappears, and 108's `refreshSelectOptions` is the precedent for not doing
 * that.
 */
async function relabelCodeField(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<boolean> {
  const label = BANK_DEPOSIT_FIELDS.bankAccountCode?.label
  if (!label) throw new Error('bank_deposit registry is missing bankAccountCode (migration 135)')

  const updated = await db
    .update(schema.CustomField)
    .set({ name: label, updatedAt: new Date() })
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
        eq(schema.CustomField.systemAttribute, CODE_ATTRIBUTE),
        eq(schema.CustomField.name, OLD_CODE_LABEL)
      )
    )
    .returning({ id: schema.CustomField.id })

  return updated.length > 0
}

/** What the backfill managed, and what it refused to guess at. */
export interface DepositBackfillStats {
  /** Deposits given a bank account. */
  linked: number
  /** Deposits whose code names more than one bank account, left null. */
  ambiguous: number
  /** Deposits whose code names no bank account at all, left null. */
  unmatched: number
}

/** What the backfill decided about one deposit. */
export type LinkDecision = 'link' | 'ambiguous' | 'unmatched' | 'skip'

/**
 * Whether one deposit's posted code names an account to link it to. **Pure, and
 * no database.**
 *
 * 🛑 **More than one candidate is `ambiguous`, never "pick the first".** A chart
 * code names at most one GL account but MANY bank accounts - two current
 * accounts both mapped to `1000 Checking` is ordinary. A guess here would attach
 * the deposit to an account it never went into and then hand that wrong answer
 * to the removal gate, which is worse than the null it replaces: null reads as
 * "unknown", and the code - the fact that IS true - stays on the row and on the
 * posted entry either way.
 *
 * Exported and pure so the rule is tested without a database, the way 118's
 * `resolveLabel` is.
 */
export function resolveLinkDecision(
  code: string | null | undefined,
  candidates: readonly string[] | undefined
): LinkDecision {
  if (!code?.trim()) return 'skip'
  if (!candidates || candidates.length === 0) return 'unmatched'
  if (candidates.length > 1) return 'ambiguous'
  return 'link'
}

/** Which defs and field the backfill works across. */
interface BackfillTargets {
  depositDefId: string
  accountDefId: string
  relationFieldId: string
}

/**
 * Link every deposit whose posted code names EXACTLY ONE bank account.
 *
 * 🛑 **Through `UnifiedCrudHandler.bulkUpdate`, never a raw `FieldValue` insert.**
 * A relationship is TWO rows - the owning side on the deposit and the inverse on
 * the account - and only the handler writes both. A hand-rolled insert of the
 * owning row alone leaves `bank_account.deposits` reading empty, which is
 * exactly the surface the removal gate is about to depend on. It is also one
 * write session, one permission assertion and one cache warm for the whole set
 * rather than per row.
 *
 * Exported so the selection can be exercised on its own, the way 134's backfill is.
 */
export async function backfillDepositBankAccount(
  db: Database,
  organizationId: string,
  targets: BackfillTargets
): Promise<DepositBackfillStats> {
  const stats: DepositBackfillStats = { linked: 0, ambiguous: 0, unmatched: 0 }

  const codeField = await findFieldByAttribute(db, organizationId, CODE_ATTRIBUTE)
  const glField = await findFieldByAttribute(db, organizationId, GL_ACCOUNT_ATTRIBUTE)
  if (!codeField || !glField) return stats

  // 🛑 LIVE deposits only. An archived deposit is one whose posting the ledger
  // refused - `rollbackDeposit` archives it - so there is nothing to put in the
  // gate, and `bulkUpdate` refuses it as "Entity not found" anyway. Without this
  // filter the backfill re-attempts them on EVERY run, logs an error per row,
  // and reports a `linked` count that does not add up to the candidates it took.
  const deposits = await db
    .select({ entityId: schema.FieldValue.entityId, code: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeField),
        isNotNull(schema.FieldValue.valueText),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (deposits.length === 0) return stats

  // Skip anything already linked: this migration is re-runnable, and a deposit
  // corrected by hand after an ambiguous first pass must not be overwritten.
  const present = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, targets.relationFieldId),
        inArray(
          schema.FieldValue.entityId,
          deposits.map((row) => row.entityId)
        )
      )
    )
  const alreadyLinked = new Set(present.map((row) => row.entityId))

  const accountsByCode = await mapAccountsByCode(db, organizationId, glField)

  const updates: { recordId: ReturnType<typeof toRecordId>; values: Record<string, unknown> }[] = []
  for (const deposit of deposits) {
    if (alreadyLinked.has(deposit.entityId)) continue
    const code = deposit.code?.trim()
    const candidates = code ? accountsByCode.get(code) : undefined
    const decision = resolveLinkDecision(code, candidates)
    if (decision === 'skip') continue
    if (decision === 'unmatched') {
      stats.unmatched++
      continue
    }
    if (decision === 'ambiguous') {
      stats.ambiguous++
      continue
    }
    updates.push({
      recordId: toRecordId(targets.depositDefId, deposit.entityId),
      values: {
        bank_deposit_bank_account_record: toRecordId(targets.accountDefId, candidates![0]!),
      },
    })
  }
  if (updates.length === 0) return stats

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
    session: seedSession('bank deposit bank account backfill'),
  })
  const result = await handler.bulkUpdate(updates)
  stats.linked = result.updated
  // ⚠️ Reported, not thrown. A deposit that would not take the link is one row
  // left where it already was - with its code intact - and failing the whole
  // migration over it would leave the field half-created for every other org.
  for (const failure of result.errors) {
    logger.error('Migration 135 could not link a deposit to its bank account', {
      organizationId,
      recordId: failure.recordId,
      error: failure.error,
    })
  }
  return stats
}

/**
 * Every LIVE bank account in the org, bucketed by the chart code it is mapped to.
 *
 * A LIST per code, not one account: several bank accounts legitimately share a
 * mapping, and collapsing them here is how the backfill would come to guess.
 *
 * 🛑 Archived accounts are excluded, and that is not a tidiness choice.
 * `createBankDeposit` REFUSES to bank into an archived account, so an archived
 * account is not a thing a deposit can be linked to - counting one as a
 * candidate only makes a code ambiguous that has exactly one real answer, and
 * the deposit then stays unlinked and outside the removal gate. Found on dev,
 * where an archived duplicate left by a drive script shared `1000` with the
 * account every deposit had actually gone into.
 */
async function mapAccountsByCode(
  db: Database,
  organizationId: string,
  glFieldId: string
): Promise<Map<string, string[]>> {
  const mappings = await db
    .select({ accountId: schema.FieldValue.entityId, code: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, glFieldId),
        isNotNull(schema.FieldValue.valueText),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  const byCode = new Map<string, string[]>()
  for (const row of mappings) {
    const code = row.code?.trim()
    if (!code) continue
    const bucket = byCode.get(code)
    if (bucket) bucket.push(row.accountId)
    else byCode.set(code, [row.accountId])
  }
  return byCode
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
