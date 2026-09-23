// packages/lib/src/accounting/providers/create-provider-accounts.ts
//
// `create-provider-account.ts` for a SET: the chart tab's bulk create-and-link
// (97 item 10). One read of the chart and the identities, one resolved
// connection, one `provider-chart.changed` at the end; the rows go to the
// provider one at a time, parents first, and the run halts on the first
// refusal with what landed so far kept.
//
// No permission checks. The router asserts `ledgerControl` (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../../cache'
import { AuxxError } from '../../errors'
import type { AccountIdentityRow } from '../ledger/types'
import { listAccountIdentities } from './account-identities'
import {
  accountCreatorFor,
  type CreatedProviderAccount,
  createOneProviderAccount,
} from './create-provider-account'
import { resolveAccountingProvider } from './provider'
import { providerCreateOrder } from './provider-create-order'

const logger = createScopedLogger('postings:create-provider-accounts')

export interface CreateProviderAccountsOptions {
  organizationId: string
  /** The selection. Ancestors it needs are pulled in; what it cannot send is reported as skipped. */
  glAccountIds: string[]
  actorUserId?: string
}

/** Why a selected id was not sent. `linked` covers a broken link too - it still holds a provider id. */
export type ProviderCreateSkipReason = 'linked' | 'suggested' | 'not_in_chart'

export interface CreateProviderAccountsResult {
  /** Linked, in the order sent - pulled-in ancestors included. Kept even when the run halted. */
  created: CreatedProviderAccount[]
  skipped: Array<{ glAccountId: string; reason: ProviderCreateSkipReason }>
  /** Ids created that were not selected: unlinked parents a selected row needed first. */
  ancestorsAdded: string[]
  /** The row that halted the run and the provider's or the validator's sentence. Absent on a clean run. */
  failed?: { glAccountId: string; message: string }
}

function skipReason(row: AccountIdentityRow | undefined): ProviderCreateSkipReason {
  if (!row) return 'not_in_chart'
  return row.providerAccountId ? 'linked' : 'suggested'
}

/**
 * Create the counterparts of a selection of accounts in the connected provider
 * and link each as it lands.
 *
 * Refuses outright (an `err`) only when nothing can start: nothing connected,
 * a provider that cannot create, or the identities read failing. A row's own
 * refusal is a normal outcome, returned as `failed` beside what was created.
 */
export async function createProviderAccounts(
  db: Database,
  options: CreateProviderAccountsOptions
): Promise<Result<CreateProviderAccountsResult, Error>> {
  const { organizationId, glAccountIds, actorUserId } = options
  const touched = new Set<string>()
  try {
    const provider = await resolveAccountingProvider(organizationId)
    const creator = await accountCreatorFor(provider, { orgId: organizationId, actorUserId })
    if (creator.isErr()) return err(creator.error)

    // One read for the chart, the mappings and the matcher's suggestions - the same rows the screen decided on.
    const identities = await listAccountIdentities(db, organizationId)
    if (identities.isErr()) return err(identities.error)
    const rows = identities.value.rows
    const chart = rows.map((row) => row.account)
    const byAccountId = new Map(rows.map((row) => [row.account.id, row]))

    const order = providerCreateOrder(chart, byAccountId, glAccountIds)
    const sending = new Set(order.map((account) => account.id))
    const selected = new Set(glAccountIds)
    const skipped = glAccountIds
      .filter((id) => !sending.has(id))
      .map((glAccountId) => ({ glAccountId, reason: skipReason(byAccountId.get(glAccountId)) }))
    const ancestorsAdded = order
      .filter((account) => !selected.has(account.id))
      .map((account) => account.id)

    const mappings = new Map<string, string>()
    for (const row of rows)
      if (row.providerAccountId) mappings.set(row.account.id, row.providerAccountId)

    const created: CreatedProviderAccount[] = []
    let failed: CreateProviderAccountsResult['failed']
    for (const account of order) {
      const done = await createOneProviderAccount(creator.value, {
        organizationId,
        chart,
        mappings,
        account,
        actorUserId,
        touched,
      })
      if (done.isErr()) {
        failed = { glAccountId: account.id, message: done.error.message }
        break
      }
      created.push(done.value)
    }

    return ok({ created, skipped, ancestorsAdded, ...(failed ? { failed } : {}) })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to create and link provider accounts', {
      error,
      organizationId,
      count: glAccountIds.length,
    })
    return err(new AuxxError('Internal error'))
  } finally {
    // Once per run, never per row: each emit makes the next reader re-fetch the provider's whole chart.
    if (touched.size > 0)
      await onCacheEvent('accounting.provider-chart.changed', { orgId: organizationId })
  }
}
