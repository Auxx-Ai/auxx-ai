// packages/lib/src/money/quickbooks/account-map.ts

/**
 * The `G19` account map, QuickBooks side: which QuickBooks account each of the
 * org's own `gl_account` rows corresponds to.
 *
 * ## Where the mapping actually lives
 *
 * In the `qboAccountId` cell on the `gl_account` instance - a hidden,
 * connection-scoped, `identity: true` field the QuickBooks app declares
 * (`auxxai-apps/apps/quickbooks/src/fields.ts`), mirrored into `RecordIdentity`
 * by the platform. Exactly the pattern `qboCustomerId` / `qboItemId` /
 * `qboInvoiceId` already use, and the one `gl-account-fields.ts` and entity
 * migration 114 both say in writing is where a provider's account id goes:
 * "`gl_account` is NOT touched. It stays an `EntityInstance` on purpose -
 * `RecordIdentity` is keyed on an instance and has no other addressing mode, and
 * decision `P2` hangs the provider's account id there."
 *
 * 🛑 **No `source` or `confirmedAt` anywhere, and that is the design.** `G19`
 * requires a suggested match to read differently from a confirmed one. Here that
 * distinction is structural rather than stored: the suggester
 * (`postings/suggest-account-identities.ts`) is PURE and never writes, and the
 * only writer is a person confirming in the setup wizard. So a populated cell
 * IS a confirmation, and an empty one is an open question. Two states, no
 * columns, and no way for a stored flag to drift out of step with the cell it
 * describes.
 *
 * ## Connection-scoped, which is load-bearing
 *
 * A QuickBooks account id means nothing against a different QuickBooks company.
 * The field is `scope: 'connection'`, so reconnecting to another realm resolves
 * a different `CustomField` and the previous company's map is neither read nor
 * silently reused. That is the one property a plain system field on `gl_account`
 * could not have given.
 */

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { deleteRecordIdentity } from '../../identity'
import type { ProviderAccount } from '../../postings/client'
import { QUICKBOOKS_SOURCE, writeQuickbooksIdField } from './identity-field'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-account-map')

/** The app field key holding one `gl_account`'s QuickBooks `Account.Id`. */
export const QBO_ACCOUNT_ID_FIELD = 'qboAccountId'

/** The system entity type slug the map hangs on. Not the definition's UUID. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** `list_quickbooks_accounts`, as this module consumes it. */
interface MappedAccount {
  id: string
  name: string
  fullyQualifiedName: string
  acctNum: string | null
  accountType: string
  classification: string
  active: boolean
}

/**
 * QuickBooks' five-way `Classification` mapped onto ours.
 *
 * Both vocabularies are the same five statement sections, so this is a rename
 * rather than a judgement - which is why an unrecognised value is DROPPED below
 * rather than defaulted. A provider account whose section we cannot read must
 * not be offered as a candidate for any of ours: `suggestAccountIdentities`
 * filters on classification, and a wrong default there would offer a revenue
 * account for a liability and produce an entry that balances and misstates the
 * P&L.
 */
const CLASSIFICATION: Record<string, ProviderAccount['classification']> = {
  Asset: 'asset',
  Liability: 'liability',
  Equity: 'equity',
  Revenue: 'revenue',
  Expense: 'expense',
}

/**
 * The connected company's chart, in the provider-neutral shape a mapping screen
 * reads.
 *
 * Inactive accounts are KEPT, unlike `fetchChart`'s posting-path read. A screen
 * has to be able to say "this mapping points at an account that has been
 * deactivated", and it cannot say that about a row it never received - which is
 * `G19`'s revalidation requirement and the difference between a repair prompt
 * and a silently missing row.
 */
export async function listQuickbooksProviderAccounts(
  ctx: QuickbooksToolContext
): Promise<ProviderAccount[]> {
  const result = await ctx.callTool('list_quickbooks_accounts', {})
  const raw: MappedAccount[] = Array.isArray(result?.accounts) ? result.accounts : []

  const accounts: ProviderAccount[] = []
  for (const account of raw) {
    const classification = CLASSIFICATION[account.classification]
    if (!classification) {
      logger.warn('Skipping a QuickBooks account with an unreadable classification', {
        providerAccountId: account.id,
        classification: account.classification,
      })
      continue
    }
    accounts.push({
      id: String(account.id),
      name: account.name,
      fullyQualifiedName: account.fullyQualifiedName || account.name,
      number: account.acctNum?.trim() || null,
      accountType: account.accountType,
      classification,
      active: account.active !== false,
    })
  }
  return accounts
}

/**
 * Every `gl_account` in this org that carries a QuickBooks account id, as
 * `glAccountId -> providerAccountId`.
 *
 * 🛑 **One query for the whole chart, never one per account.** The poster
 * resolves every line of an entry through this map and the settings screen
 * renders all 29 rows from it; a per-record read (`readQuickbooksIdField`, which
 * needs a `UnifiedCrudHandler`) would be 29 round trips to answer one question.
 * Reading `FieldValue` directly is the same shortcut `chart-accounts.ts` takes
 * for the same reason.
 *
 * ⚠️ The join column is `FieldValue.entityId`, NOT `entityInstanceId` - the trap
 * `plans/money/HANDOFF.md` §3 records because it has been got wrong twice.
 *
 * Returns an EMPTY map, not an error, when the field is not provisioned. That is
 * the state of every org until the QuickBooks app is deployed with
 * `qboAccountId`, and it means exactly what an unmapped chart means: nothing is
 * confirmed yet.
 */
export async function readQuickbooksAccountMap(params: {
  organizationId: string
  installationId: string
  connectionId: string
}): Promise<Map<string, string>> {
  const { organizationId, installationId, connectionId } = params

  const field = await database.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.appInstallationId, installationId),
      eq(schema.CustomField.connectionId, connectionId),
      eq(schema.CustomField.appFieldKey, QBO_ACCOUNT_ID_FIELD)
    ),
    columns: { id: true },
  })
  if (!field) {
    logger.debug('qboAccountId is not provisioned for this connection - the map is empty', {
      organizationId,
    })
    return new Map()
  }

  const rows = await database
    .select({ entityId: schema.FieldValue.entityId, valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        isNotNull(schema.FieldValue.valueText)
      )
    )

  const map = new Map<string, string>()
  for (const row of rows) {
    const value = row.valueText?.trim()
    if (value) map.set(row.entityId, value)
  }
  return map
}

/**
 * Confirm one pairing: this `gl_account` IS that QuickBooks account.
 *
 * Writes the cell and mirrors it into `RecordIdentity` through the shared
 * `writeQuickbooksIdField`, so the account map converges on the same reverse
 * lookup every other QuickBooks id already uses.
 *
 * The caller validates that the pairing is legal - the account exists, the
 * provider account is active, and the two classifications agree. That check
 * lives in `postings/suggest-account-identities.ts` because the resolver runs it
 * too, and one copy is what keeps a mapping the wizard accepted from being one
 * the close refuses.
 */
export async function setQuickbooksAccountMapping(params: {
  organizationId: string
  installationId: string
  connectionId: string
  glAccountId: string
  providerAccountId: string
  userId?: string
}): Promise<void> {
  await writeQuickbooksIdField({
    organizationId: params.organizationId,
    installationId: params.installationId,
    connectionId: params.connectionId,
    appFieldKey: QBO_ACCOUNT_ID_FIELD,
    entityType: GL_ACCOUNT_ENTITY_TYPE,
    entityInstanceId: params.glAccountId,
    externalId: params.providerAccountId,
    userId: params.userId,
  })
}

/**
 * Withdraw a confirmation - the account goes back to unmapped.
 *
 * Both halves are removed, the cell and its `RecordIdentity` mirror, because a
 * mirror outliving its cell is exactly the drift the reconciler exists to catch
 * and there is no reason to create work for it here.
 *
 * 🛑 Clearing is not the same as pointing the mapping somewhere else, and the UI
 * must not offer it as "no account". An unmapped account blocks the close with a
 * message naming it; a mapping quietly cleared during a close is the same
 * outcome with no sentence attached.
 */
export async function clearQuickbooksAccountMapping(params: {
  organizationId: string
  installationId: string
  connectionId: string
  glAccountId: string
  userId?: string
}): Promise<void> {
  const { organizationId, installationId, connectionId, glAccountId, userId } = params

  const field = await database.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.appInstallationId, installationId),
      eq(schema.CustomField.connectionId, connectionId),
      eq(schema.CustomField.appFieldKey, QBO_ACCOUNT_ID_FIELD)
    ),
    columns: { id: true },
  })
  if (!field) return

  const service = new FieldValueService(organizationId, userId)
  await service.deleteValue({
    recordId: toRecordId(GL_ACCOUNT_ENTITY_TYPE, glAccountId),
    fieldId: field.id,
  })

  const removed = await deleteRecordIdentity({
    organizationId,
    entityInstanceId: glAccountId,
    source: QUICKBOOKS_SOURCE,
    connectionId,
    appFieldKey: QBO_ACCOUNT_ID_FIELD,
  })
  if (!removed.ok) {
    logger.warn('Cleared the qboAccountId cell but not its RecordIdentity mirror', {
      organizationId,
      glAccountId,
      error: removed.error.message,
    })
  }
}

/**
 * The `gl_account` definition id, for callers that need to scope a query to the
 * chart. Null when the org has no chart provisioned at all.
 */
export async function getGlAccountDefinitionId(organizationId: string): Promise<string | null> {
  return (await getCachedEntityDefId(organizationId, GL_ACCOUNT_ENTITY_TYPE)) ?? null
}

/** Narrow the map to one org's live chart, dropping cells whose account is gone. */
export function scopeMapToChart(
  map: ReadonlyMap<string, string>,
  glAccountIds: readonly string[]
): Map<string, string> {
  const live = new Set(glAccountIds)
  const scoped = new Map<string, string>()
  for (const [glAccountId, providerAccountId] of map) {
    if (live.has(glAccountId)) scoped.set(glAccountId, providerAccountId)
  }
  return scoped
}
