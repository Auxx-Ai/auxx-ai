// packages/lib/src/postings/create-provider-account.ts

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
import { AuxxError, UnprocessableEntityError } from '../errors'
import { accountLabel } from './account-label'
import { resolveAccountingProvider, supportsCreatingProviderAccounts } from './provider'
import { listChartAccounts } from './role-map'
import { isMappableTo, validateProviderMapping } from './suggest-account-identities'
import type { AccountIdentityRow } from './types'

const logger = createScopedLogger('postings:create-provider-account')

export interface CreateAndLinkOptions {
  organizationId: string
  /** The `gl_account` to give a counterpart. */
  glAccountId: string
  actorUserId?: string
}

/** The linked row, plus what actually happened on the provider's side. */
export interface CreateAndLinkResult {
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

/**
 * Create the counterpart of one account in the connected provider, then confirm
 * the pairing.
 *
 * Refuses, rather than creating, when:
 * - nothing is connected, or the provider cannot create accounts at all
 * - the account is not in this org's live chart, or is archived
 * - it is ALREADY linked - see below
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
  const { organizationId, glAccountId, actorUserId } = options

  try {
    const provider = await resolveAccountingProvider(organizationId)
    if (!supportsCreatingProviderAccounts(provider) || !provider.createProviderAccount) {
      throw new UnprocessableEntityError(
        'The connected accounting system cannot have accounts added to it from auxx. Create the account there, then link it here.',
        { organizationId, providerId: provider.id }
      )
    }

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

    const created = await provider.createProviderAccount({
      orgId: organizationId,
      glAccountId,
      name: account.name,
      code: account.code,
      classification: account.accountType,
      subtype: account.subtype ?? null,
      actorUserId,
    })
    if (created.isErr()) return err(created.error)
    const target = created.value.account

    // 🛑 The same gate the picker's confirmation passes through. Reached mainly
    // when the adapter REUSED an account rather than creating one - a create we
    // fully specified comes back in the section we asked for, but a match on
    // name alone can be anything. Refusing leaves an unlinked account behind,
    // which is recoverable; confirming a wrong one is not.
    if (!isMappableTo(account, target)) {
      const message =
        validateProviderMapping(account, target, target.id) ??
        `${accountLabel(account)} cannot be linked to '${target.fullyQualifiedName}'.`
      logger.warn('Created or matched a provider account that is not a legal mapping target', {
        organizationId,
        glAccountId,
        providerAccountId: target.id,
        outcome: created.value.outcome,
      })
      throw new UnprocessableEntityError(message, {
        organizationId,
        glAccountId,
        providerAccountId: target.id,
      })
    }

    const written = await provider.setAccountMapping({
      orgId: organizationId,
      glAccountId,
      providerAccountId: target.id,
      actorUserId,
    })
    if (written.isErr()) return err(written.error)

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
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to create and link a provider account', {
      error,
      organizationId,
      glAccountId,
    })
    return err(new AuxxError('Internal error'))
  }
}
