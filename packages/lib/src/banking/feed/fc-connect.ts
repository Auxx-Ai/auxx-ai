// packages/lib/src/banking/feed/fc-connect.ts

/**
 * The `hosted-provision` handler for Stripe Financial Connections - the connect flow
 * behind "Connect a bank" (plans/bank-connection/01 §3, decision **B13**).
 *
 * 🛑 **This is an `embed` flow, and that is not a preference.** Financial Connections
 * has NO provider-hosted page: the session hands back a `client_secret` and Stripe.js
 * opens the authentication modal on our own page. There is nothing to redirect to and
 * nothing to redirect back from, which is exactly why `start()` widened to a union
 * instead of a second connection type - everything after the flow finishes (the
 * completion, the Credential write, the reconnect resolution) is identical to Stripe
 * Connect's, and only the first step differs.
 *
 * 🛑 **One flow yields N accounts.** A single authentication at one bank can return
 * four accounts, and each becomes its own Credential, `bank_account` and
 * `DataConnector` - one connector is one ACCOUNT, one credential is one LOGIN. That is
 * why `complete()` returns an array and why the definition declares `multiAccount`.
 *
 * Resolved lazily by `resolveHostedProvisionHandler`, so `connections/*` never
 * statically imports this module or anything it reaches.
 */

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type {
  HostedProvisionCompleteCtx,
  HostedProvisionCompleteResult,
  HostedProvisionHandler,
  HostedProvisionStartCtx,
  HostedProvisionStartResult,
} from '../../connections/hosted-provision/types'
import {
  toAccountLabel,
  toBankAccountType,
} from '../../data-connectors/connectors/stripe-financial-connections'
import { BadRequestError, ForbiddenError } from '../../errors'
import {
  ACCOUNT_HOLDER_METADATA_KEY,
  createFinancialConnectionsSession,
  readCustomerOrganizationId,
  readSessionAccounts,
  readStoredAccountHolderCustomerId,
  subscribeToTransactions,
} from './fc-client'
import { provisionBankFeed } from './provision'

const logger = createScopedLogger('banking-feed')

/** Where the return route sends the browser when the flow is done. */
const LANDING_PATH = '/app/accounting/settings/bank-accounts'

export const financialConnectionsHandler: HostedProvisionHandler = {
  landingPath: LANDING_PATH,

  /**
   * Mint a Financial Connections session and hand its client secret to the browser.
   *
   * ⚠️ NOT idempotent in the "reuse the resource" sense the redirect handlers are, and
   * it does not need to be: a Financial Connections session is a short-lived,
   * throwaway authentication context, not a durable account. What IS reused is the
   * account holder - one Stripe `Customer` per org, resolved before the session is
   * created, so Stripe can offer the user the accounts they linked last time.
   */
  async start(ctx: HostedProvisionStartCtx): Promise<HostedProvisionStartResult> {
    const session = await createFinancialConnectionsSession({
      organizationId: ctx.organizationId,
      returnUrl: ctx.returnUrl,
    })
    logger.info('Opened a Financial Connections session', {
      organizationId: ctx.organizationId,
      sessionId: session.id,
    })
    // Opaque to the routes and to the connect surface: the surface hands `config` to
    // whatever renders an embed and never reads a provider-specific key out of it.
    return { kind: 'embed', config: { clientSecret: session.clientSecret, sessionId: session.id } }
  },

  /**
   * Read back what the user actually linked, and subscribe each account to daily
   * transaction refreshes.
   *
   * 🛑 The payload's `sessionId` is a CLAIM, not a fact. Everything persisted is
   * re-read from Stripe against that session id - the browser could post any string,
   * and the session is what decides which accounts exist.
   *
   * 🛑 **And re-reading it is not enough on its own.** A session id is a bearer
   * handle to somebody's bank accounts: it is logged by `start()`, returned to the
   * browser, and one leak away from a caller who holds a valid state token for
   * THEIR OWN org posting ANOTHER org's `fcsess_` id and provisioning that org's
   * banks into theirs, with a live feed. So the session's account holder is
   * checked against this org before a single account is read out of it.
   */
  async complete(ctx: HostedProvisionCompleteCtx): Promise<HostedProvisionCompleteResult[]> {
    const sessionId = ctx.payload?.sessionId
    if (typeof sessionId !== 'string' || !sessionId.startsWith('fcsess_')) {
      throw new BadRequestError(
        'The bank connection did not come back with a session. Start the connection again.'
      )
    }

    const session = await readSessionAccounts(sessionId)
    const accountHolder = await assertSessionAccountHolder(ctx.organizationId, session)

    const accounts = session.accounts
    if (accounts.length === 0) {
      // The user opened the modal and linked nothing. An ordinary outcome, and it must
      // read as one: no credential, no connector, no half-made bank account.
      throw new BadRequestError('No bank accounts were linked.')
    }

    const results: HostedProvisionCompleteResult[] = []
    for (const account of accounts) {
      const subscribed =
        account.status === 'active' ? await subscribeToTransactions(account.id) : false
      const type = toBankAccountType(account)
      results.push({
        providerAccountId: account.id,
        label: toAccountLabel(account),
        // 🛑 `ready` is "this feed can actually read", not "the user finished a form".
        // An `inactive` account refuses both subscribe and refresh, so a connection
        // that claimed ready would present a live status line over a dead feed.
        ready: account.status === 'active' && subscribed,
        connectionVariables: {
          institution: account.institution_name ?? '',
          accountName: account.display_name ?? '',
          last4: account.last4 ?? '',
          accountType: type,
          currency: readCurrency(account),
          [ACCOUNT_HOLDER_METADATA_KEY]: accountHolder,
        },
      })
    }

    logger.info('Financial Connections session completed', {
      organizationId: ctx.organizationId,
      sessionId,
      accounts: results.length,
    })
    return results
  },

  /**
   * Stand up the feed for the credential that just landed.
   *
   * Runs once per persisted credential, so a four-account login builds four
   * `bank_account` + `DataConnector` pairs. It runs even when `ready` is false: an
   * inactive account still deserves a row in the settings list saying so, with a
   * Reconnect on it. An empty list would read as "the connection did not happen".
   */
  async onPersisted(
    ctx: HostedProvisionCompleteCtx & {
      credentialId: string
      result: HostedProvisionCompleteResult
    }
  ): Promise<void> {
    const vars = ctx.result.connectionVariables
    await provisionBankFeed(database, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      credentialId: ctx.credentialId,
      facts: {
        providerAccountId: ctx.result.providerAccountId,
        institution: vars.institution || null,
        name: vars.accountName || ctx.result.label,
        last4: vars.last4 || null,
        type: vars.accountType === 'credit' ? 'credit' : 'depository',
        currency: (vars.currency || 'USD').toUpperCase(),
        ready: ctx.result.ready,
      },
    })
  },
}

/**
 * Refuse a session that was not opened for THIS org, and answer with its holder.
 *
 * Two ways to say yes, and the second is why the first is not enough on its own:
 *
 * 1. The org already holds an FC credential naming an account holder, and the
 *    session's matches it. A plain DB read.
 * 2. There is no stored holder yet (the ordinary FIRST connect), so the customer
 *    itself is asked which org it was minted for - `auxxOrganizationId` is
 *    written by `resolveAccountHolderCustomerId` on every customer it creates.
 *
 * 🛑 The stored-holder read must NOT be `resolveAccountHolderCustomerId`: that
 * one CREATES a customer when it finds none, and Stripe's customer search is
 * eventually consistent, so a first connect would routinely mint a second
 * customer, compare it against the session's, and refuse a legitimate flow.
 *
 * ⚠️ A session with no account holder at all is refused rather than trusted.
 * Every session this subsystem opens is created with one.
 */
async function assertSessionAccountHolder(
  organizationId: string,
  session: { accountHolderCustomerId: string | null }
): Promise<string> {
  const holder = session.accountHolderCustomerId
  if (!holder) {
    throw new ForbiddenError(
      'This bank connection session cannot be verified as yours. Start the connection again.'
    )
  }

  const stored = await readStoredAccountHolderCustomerId(organizationId)
  if (stored) {
    if (stored === holder) return holder
    throw new ForbiddenError(
      'This bank connection session belongs to a different account holder. Start the ' +
        'connection again.'
    )
  }

  const ownedBy = await readCustomerOrganizationId(holder)
  if (ownedBy === organizationId) return holder
  logger.warn('Refused a Financial Connections session opened for another organization', {
    organizationId,
    accountHolderCustomerId: holder,
  })
  throw new ForbiddenError(
    'This bank connection session belongs to a different account holder. Start the connection ' +
      'again.'
  )
}

/** The currency the account reports, from its balance keys. FC is US accounts only. */
function readCurrency(account: {
  balance?: { current?: Record<string, number> | null } | null
}): string {
  const codes = Object.keys(account.balance?.current ?? {})
  return (codes[0] ?? 'usd').toUpperCase()
}
