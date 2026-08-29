// packages/lib/src/postings/chart-accounts.ts

/**
 * How this codebase reads one org's chart of accounts. Exactly once.
 *
 * Two peers need the same chart and want different things from it:
 *
 * ```
 *   resolve-roles.ts    accounts BY ID, for the roles an entry names,
 *                       shaped as ResolvedAccount, then role-checked
 *   role-map.ts         accounts BY ID (a mapping's target) and the WHOLE
 *                       gl_account def (the picker), shaped as ChartAccountRow
 * ```
 *
 * The QUERIES differ and should - a filter list is not a whole definition. What
 * must not differ is the part below the queries: which four attributes make an
 * account, how a `CustomField` id is found for each, what an unprovisioned chart
 * refuses with, and how a pile of `FieldValue` rows becomes a typed account.
 *
 * 🛑 **A second copy of this decode is the thing that drifts.** It is the same
 * argument `resolve-roles.ts`'s header makes about the role vocabulary and
 * `GlRoleAssignment.role`'s column comment makes about not being a pgEnum: the
 * two readers would disagree about what an account SAYS, and the disagreement
 * would surface as a role map that shows an account the resolver refuses to post
 * to - two screens, two truths, one chart. So the decode lives here and the
 * callers own only their query and their output shape.
 *
 * ⚠️ **Nothing here is cached, deliberately.** `resolve-roles.ts` carries the
 * long argument: `INVALIDATION_GRAPH` has no per-record event for a `gl_account`
 * rename or archive, so a cached key is correct for an hour and then fails OPEN.
 * The `customFields` org-cache lookup below is a different thing - it caches the
 * SCHEMA, which does have `custom-field.*` events - and is fine.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import type { GlAccountTypeValue } from './default-chart'
import type { ChartAccountRow } from './types'

/**
 * The `gl_account` attributes an account is made of. All four, one list.
 *
 * `gl_account_code` and `gl_account_type` are hard requirements - without a code
 * there is no auditable ledger line (`P2`) and without a type there is nothing to
 * check a role against. `gl_account_name` and `gl_account_is_active` are
 * tolerated absent; see {@link decodeChartAccounts} for what absence means.
 */
export const ACCOUNT_ATTRIBUTES = [
  'gl_account_code',
  'gl_account_name',
  'gl_account_type',
  'gl_account_is_active',
] as const

/** The four `CustomField` rows a `gl_account` is read through. */
export interface ChartAccountFields {
  /**
   * `entityDefinitionId` is carried because the field is also how the
   * `gl_account` DEFINITION is found - it exists if and only if the def does, so
   * a caller listing the whole chart needs no second cache key.
   */
  code: { id: string; entityDefinitionId: string | null }
  name: { id: string } | null
  type: { id: string }
  active: { id: string } | null
}

/**
 * Accounts that decoded, and the ids of the ones that did not.
 *
 * `malformed` is returned rather than logged here on purpose: whether a skipped
 * account is worth a log line depends on the door. The role map's picker logs it
 * so a malformed account is findable rather than merely invisible; the resolver
 * says nothing, because a role pointing at an undecodable account already
 * produces a refusal naming that role, and a warning would just be the same fact
 * twice under a different scope.
 */
export interface ChartAccountsRead {
  accounts: Map<string, ChartAccountRow>
  malformed: string[]
}

/**
 * Resolve the four `gl_account` field ids through the org cache.
 *
 * @param notProvisionedMessage what to refuse with when `gl_account_code` or
 *   `gl_account_type` is missing. The FACT checked is the same for every caller;
 *   the advice is not - a resolver reached at post time and a setup screen reached
 *   from settings tell different readers to do different things, and this module
 *   refuses to pick one sentence for both. Pass your own, verbatim.
 * @throws {UnprocessableEntityError} when the chart is not provisioned.
 */
export async function loadChartAccountFields(
  organizationId: string,
  notProvisionedMessage: string
): Promise<ChartAccountFields> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ACCOUNT_ATTRIBUTES])

  const code = fields.gl_account_code
  const type = fields.gl_account_type

  if (!code || !type) {
    throw new UnprocessableEntityError(notProvisionedMessage, { organizationId })
  }

  return {
    code: { id: code.id, entityDefinitionId: code.entityDefinitionId ?? null },
    name: fields.gl_account_name ? { id: fields.gl_account_name.id } : null,
    type: { id: type.id },
    active: fields.gl_account_is_active ? { id: fields.gl_account_is_active.id } : null,
  }
}

/**
 * Read and decode the `FieldValue` rows for a set of live `gl_account` instances.
 *
 * ⚠️ The join column is `FieldValue.entityId`, NOT `entityInstanceId`, and a
 * `SINGLE_SELECT` stores its chosen value in `optionId` rather than `valueText` -
 * for a system-seeded enum that id IS the value (`'liability'`). Both are
 * recorded in `plans/money/HANDOFF.md` §3 because both have been got wrong.
 *
 * An empty id list short-circuits without touching the database.
 */
export async function readChartAccountValues(
  db: Database,
  organizationId: string,
  instanceIds: string[],
  fields: ChartAccountFields
): Promise<ChartAccountsRead> {
  if (instanceIds.length === 0) return { accounts: new Map(), malformed: [] }

  const fieldIds = [fields.code.id, fields.type.id]
  if (fields.name) fieldIds.push(fields.name.id)
  if (fields.active) fieldIds.push(fields.active.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      optionId: schema.FieldValue.optionId,
      valueBoolean: schema.FieldValue.valueBoolean,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, instanceIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  return decodeChartAccounts(values, fields)
}

/** One `FieldValue` row, as narrow as the decode actually needs it. */
export interface ChartAccountValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  optionId: string | null
  valueBoolean: boolean | null
}

/**
 * Turn `FieldValue` rows into typed accounts. Pure - no db, no cache, no log.
 *
 * 🛑 An account missing `code` or `accountType` is ABSENT, never defaulted. A
 * blank code on a ledger line is unauditable (`P2`), and guessing a type would
 * defeat the compatibility check that is the only reason the type is read at all.
 * Its id goes to `malformed` so the caller can decide whether to say so.
 */
export function decodeChartAccounts(
  values: readonly ChartAccountValueRow[],
  fields: ChartAccountFields
): ChartAccountsRead {
  const draft = new Map<
    string,
    { code?: string; name?: string; accountType?: string; isActive?: boolean }
  >()
  for (const row of values) {
    const entry = draft.get(row.entityId) ?? {}
    if (row.fieldId === fields.code.id) entry.code = row.valueText ?? undefined
    // A SINGLE_SELECT stores its chosen value in `optionId`; for a system-seeded
    // enum that id IS the value ('liability').
    else if (row.fieldId === fields.type.id) entry.accountType = row.optionId ?? undefined
    else if (fields.name && row.fieldId === fields.name.id) entry.name = row.valueText ?? undefined
    else if (fields.active && row.fieldId === fields.active.id)
      entry.isActive = row.valueBoolean ?? undefined
    draft.set(row.entityId, entry)
  }

  const accounts = new Map<string, ChartAccountRow>()
  const malformed: string[] = []
  for (const [id, entry] of draft) {
    if (!entry.code || !entry.accountType) {
      malformed.push(id)
      continue
    }
    accounts.set(id, {
      id,
      code: entry.code,
      name: entry.name ?? '',
      accountType: entry.accountType as GlAccountTypeValue,
      // `gl_account_is_active` declares `defaultValue: true`, and an account
      // written before the field existed has no row at all. Absence therefore
      // means active - the opposite reading would refuse to post to, and would
      // hide, a chart nobody has ever deactivated anything in.
      isActive: entry.isActive ?? true,
    })
  }

  return { accounts, malformed }
}

/**
 * Load the named `gl_account` instances, decoded.
 *
 * Archived instances are excluded by the QUERY rather than filtered afterwards,
 * so "archived" and "deleted" produce one answer: from a mapping's point of view
 * they are the same fact - the account it names is not available.
 *
 * An empty id list short-circuits without touching the cache OR the database, so
 * a fresh org with no assignments gets an empty chart rather than a provisioning
 * refusal.
 *
 * @param notProvisionedMessage see {@link loadChartAccountFields}.
 */
export async function loadChartAccountsById(
  db: Database,
  organizationId: string,
  accountIds: string[],
  notProvisionedMessage: string
): Promise<ChartAccountsRead> {
  if (accountIds.length === 0) return { accounts: new Map(), malformed: [] }

  const fields = await loadChartAccountFields(organizationId, notProvisionedMessage)

  const live = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...new Set(accountIds)]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  return readChartAccountValues(
    db,
    organizationId,
    live.map((row) => row.id),
    fields
  )
}
