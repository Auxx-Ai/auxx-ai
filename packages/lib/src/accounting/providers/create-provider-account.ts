// packages/lib/src/accounting/providers/create-provider-account.ts

/**
 * The seam run BACKWARDS: create one of our accounts in the connected
 * provider's chart, then link the two.
 *
 * `account-identities.ts` handles the case where both charts already hold the
 * account and only the correspondence is missing. This file handles the case it
 * cannot: an account that exists on exactly ONE side, because auxx created it.
 * A clearing account per card rail, the role-bearing core `chart-import.ts` adds
 * when the provider has no counterpart - the matcher has nothing to offer for
 * any of them, no suggestion is ever produced, and every export refuses.
 *
 * ## Two acts, not one
 *
 * 🛑 Creating the counterpart and confirming the pairing are deliberately
 * separate, with a validation between them. The adapter is trusted to write to
 * the provider; it is NOT trusted to decide that what came back is a legal
 * mapping. `isMappableTo` runs on the result exactly as it runs on a pairing a
 * person picked in the picker, so an adapter that returned a surprising account
 * - a reused one whose section disagrees, an inactive one - leaves an unlinked
 * account in the provider's chart rather than a confirmed mapping to the wrong
 * place. An account nobody linked is a visible loose end; a wrong mapping posts
 * money and balances.
 *
 * ## Nothing here knows what QuickBooks is
 *
 * Same rule as `account-identities.ts`, and the same reason: the provider's own
 * type vocabulary never crosses this line. `CreateProviderAccountInput` says
 * what the account IS - name, code, classification, subtype - and translating
 * that into one system's account types is the adapter's job. A module that
 * reached for QuickBooks' `AccountSubType` here would make QuickBooks the only
 * provider this could ever work for.
 *
 * No permission checks. The router asserts `ledgerControl` (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../../cache'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { accountLabel } from '../ledger/chart/account-label'
import { accountPath, accountPathLabel } from '../ledger/chart/account-tree'
import { listChartAccounts } from '../ledger/roles/role-map'
import type { AccountIdentityRow, ChartAccountRow } from '../ledger/types'
import { providerDisplayName } from '../mirror/client'
import {
  type AccountingProvider,
  type ProviderAccountCreator,
  resolveAccountingProvider,
  supportsCreatingProviderAccounts,
} from './provider'
import { isMappableTo, validateProviderMapping } from './suggest-account-identities'

const logger = createScopedLogger('postings:create-provider-account')

export interface CreateAndLinkOptions {
  organizationId: string
  /** The `gl_account` to give a counterpart. */
  glAccountId: string
  /**
   * Create any unlinked ANCESTOR of the account first, root-first, rather than
   * refusing (CHART-HIERARCHY §6). The provider needs the parent's own id to
   * nest the child, so without this a sub-account cannot be created at all
   * until somebody links its parents one at a time.
   */
  includeAncestors?: boolean
  actorUserId?: string
}

/** The linked row, plus what actually happened on the provider's side. */
export interface CreatedProviderAccount {
  row: AccountIdentityRow
  /**
   * `existing` means the provider already had this account and created nothing.
   *
   * Surfaced all the way to the screen rather than collapsed into success: "we
   * linked the account QuickBooks already had" and "we added an account to
   * QuickBooks" are different events, and a person told the second when the
   * first happened goes looking for a duplicate that is not there.
   */
  outcome: 'created' | 'existing'
  /**
   * Our code was sent and the provider kept no number for it - the company has
   * account numbers turned off.
   *
   * ⚠️ Not a failure and not a reason to refuse: the mapping is by id and is
   * perfectly sound. It matters because the person is looking at a chart
   * organised by code and has just been shown an account that does not carry
   * one, and because every future suggestion for this company falls back to
   * name matching. The screen says so once rather than letting them find out.
   */
  numberDropped: boolean
}

export interface CreateAndLinkResult extends CreatedProviderAccount {
  /**
   * The ancestors created on the way, root-first. Empty unless
   * `includeAncestors` was asked for and a parent was actually unlinked, so the
   * screen can name what else it just added to somebody's books.
   */
  ancestors: CreatedProviderAccount[]
}

/**
 * Create the counterpart of one account in the connected provider, then confirm
 * the pairing.
 *
 * Refuses, rather than creating, when:
 * - nothing is connected, or the provider cannot create accounts at all
 * - the account is not in this org's live chart, or is archived
 * - it is ALREADY linked - see below
 * - a parent is unlinked and `includeAncestors` was not asked for
 * - what came back is not a legal mapping target
 *
 * 🛑 The already-linked refusal is the one that matters. Without it, a
 * double-clicked button asks the provider for a second counterpart to an
 * account that has one, and whether that ends as a duplicate in their books
 * depends entirely on the adapter's reuse check. Refusing here does not depend
 * on an adapter being careful.
 */
export async function createAndLinkProviderAccount(
  db: Database,
  options: CreateAndLinkOptions
): Promise<Result<CreateAndLinkResult, Error>> {
  const touched = new Set<string>()
  try {
    return await createAndLink(db, options, touched)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to create and link a provider account', {
      error,
      organizationId: options.organizationId,
      glAccountId: options.glAccountId,
    })
    return err(new AuxxError('Internal error'))
  } finally {
    // Once per run, never per row: each emit makes the next reader re-fetch the provider's whole chart.
    if (touched.size > 0)
      await onCacheEvent('accounting.provider-chart.changed', { orgId: options.organizationId })
  }
}

async function createAndLink(
  db: Database,
  options: CreateAndLinkOptions,
  touched: Set<string>
): Promise<Result<CreateAndLinkResult, Error>> {
  const { organizationId, glAccountId, includeAncestors, actorUserId } = options
  const provider = await resolveAccountingProvider(organizationId)
  const creator = await accountCreatorFor(provider, { orgId: organizationId, actorUserId })
  if (creator.isErr()) return err(creator.error)

  const chart = await listChartAccounts(db, organizationId)
  if (chart.isErr()) return err(chart.error)

  const account = chart.value.find((row) => row.id === glAccountId)
  if (!account) {
    throw new UnprocessableEntityError(
      `Account ${glAccountId} does not exist in this organization, or has been archived.`,
      { organizationId, glAccountId }
    )
  }

  const mappings = await provider.listAccountMappings(organizationId)
  if (mappings.isErr()) return err(mappings.error)
  const existingMapping = mappings.value.get(glAccountId)
  if (existingMapping) {
    throw new UnprocessableEntityError(
      `${accountLabel(account)} is already linked to an account in the connected accounting system. Unlink it first if it should point somewhere else.`,
      { organizationId, glAccountId, providerAccountId: existingMapping }
    )
  }

  // CHART-HIERARCHY §6: the provider needs the PARENT's own id to nest a
  // child, and there is no way to reparent afterwards through this seam - so
  // an unlinked ancestor is either created first, root-first, or refused.
  const ancestors: CreatedProviderAccount[] = []
  for (const ancestor of unlinkedAncestors(chart.value, account, mappings.value)) {
    if (!includeAncestors) {
      throw new UnprocessableEntityError(
        `Link ${accountPathLabel(chart.value, ancestor.id)} to ${providerDisplayName(provider.id)} first.`,
        { organizationId, glAccountId, parentAccountId: ancestor.id }
      )
    }
    const done = await createOneProviderAccount(creator.value, {
      organizationId,
      chart: chart.value,
      mappings: mappings.value,
      account: ancestor,
      actorUserId,
      touched,
    })
    if (done.isErr()) return err(done.error)
    ancestors.push(done.value)
  }

  const created = await createOneProviderAccount(creator.value, {
    organizationId,
    chart: chart.value,
    mappings: mappings.value,
    account,
    actorUserId,
    touched,
  })
  if (created.isErr()) return err(created.error)

  return ok({ ...created.value, ancestors })
}

/**
 * The creator for one run: the provider's connection-bound one when it offers
 * it, else its own two methods. Refuses a provider that cannot create at all.
 */
export async function accountCreatorFor(
  provider: AccountingProvider,
  input: { orgId: string; actorUserId?: string }
): Promise<Result<ProviderAccountCreator, Error>> {
  const create = provider.createProviderAccount
  if (!supportsCreatingProviderAccounts(provider) || !create) {
    return err(
      new UnprocessableEntityError(
        'The connected accounting system cannot have accounts added to it from auxx. Create the account there, then link it here.',
        { organizationId: input.orgId, providerId: provider.id }
      )
    )
  }
  if (provider.openProviderAccountCreator) return provider.openProviderAccountCreator(input)
  return ok({
    createProviderAccount: (account) => create.call(provider, account),
    setAccountMapping: (mapping) => provider.setAccountMapping(mapping),
  })
}

/**
 * The account's unlinked ancestors, root-first. An ancestor that is already
 * linked is skipped, and so is everything above it - the provider holds that
 * subtree already.
 */
function unlinkedAncestors(
  chart: readonly ChartAccountRow[],
  account: ChartAccountRow,
  mappings: ReadonlyMap<string, string>
): ChartAccountRow[] {
  return accountPath(chart, account.id)
    .slice(0, -1)
    .filter((ancestor) => !mappings.has(ancestor.id))
}

export interface CreateOneContext {
  organizationId: string
  chart: readonly ChartAccountRow[]
  /** Mutated as each account is linked, so the next child finds its parent. */
  mappings: Map<string, string>
  account: ChartAccountRow
  actorUserId?: string
  /** Ids the provider was asked to create; the caller emits `provider-chart.changed` once if any. */
  touched: Set<string>
}

/** One account: create the counterpart, validate it, confirm the pairing. Shared by the single and the batch. */
export async function createOneProviderAccount(
  creator: ProviderAccountCreator,
  ctx: CreateOneContext
): Promise<Result<CreatedProviderAccount, Error>> {
  const { organizationId, chart, mappings, account, actorUserId, touched } = ctx

  const parentProviderId = account.parentId ? mappings.get(account.parentId) : undefined

  const created = await creator.createProviderAccount({
    orgId: organizationId,
    glAccountId: account.id,
    name: account.name,
    code: account.code,
    classification: account.accountType,
    subtype: account.subtype ?? null,
    ...(parentProviderId ? { parentProviderId } : {}),
    actorUserId,
  })
  if (created.isErr()) return err(created.error)
  touched.add(account.id)
  const target = created.value.account

  // 🛑 The same gate the picker's confirmation passes through. Reached mainly
  // when the adapter REUSED an account rather than creating one - a create we
  // fully specified comes back in the section we asked for, but a match on
  // name alone can be anything. Refusing leaves an unlinked account behind,
  // which is recoverable; confirming a wrong one is not.
  if (!isMappableTo(account, target)) {
    const message =
      validateProviderMapping(account, target, target.id) ??
      `${accountPathLabel(chart, account.id)} cannot be linked to '${target.fullyQualifiedName}'.`
    logger.warn('Created or matched a provider account that is not a legal mapping target', {
      organizationId,
      glAccountId: account.id,
      providerAccountId: target.id,
      outcome: created.value.outcome,
    })
    return err(
      new UnprocessableEntityError(message, {
        organizationId,
        glAccountId: account.id,
        providerAccountId: target.id,
      })
    )
  }

  const written = await creator.setAccountMapping({
    orgId: organizationId,
    glAccountId: account.id,
    providerAccountId: target.id,
    actorUserId,
  })
  if (written.isErr()) return err(written.error)

  mappings.set(account.id, target.id)

  return ok({
    row: {
      account,
      state: 'confirmed',
      providerAccountId: target.id,
      providerAccountName: target.fullyQualifiedName,
      providerAccountNumber: target.number,
      source: 'human',
      confirmedAt: new Date().toISOString(),
      liveProviderAccount: target,
      suggestion: null,
    },
    outcome: created.value.outcome,
    numberDropped: created.value.numberDropped,
  })
}
