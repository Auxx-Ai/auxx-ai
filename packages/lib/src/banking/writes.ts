// packages/lib/src/banking/writes.ts

/**
 * The two writes the bank accounts settings page needs: adding an account by
 * hand, and editing the handful of fields a person owns on one
 * (plans/accounting/ui-plan.md §2.7, HANDOFF slot 2I).
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## What is deliberately NOT here
 *
 * **Connecting a bank.** That is `hosted-provision` plus a connector, and it
 * arrives with the bank feed wave. The router's `connect` procedure is a stub
 * that says so.
 *
 * **Deleting an account.** There is no delete and there will not be a hard one.
 * A `bank_transaction` that has been coded and posted is the source document of
 * a journal entry, so disconnecting sets `status: 'disconnected'` and keeps
 * every row - the movement ledger's rule, applied to cash
 * (plans/bank-connection/02-connection-architecture.md §5.1).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import {
  BANK_ACCOUNT_TYPES,
  type BankAccountRow,
  type BankAccountStatus,
  type BankAccountType,
} from './client'
import { guard } from './guard'
import { getBankAccount, requireBankAccountFieldContext } from './reads'

const logger = createScopedLogger('banking')

/** What `createBankAccount` accepts. Every field is what a person typed. */
export interface CreateBankAccountInput {
  organizationId: string
  actorUserId: string
  name: string
  institution?: string | null
  last4?: string | null
  type?: BankAccountType
  currency?: string | null
  glAccountCode?: string | null
  feedStartDate?: string | null
}

/** What `updateBankAccount` accepts. Undefined means "leave it alone". */
export interface UpdateBankAccountInput {
  organizationId: string
  actorUserId: string
  bankAccountId: string
  name?: string
  institution?: string | null
  last4?: string | null
  type?: BankAccountType
  currency?: string | null
  glAccountCode?: string | null
  feedStartDate?: string | null
  status?: BankAccountStatus
}

/**
 * Add a bank account by hand - no connector, `status: 'manual'`.
 *
 * ⚠️ **A manual account is not a lesser one.** It is the only account type that
 * exists until the feed wave lands, it is what a customer whose institution
 * Stripe FC does not cover will always use, and it is the fallback when a live
 * feed throws `credentials_invalid` mid-close. It maps to the chart, holds
 * imported statement lines and reports coverage exactly as a connected one does;
 * the only difference is where the rows came from.
 *
 * 🛑 `connectorId` is left null and `status` is forced to `manual`, whatever the
 * caller passes. A record claiming a connector it does not have would render a
 * live status line for a feed that will never sync.
 */
export async function createBankAccount(
  db: Database,
  input: CreateBankAccountInput
): Promise<Result<BankAccountRow, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)

      const name = input.name?.trim()
      if (!name) {
        throw new BadRequestError('A bank account needs a name')
      }
      const type = input.type ?? 'depository'
      if (!BANK_ACCOUNT_TYPES.includes(type)) {
        throw new BadRequestError(
          `"${type}" is not a bank account type. Use ${BANK_ACCOUNT_TYPES.join(' or ')}`
        )
      }
      const last4 = normalizeLast4(input.last4)

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const created = await crud.create(ctx.bankAccountDefId, {
        bank_account_name: name,
        bank_account_institution: input.institution?.trim() || undefined,
        bank_account_last4: last4 ?? undefined,
        bank_account_type: type,
        bank_account_currency: input.currency?.trim().toUpperCase() || 'USD',
        bank_account_gl_account: input.glAccountCode?.trim() || undefined,
        bank_account_feed_start_date: input.feedStartDate || undefined,
        bank_account_status: 'manual',
      })

      const row = await getBankAccount(db, {
        organizationId,
        bankAccountId: created.instance.id,
      })
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The bank account could not be read back after writing')
      }

      logger.info('Created a manual bank account', {
        organizationId,
        bankAccountId: created.instance.id,
        type,
      })
      return row.value
    },
    'Failed to create bank account',
    { organizationId }
  )
}

/**
 * Edit a bank account.
 *
 * 🛑 **The connector-owned identity fields are refused on a CONNECTED account.**
 * `name`, `institution`, `last4`, `type` and `currency` are what the bank said,
 * and the feed rewrites them on every sync - accepting an edit would produce a
 * change that silently reverts, which is worse than a refusal. On a manual
 * account they are the only source there is, so they are editable.
 *
 * `glAccount`, `feedStartDate` and `status` are always auxx's and always
 * editable. Mapping an account to a code is the whole point of the entity, and
 * a connected account is exactly the one that most needs mapping.
 *
 * ⚠️ `glAccountCode` is NOT validated against the org's chart here. The router
 * hands down a code the `GlAccountPicker` sourced from `ledger.chartAccounts`,
 * and `resolveRoles` refuses an unknown or wrongly-typed code at POST time with
 * a sentence naming the account - which is the message worth surfacing. A second
 * authority here would drift from it.
 */
export async function updateBankAccount(
  db: Database,
  input: UpdateBankAccountInput
): Promise<Result<BankAccountRow, Error>> {
  const { organizationId, actorUserId, bankAccountId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)

      const existing = await getBankAccount(db, { organizationId, bankAccountId })
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const isConnected = existing.value.connectorId != null
      const patch: Record<string, unknown> = {}

      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new BadRequestError('A bank account needs a name')
        refuseWhenConnected(isConnected, 'name')
        patch.bank_account_name = name
      }
      if (input.institution !== undefined) {
        refuseWhenConnected(isConnected, 'institution')
        patch.bank_account_institution = input.institution?.trim() || null
      }
      if (input.last4 !== undefined) {
        refuseWhenConnected(isConnected, 'last four')
        patch.bank_account_last4 = normalizeLast4(input.last4)
      }
      if (input.type !== undefined) {
        if (!BANK_ACCOUNT_TYPES.includes(input.type)) {
          throw new BadRequestError(
            `"${input.type}" is not a bank account type. Use ${BANK_ACCOUNT_TYPES.join(' or ')}`
          )
        }
        refuseWhenConnected(isConnected, 'type')
        patch.bank_account_type = input.type
      }
      if (input.currency !== undefined) {
        refuseWhenConnected(isConnected, 'currency')
        patch.bank_account_currency = input.currency?.trim().toUpperCase() || null
      }

      if (input.glAccountCode !== undefined) {
        patch.bank_account_gl_account = input.glAccountCode?.trim() || null
      }
      if (input.feedStartDate !== undefined) {
        patch.bank_account_feed_start_date = input.feedStartDate || null
      }
      if (input.status !== undefined) {
        patch.bank_account_status = input.status
      }

      if (Object.keys(patch).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(toRecordId(ctx.bankAccountDefId, bankAccountId), patch)
      }

      const row = await getBankAccount(db, { organizationId, bankAccountId })
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The bank account could not be read back after writing')
      }

      logger.info('Updated a bank account', {
        organizationId,
        bankAccountId,
        fields: Object.keys(patch),
      })
      return row.value
    },
    'Failed to update bank account',
    { organizationId, bankAccountId }
  )
}

/** The refusal a connector-owned field earns on a connected account. */
function refuseWhenConnected(isConnected: boolean, label: string): void {
  if (!isConnected) return
  throw new BadRequestError(
    `The ${label} of a connected account comes from the bank and cannot be edited here. ` +
      'Disconnect the account first, or correct it at your bank.'
  )
}

/**
 * The last four digits, as TEXT.
 *
 * Kept as a string and never parsed: a leading zero is part of the account, and
 * `0381` read as a number and rendered back is `381`, which matches nothing.
 * Anything but digits is refused rather than stripped, because silently turning
 * `**5381` into `5381` hides a paste error that will not match the statement.
 */
function normalizeLast4(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!/^\d{1,4}$/.test(trimmed)) {
    throw new BadRequestError('The last four is up to four digits, with nothing else in it')
  }
  return trimmed
}
