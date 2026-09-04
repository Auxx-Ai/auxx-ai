// packages/lib/src/seed/entity-migrations/migrations/125-accounting-books.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import { ensureSystemProfiles } from '../../../permissions/profiles'
import { seedSession, UnifiedCrudHandler } from '../../../resources/crud'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { BANK_DEPOSIT_FIELDS } from '../../../resources/registry/resources/bank-deposit-fields'
import { BANK_RULE_FIELDS } from '../../../resources/registry/resources/bank-rule-fields'
import { BANK_TRANSACTION_FIELDS } from '../../../resources/registry/resources/bank-transaction-fields'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { INVOICE_STATUS_OPTIONS } from '../../../resources/registry/resources/invoice-fields'
import { JOURNAL_ENTRY_FIELDS } from '../../../resources/registry/resources/journal-entry-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { PAYMENT_FIELDS } from '../../../resources/registry/resources/payment-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { seedDefaultChartOfAccounts } from '../../gl-account-chart'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'
import { appendMissingOptions } from './124-build-batch-source-and-period'

const logger = createScopedLogger('entity-migrations:125')

/** The def the chart lives on. Created by migration 108. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const COMPANY_ENTITY_TYPE = 'company'
const INVOICE_ENTITY_TYPE = 'invoice'
const ORDER_ENTITY_TYPE = 'order'
const BANK_TRANSACTION_ENTITY_TYPE = 'bank_transaction'
const INVOICE_STATUS_ATTRIBUTE = 'invoice_status'

/** The receivable account handoff decision 6.1 renames. */
export const RECEIVABLE_CODE = '1100'
/** What migration 108 seeded it as. Only a row still holding this name is renamed. */
export const RECEIVABLE_SEEDED_NAME = 'Accounts Receivable - Dealers'
/** What `default-chart.ts` calls it now. */
export const RECEIVABLE_NAME = 'Accounts Receivable'

/**
 * Fields added to defs this migration does NOT create are listed by REGISTRY
 * KEY rather than "everything new on that registry", so a later, unrelated
 * field cannot silently join this migration's payload.
 */
const PAYMENT_FIELD_KEYS = ['bankDeposit'] as const
const COMPANY_1099_FIELD_KEYS = [
  'taxClassification',
  'tin',
  'w9OnFile',
  'is1099Eligible',
  'default1099Box',
] as const
const ORDER_FIELD_KEYS = ['fulfillments'] as const
const BANK_TRANSACTION_SUGGESTION_FIELD_KEYS = [
  'suggestedGlAccount',
  'suggestedRecordId',
  'suggestedRecordType',
  'suggestionReason',
  'suggestionSource',
] as const

/** The union of the per-org cache keys the eight steps below invalidate. */
const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

/** The field map shape `ensureCustomFields` returns and the linkers consume. */
type FieldMap = Map<
  string,
  { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
>

/**
 * Migration 125: everything the accounting pass adds to an EXISTING org, in one
 * migration (plans/accounting/HANDOFF.md, plans/bank-connection/).
 *
 * The eight steps below were authored as eight migrations by eight parallel
 * slots and merged here before shipping, because they are one indivisible
 * feature: no org wants the `bank_rule` def without the `bank_transaction` def,
 * and half a chart of accounts posts nothing. They run in their original order
 * and each keeps its own dependency guard, so a step whose target def is absent
 * is SKIPPED rather than failed and picks itself up on a later run.
 *
 * ## What each step adds, per org
 *
 * 1. `extendChart` - the six accounts the default chart gained (`1050
 *    Undeposited Funds`, `3000 Owner's Equity`, `3100 Retained Earnings`,
 *    `3900 Opening Balance Equity`, `4020 Shipping Revenue`, `6300 Bad Debt
 *    Expense`), the thirteen role assignments onto accounts that already
 *    existed without one, and the `1100` rename - ONE receivable account
 *    carries the `accounts_receivable` role whatever the channel. The rename is
 *    guarded by the OLD name, not the code: a row whose name is still verbatim
 *    what 108 seeded is evidence nobody has edited it, and an org that renamed
 *    `1100` itself keeps its edit. The role is assigned either way, because the
 *    code is the identity. Requires the `gl_account` def (108).
 * 2. `addJournalEntryDef` - the `journal_entry` def, the DRAFT of a
 *    hand-authored posting. `GlPosting.status` has no draft state (`pending`
 *    means claimed and mid-push, holding the period's unique index), a
 *    `GlPosting` is a Drizzle table with no route to a `MediaAsset` for the
 *    evidence, and `RecurrenceRule.subjectId` needs an `EntityInstance`. Three
 *    independent reasons, one record. `glPostingId` is TEXT, not a
 *    RELATIONSHIP, because `GlPosting` is a table with no `EntityDefinition` to
 *    point at. Requires `gl_account`: an entry codes its lines against a chart.
 * 3. `addBankDepositDef` - the `bank_deposit` def plus `payment.bankDeposit`
 *    (`belongs_to`), so "which deposit was this cheque in" has exactly one
 *    answer. Both counterparts land in ONE field map because
 *    `linkNewRelationships` links what is in the map it is handed, not what is
 *    in the database. No backfill: no org has ever recorded which payments were
 *    banked together, and inventing a grouping from payment dates would produce
 *    deposits matching no bank line. Requires the `payment` def.
 * 4. `addBankAccountDefs` - the `bank_account` and `bank_transaction` defs and
 *    the relationship pair between them, same one-map reasoning as step 3. No
 *    `bank_connection` def (decision B4): the `DataConnector` row already
 *    carries connection state, and connection state must not have two answers.
 *    Both defs land EMPTY on every org. No dependency: `glAccount` is a CODE in
 *    TEXT (decision P2), so not even the chart is a prerequisite.
 * 5. `addCompany1099Fields` - the five 1099/W-9 fields on `company` and
 *    `written_off` appended to the stored `invoice_status` options. The append
 *    preserves every stored entry because `FieldValue.optionId` stores the
 *    option's `value`, so a rewrite-from-registry would discard an org's edited
 *    labels and colours.
 * 6. `addOrderFulfillments` - `order_fulfillments`, the shipment log. A field,
 *    not a `fulfillment` entity: a shipment has no independent identity and the
 *    normalised accounting copy is already in `GlPostingLine`. Without a
 *    per-line shipped quantity, a second fulfillment can re-ship a line the
 *    first already shipped and re-recognise its revenue - an entry that
 *    balances perfectly and overstates the P&L. No backfill: an existing
 *    `fulfilled` order reads `null`, which is the honest answer, because the
 *    historical status carries no quantities, no dates and no posting.
 * 7. `seedAccountantProfile` - the `accountant` system permission profile, for
 *    orgs created before the seed existed. New orgs get it through the
 *    org-creation call to `ensureSystemProfiles`; this is the same backfill,
 *    the same shape and the same reason as migration 053 for the agent presets.
 *    `PermissionProfile` is not `EntityInstance`-backed, so this step adds no
 *    `EntityDefinition` or `CustomField` row and contributes no counter.
 * 8. `addBankRuleDef` - the `bank_rule` def (its pointer fields are TEXT, not
 *    RELATIONSHIPs, so there is nothing to link) and the five suggestion
 *    columns on `bank_transaction`, which step 4 predates. No starter rule set:
 *    seeding rules would guess at accounts that may not exist in the org's own
 *    chart. No dependency on step 4 - a rule can be authored before any account
 *    is connected, and every pointer field is optional.
 *
 * ## Id space
 *
 * 125 is the next free number counted across BOTH `data-migrations/migrations/`
 * and `seed/entity-migrations/migrations/`, which share one keyspace and have
 * already collided once at 103.
 *
 * ## No DDL
 *
 * `EntityDefinition.entityType` is a `text()` column, so a new entity type is
 * this migration plus hand-edits to `enums.ts`, `types/resource/utils.ts`, the
 * system-attribute union, `field-registry.ts`, `create-fields.ts`,
 * `entity-seeder/constants.ts` and `record-numbering.ts`'s `SequenceScope`. The
 * only `.sql` this pass produced is the posting-type enum and the
 * `GlPostingLine.dimensions` column, drizzle 0361.
 *
 * Idempotent: every helper is insert-only or skips existing rows, the chart
 * seeder never touches an account the org already holds, `appendMissingOptions`
 * returns `null` once `written_off` is stored, the rename finds nothing to do
 * once applied, and `ensureSystemProfiles` inserts with `onConflictDoNothing`.
 */
export const migration125AccountingBooks: EntityMigration = {
  id: '125-accounting-books',
  description:
    'Everything the accounting pass adds to an existing org: the extended chart of accounts ' +
    'and its posting roles, the journal_entry, bank_deposit, bank_account, bank_transaction ' +
    'and bank_rule defs, the 1099/W-9 and write-off fields, the order shipment log, and the ' +
    'accountant permission profile',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    // Each step reloads `ExistingState` for itself: step 8 widens the
    // `bank_transaction` def step 4 creates, so a single snapshot taken up
    // front would be stale by the time the later steps read it.
    let changed = await extendChart(db, organizationId)
    changed = (await addJournalEntryDef(db, organizationId, state)) || changed
    changed = (await addBankDepositDef(db, organizationId, state)) || changed
    changed = (await addBankAccountDefs(db, organizationId, state)) || changed
    changed = (await addCompany1099Fields(db, organizationId, state)) || changed
    changed = (await addOrderFulfillments(db, organizationId, state)) || changed
    await seedAccountantProfile(organizationId, db)
    changed = (await addBankRuleDef(db, organizationId, state)) || changed

    // New definitions, fields and options are invisible to every read path
    // until the per-org caches that serve them are dropped.
    // `runEntityMigrationsForOrg` does this after the whole batch, but `up()`
    // can also be invoked directly, so it clears its own - once, for the union
    // of the keys the steps above touch.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 125 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

// ─── Step 1: the chart of accounts ───────────────────────────────────

/**
 * Seed the six new accounts, assign the thirteen roles and rename the seeded
 * `1100`. Returns whether anything changed.
 *
 * One call to `seedDefaultChartOfAccounts` rather than a second write path:
 * it is idempotent on `code` and its role insert is `ON CONFLICT
 * (organizationId, role) DO NOTHING`, written for role-carrying accounts
 * whether this pass created them or found them. Both halves are exactly what
 * an existing org needs, and writing them a second way would be the second
 * source of truth the chart module exists to avoid.
 */
async function extendChart(db: Database, organizationId: string): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)

  // An org short of migration 108 has no chart to extend; 108 seeds the whole
  // current `DEFAULT_CHART_OF_ACCOUNTS`, so a later run of it picks all of
  // this up on its own.
  const def = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
  if (!def) return false

  const renamed = await renameSeededReceivable(db, organizationId, def.id)
  const chart = await seedDefaultChartOfAccounts(db, organizationId, def.id)

  return renamed || chart.created > 0 || chart.rolesAssigned > 0
}

/**
 * Rename the seeded `1100` row where its name is still verbatim what 108 wrote.
 * Returns whether a row changed.
 */
async function renameSeededReceivable(
  db: Database,
  organizationId: string,
  glAccountDefId: string
): Promise<boolean> {
  const fields = await db
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, glAccountDefId)
      )
    )
  const codeField = fields.find((f) => f.systemAttribute === 'gl_account_code')
  const nameField = fields.find((f) => f.systemAttribute === 'gl_account_name')
  if (!codeField || !nameField) return false

  const [codeRow] = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeField.id),
        eq(schema.FieldValue.valueText, RECEIVABLE_CODE)
      )
    )
    .limit(1)
  if (!codeRow) return false

  const [nameRow] = await db
    .select({ name: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, codeRow.entityId),
        eq(schema.FieldValue.fieldId, nameField.id)
      )
    )
    .limit(1)
  if (nameRow?.name !== RECEIVABLE_SEEDED_NAME) return false

  // Through the handler rather than a raw `FieldValue` update so the
  // instance's display name is recomputed the same way an edit from the
  // chart page would recompute it.
  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
    session: seedSession('gl account chart extension'),
  })
  await handler.update(toRecordId(glAccountDefId, codeRow.entityId), {
    gl_account_name: RECEIVABLE_NAME,
  })
  return true
}

// ─── Step 2: the journal_entry def ───────────────────────────────────

/**
 * Create the `journal_entry` def with its full registry. Returns whether
 * anything changed.
 *
 * Visibility comes from `SYSTEM_ENTITIES` (`isVisible: false`), so a fresh org
 * and a migrated one agree - `ensureEntityDefinitions` never revisits an
 * existing row, which is the trap migration 110-build-visible exists to correct
 * for `build`.
 */
async function addJournalEntryDef(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  // `gl_account` is a real dependency rather than a formality: a journal entry
  // codes its lines against the chart, so an org with no chart def has nothing
  // to write an entry about.
  if (!existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)) return false

  const entityDefIds = await ensureEntityDefinitions(
    db,
    organizationId,
    SYSTEM_ENTITIES.filter((e) => e.entityType === 'journal_entry'),
    existing,
    state
  )

  const fieldMap: FieldMap = new Map()
  const defId = entityDefIds.get('journal_entry')
  if (defId) {
    const created = await ensureCustomFields(
      db,
      organizationId,
      'journal_entry',
      defId,
      JOURNAL_ENTRY_FIELDS,
      existing,
      state
    )
    for (const [key, value] of created) fieldMap.set(key, value)
  }

  // `linkNewRelationships` is called for symmetry with every other step that
  // creates a def; this one contributes no relationship field, so it writes
  // nothing. Removing it would make the next person adding an edge here
  // discover the omission by watching a relationship silently not link.
  await linkNewRelationships(db, fieldMap, entityDefIds, state)
  await linkDisplayFields(db, ['journal_entry'], entityDefIds, fieldMap)

  return didChange(before, state)
}

// ─── Step 3: the bank_deposit def and the payment link ───────────────

/** Create the `bank_deposit` def and `payment.bankDeposit`. */
async function addBankDepositDef(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  // Without `payment` there is nothing to group and nowhere to hang the owning
  // side of the relationship. Skipped rather than failed: migration 002 seeds
  // the full registry, so an org short of it picks up both defs there.
  const paymentDef = existing.entityDefs.get('payment')
  if (!paymentDef) return false

  const entityDefIds = await ensureEntityDefinitions(
    db,
    organizationId,
    SYSTEM_ENTITIES.filter((e) => e.entityType === 'bank_deposit'),
    existing,
    state
  )

  // Pull `payment` into the id map so `linkNewRelationships` can resolve BOTH
  // directions of the pair in the single pass below.
  entityDefIds.set('payment', paymentDef.id)

  const fieldMap: FieldMap = new Map()
  const merge = (m: FieldMap) => {
    for (const [k, v] of m) fieldMap.set(k, v)
  }

  const depositDefId = entityDefIds.get('bank_deposit')
  if (depositDefId) {
    merge(
      await ensureCustomFields(
        db,
        organizationId,
        'bank_deposit',
        depositDefId,
        BANK_DEPOSIT_FIELDS,
        existing,
        state
      )
    )
  }

  merge(
    await ensureCustomFields(
      db,
      organizationId,
      'payment',
      paymentDef.id,
      pickFields(PAYMENT_FIELDS, PAYMENT_FIELD_KEYS, 'payment'),
      existing,
      state
    )
  )

  await linkNewRelationships(db, fieldMap, entityDefIds, state)
  await linkDisplayFields(db, ['bank_deposit'], entityDefIds, fieldMap)

  return didChange(before, state)
}

// ─── Step 4: the bank_account and bank_transaction defs ──────────────

/** The two defs step 4 creates, and the field maps that fill them. */
const BANK_TYPES = ['bank_account', 'bank_transaction'] as const

const BANK_FIELDS_BY_TYPE: Record<(typeof BANK_TYPES)[number], Record<string, ResourceField>> = {
  bank_account: BANK_ACCOUNT_FIELDS,
  bank_transaction: BANK_TRANSACTION_FIELDS,
}

/** Create both bank defs and the relationship pair between them. */
async function addBankAccountDefs(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  const entityDefIds = await ensureEntityDefinitions(
    db,
    organizationId,
    SYSTEM_ENTITIES.filter((e) => (BANK_TYPES as readonly string[]).includes(e.entityType)),
    existing,
    state
  )

  const fieldMap: FieldMap = new Map()
  for (const entityType of BANK_TYPES) {
    const defId = entityDefIds.get(entityType)
    if (!defId) continue
    const fields = await ensureCustomFields(
      db,
      organizationId,
      entityType,
      defId,
      BANK_FIELDS_BY_TYPE[entityType],
      existing,
      state
    )
    for (const [key, value] of fields) fieldMap.set(key, value)
  }

  await linkNewRelationships(db, fieldMap, entityDefIds, state)
  await linkDisplayFields(db, [...BANK_TYPES], entityDefIds, fieldMap)

  return didChange(before, state)
}

// ─── Step 5: the 1099/W-9 fields and the written_off status ──────────

/** Widen `company` with the five 1099/W-9 fields and `invoice_status` with `written_off`. */
async function addCompany1099Fields(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  // Absent rather than failed: an org short of the `company` def has nothing to
  // widen, and the def is seeded for every org from day one anyway.
  const companyDef = existing.entityDefs.get(COMPANY_ENTITY_TYPE)
  if (companyDef) {
    await ensureCustomFields(
      db,
      organizationId,
      COMPANY_ENTITY_TYPE,
      companyDef.id,
      pickFields(COMPANY_FIELDS, COMPANY_1099_FIELD_KEYS, 'company'),
      existing,
      state
    )
  }

  let optionAdded = false
  const invoiceDef = existing.entityDefs.get(INVOICE_ENTITY_TYPE)
  if (invoiceDef) {
    optionAdded = await addWrittenOffStatusOption(db, organizationId, invoiceDef.id)
  }

  return didChange(before, state) || optionAdded
}

/**
 * Add `written_off` to the org's stored `invoice_status` options, preserving
 * everything already there. Returns whether a row was written.
 *
 * Mirrors 124's `addBatchSourceOption` exactly - same reasoning, different def.
 */
async function addWrittenOffStatusOption(
  db: Database,
  organizationId: string,
  entityDefId: string
): Promise<boolean> {
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, entityDefId),
      eq(schema.CustomField.systemAttribute, INVOICE_STATUS_ATTRIBUTE)
    ),
    columns: { id: true, options: true },
  })
  if (!field) return false

  const stored = (field.options as { options?: { value: string; label: string }[] } | null)?.options
  if (!Array.isArray(stored)) return false

  const next = appendMissingOptions(stored, INVOICE_STATUS_OPTIONS)
  if (!next) return false

  await db
    .update(schema.CustomField)
    .set({
      options: { ...(field.options as FieldOptions), options: next },
      updatedAt: new Date(),
    })
    .where(eq(schema.CustomField.id, field.id))

  return true
}

// ─── Step 6: the order shipment log ──────────────────────────────────

/** Add `order_fulfillments` to the existing `order` def. */
async function addOrderFulfillments(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  // An org that has not reached `order` yet gets the field from the registry at
  // seed time, the same way migrations 119/121/122 skip an org short of their
  // target def.
  const orderDef = existing.entityDefs.get(ORDER_ENTITY_TYPE)
  if (!orderDef) return false

  await ensureCustomFields(
    db,
    organizationId,
    ORDER_ENTITY_TYPE,
    orderDef.id,
    pickFields(ORDER_FIELDS, ORDER_FIELD_KEYS, 'order'),
    existing,
    state
  )

  return didChange(before, state)
}

// ─── Step 7: the accountant permission profile ───────────────────────

/**
 * Seed the `accountant` system permission profile into this org.
 *
 * `PermissionProfile`/`PermissionGrant` are not `EntityInstance`-backed, so
 * this step creates no `EntityDefinition` or `CustomField` row and contributes
 * no counter to the result: `ensureSystemProfiles` reports nothing about what
 * it inserted, and it is cheap and idempotent (`onConflictDoNothing` on
 * `(organizationId, slug)`), so it runs unconditionally for every org rather
 * than claiming a change it cannot prove. A pre-existing profile - including an
 * admin-edited `accountant` row - is never touched.
 */
async function seedAccountantProfile(organizationId: string, db: Database): Promise<void> {
  await ensureSystemProfiles(organizationId, db)
  await onCacheEvent('permission-profile.changed', { orgId: organizationId })
}

// ─── Step 8: the bank_rule def and the suggestion fields ─────────────

/**
 * Create the `bank_rule` def and backfill the five suggestion columns onto
 * `bank_transaction`.
 *
 * No relationship pair: `bankAccount`, `counterpartBankAccount` and `contact`
 * are entity-instance id pointers as TEXT, not RELATIONSHIPs, so there is
 * nothing for `linkNewRelationships` to do (see `bank-rule-fields.ts`'s header).
 */
async function addBankRuleDef(
  db: Database,
  organizationId: string,
  state: CreatedCounters
): Promise<boolean> {
  const existing = await loadExistingState(db, organizationId)
  const before = snapshot(state)

  const entityDefIds = await ensureEntityDefinitions(
    db,
    organizationId,
    SYSTEM_ENTITIES.filter((e) => e.entityType === 'bank_rule'),
    existing,
    state
  )

  const defId = entityDefIds.get('bank_rule')
  if (defId) {
    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      'bank_rule',
      defId,
      BANK_RULE_FIELDS,
      existing,
      state
    )
    await linkDisplayFields(db, ['bank_rule'], entityDefIds, fieldMap)
  }

  // The five suggestion columns were added to `bank-transaction-fields.ts`
  // after step 4 was authored. Absent rather than failed: an org short of the
  // `bank_transaction` def picks all of it up together, because step 4 seeds
  // the full current field map.
  const bankTransactionDef = existing.entityDefs.get(BANK_TRANSACTION_ENTITY_TYPE)
  if (bankTransactionDef) {
    await ensureCustomFields(
      db,
      organizationId,
      BANK_TRANSACTION_ENTITY_TYPE,
      bankTransactionDef.id,
      pickFields(
        BANK_TRANSACTION_FIELDS,
        BANK_TRANSACTION_SUGGESTION_FIELD_KEYS,
        'bank_transaction'
      ),
      existing,
      state
    )
  }

  return didChange(before, state)
}

// ─── Shared step plumbing ────────────────────────────────────────────

interface CreatedCounters {
  entityDefsCreated: number
  fieldsCreated: number
  relationshipsLinked: number
}

/** Copy the counters so a step can tell whether IT wrote anything. */
function snapshot(state: CreatedCounters): CreatedCounters {
  return { ...state }
}

function didChange(before: CreatedCounters, after: CreatedCounters): boolean {
  return (
    after.entityDefsCreated > before.entityDefsCreated ||
    after.fieldsCreated > before.fieldsCreated ||
    after.relationshipsLinked > before.relationshipsLinked
  )
}

/**
 * Take the named keys off a registry, loudly rather than silently: a renamed
 * registry key would otherwise make this migration quietly create one field
 * fewer than it claims to.
 */
function pickFields(
  registry: Record<string, ResourceField>,
  keys: readonly string[],
  entityType: string
): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of keys) {
    const field = registry[key]
    if (!field) {
      throw new Error(`${entityType} registry is missing the key "${key}" (migration 125)`)
    }
    picked[key] = field
  }
  return picked
}
