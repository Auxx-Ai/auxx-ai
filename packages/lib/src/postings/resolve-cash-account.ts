// packages/lib/src/postings/resolve-cash-account.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import { getOrgCache } from '../cache/singletons'
import { UnprocessableEntityError } from '../errors'

/**
 * The GL account a `bank_account` record points at, or a refusal naming which
 * link is missing.
 *
 * 🔑 **Why this is a pointer lookup and not a role.** `bank` IS a role, but a
 * rail-scoped one (58 §5.1): it answers "which bank does THIS rail settle to".
 * A hand-recorded payment has no rail and names its bank account directly, so
 * the account to debit is a property of the record the money landed in, read
 * through `bank_account_gl_account`.
 *
 * ⚠️ The definition id is checked, not just the instance id. A
 * `cashAccountInstanceId` FK guarantees an `EntityInstance` in this
 * organization and nothing more; debiting a record that is not a bank account
 * would put the money somewhere no reconciliation will ever look for it.
 *
 * Extracted from the copy inlined in `customer-money/refund-accounting.ts`,
 * which needed the identical five reads.
 */
export async function resolveBankAccountGlAccountInTx(
  tx: Transaction,
  organizationId: string,
  bankAccountInstanceId: string,
  /** Prefixes every refusal, so the caller's flow is named in the message. */
  subject: string
): Promise<string> {
  const bankDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  const field = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['bank_account_gl_account'])
  const fieldId = field.bank_account_gl_account?.id
  if (!bankDefId || !fieldId)
    throw new UnprocessableEntityError(`${subject} bank account mapping is not provisioned`)

  const [bank] = await tx
    .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, bankDefId),
        eq(schema.EntityInstance.id, bankAccountInstanceId)
      )
    )
    .limit(1)
  if (!bank || bank.archivedAt)
    throw new UnprocessableEntityError(`${subject} bank account is missing or archived`)

  const [mapping] = await tx
    .select({ valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, bank.id),
        eq(schema.FieldValue.fieldId, fieldId)
      )
    )
    .limit(1)
  const glAccountId = mapping?.valueText?.trim()
  if (!glAccountId)
    throw new UnprocessableEntityError(`${subject} bank account has no GL account linked`)
  return glAccountId
}
