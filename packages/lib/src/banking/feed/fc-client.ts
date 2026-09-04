// packages/lib/src/banking/feed/fc-client.ts

/**
 * The Stripe calls the bank feed makes that are NOT a sync: minting a session, finding
 * the org's account holder, subscribing an account to daily transaction refreshes, and
 * disconnecting one for good.
 *
 * 🛑 Everything here runs on the PLATFORM secret key, the same one Connect charges and
 * billing run on (`getStripeConnectClient`). There is no per-org token, no OAuth client
 * and no mTLS certificate - which is most of why this provider was chosen (decision
 * **B12**), and also why none of this may ever be handed to sandboxed app code
 * (decision **B3**): a Shopify token compromises one store, this key is auxx's identity
 * across every org.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { listCredentials } from '@auxx/credentials/store'
import { createScopedLogger } from '@auxx/logger'
import type Stripe from 'stripe'
import { getStripeConnectClient } from '../../money/payments/connect-client'

const logger = createScopedLogger('banking-feed')

/** The `providerKey` of the Financial Connections connection definition. */
export const FC_PROVIDER_KEY = 'stripeFinancialConnections'

/**
 * The credential-metadata key holding the Stripe `Customer` that owns this org's
 * linked accounts.
 *
 * ⚠️ Deliberately NOT `Subscription.stripeCustomerId`
 * (plans/accounting/implementation-review.md §2). That column is nullable, non-unique,
 * and nulled by `unlinkBillingProvider` and the Shopify anchor path - so keying the
 * bank feed on it means a billing change can orphan every bank connection in the org
 * with nothing to detect it. FC state lives on the credential.
 */
const ACCOUNT_HOLDER_KEY = 'accountHolderCustomerId'

/** Stripe customer metadata key, so an abandoned first connect is recoverable. */
const ORG_METADATA_KEY = 'auxxOrganizationId'

/**
 * The Stripe `Customer` that holds this org's linked bank accounts, creating it once.
 *
 * Resolution is three-tier and the order matters:
 *  1. an existing FC credential's `metadata.accountHolderCustomerId` - a plain DB read,
 *     and the case every connect after the first takes;
 *  2. a Stripe search on the customer's own `auxxOrganizationId` metadata - recovers
 *     the customer minted by a FIRST connect the user abandoned before any credential
 *     landed. Best-effort: the search index is eventually consistent and the API can be
 *     unavailable, so a failure here falls through rather than refusing the connect;
 *  3. create.
 *
 * 🛑 One customer per org, and it matters: Stripe keys "previously linked accounts" off
 * the account holder, so a second customer splits the list. The user would connect
 * their second bank and not be offered the first - invisible until somebody cannot find
 * a connection they know they made.
 */
export async function resolveAccountHolderCustomerId(organizationId: string): Promise<string> {
  const stored = await readStoredAccountHolderCustomerId(organizationId)
  if (stored) return stored

  const stripe = getStripeConnectClient()

  try {
    const found = await stripe.customers.search({
      query: `metadata['${ORG_METADATA_KEY}']:'${organizationId}'`,
      limit: 1,
    })
    const hit = found.data[0]
    if (hit) return hit.id
  } catch (error) {
    logger.warn('Stripe customer search unavailable - minting a new account holder', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const created = await stripe.customers.create({
    metadata: { [ORG_METADATA_KEY]: organizationId },
    description: `auxx bank feed account holder (${organizationId})`,
  })
  logger.info('Created a Financial Connections account holder', {
    organizationId,
    customerId: created.id,
  })
  return created.id
}

/**
 * The account holder this org ALREADY holds, from its own credentials. No writes,
 * no Stripe call, and no customer is created.
 *
 * 🛑 Separate from {@link resolveAccountHolderCustomerId} because the completion
 * path must be able to ask "who is this org's account holder" WITHOUT minting one
 * as a side effect: the answer is used to decide whether a session belongs to
 * this org, and a resolver that creates on a miss would answer with a customer
 * that matches nothing and refuse a legitimate first connect.
 */
export async function readStoredAccountHolderCustomerId(
  organizationId: string
): Promise<string | null> {
  const existing = await listCredentials({
    organizationId,
    kind: 'connection',
    type: FC_PROVIDER_KEY,
    userId: null,
  })
  if (existing.isErr()) return null
  for (const row of existing.value) {
    const metadata = row.metadata as Record<string, unknown> | undefined
    const vars = metadata?.connectionVariables as Record<string, unknown> | undefined
    // Both shapes: `complete()` writes it into `connectionVariables`, and a hand-edited
    // or older row may carry it at the top of `metadata`.
    const held = vars?.[ACCOUNT_HOLDER_KEY] ?? metadata?.[ACCOUNT_HOLDER_KEY]
    if (typeof held === 'string' && held.length > 0) return held
  }
  return null
}

/**
 * Which org a Stripe `Customer` was minted for, from its own metadata, or null.
 *
 * The second half of the session ownership check. Every account holder this
 * subsystem creates carries {@link ORG_METADATA_KEY}, so a customer that names a
 * different org (or names none) is not ours to link accounts from.
 */
export async function readCustomerOrganizationId(customerId: string): Promise<string | null> {
  try {
    const customer = await getStripeConnectClient().customers.retrieve(customerId)
    if (customer.deleted) return null
    const held = customer.metadata?.[ORG_METADATA_KEY]
    return typeof held === 'string' && held.length > 0 ? held : null
  } catch (error) {
    logger.warn('Could not read a Financial Connections account holder', {
      customerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** The metadata key, exported so the handler writes the same string it reads. */
export const ACCOUNT_HOLDER_METADATA_KEY = ACCOUNT_HOLDER_KEY

/**
 * Open a Financial Connections session for this org.
 *
 * `permissions: ['transactions']` is the whole ask - deliberately not `balances` or
 * `ownership`. Transactions are billed per institution per month with unlimited reads;
 * Balances is 10c PER CALL and Account Owners is $1.50 per call, and a permission
 * requested is a permission somebody will eventually call.
 *
 * ✅ `prefetch: ['transactions']` starts the first refresh INSIDE the auth flow rather
 * than waiting for the next daily cycle. That is what makes "connect early, even before
 * you are ready to reconcile" pay: the 180-day window starts filling at the moment of
 * connection, and every day between connecting and going live is a day of history
 * banked for free (plans/bank-connection/01 §4.1 (2)).
 */
export async function createFinancialConnectionsSession(params: {
  organizationId: string
  returnUrl: string
}): Promise<{ id: string; clientSecret: string }> {
  const stripe = getStripeConnectClient()
  const customer = await resolveAccountHolderCustomerId(params.organizationId)
  const session = await stripe.financialConnections.sessions.create({
    account_holder: { type: 'customer', customer },
    permissions: ['transactions'],
    prefetch: ['transactions'],
    // US bank accounts only - Financial Connections serves businesses in the US, the UK
    // and the EEA but reaches only US ACCOUNTS (plans/bank-connection/01 §5).
    filters: { countries: ['US'] },
  } as Stripe.FinancialConnections.SessionCreateParams)
  if (!session.client_secret) {
    throw new Error('Stripe returned a Financial Connections session with no client secret')
  }
  return { id: session.id, clientSecret: session.client_secret }
}

/** One session, read back from Stripe: who it belongs to and what it collected. */
export interface FinancialConnectionsSessionRead {
  /**
   * The Stripe `Customer` the session was opened for, or null when Stripe did
   * not report one.
   *
   * 🛑 Returned ALONGSIDE the accounts rather than discarded, because it is the
   * only thing that says which ORG a session id belongs to. A completion that
   * reads the accounts without it will happily provision another org's banks.
   */
  accountHolderCustomerId: string | null
  accounts: Stripe.FinancialConnections.Account[]
}

/** Every account collected in one session, plus the account holder it was opened for. */
export async function readSessionAccounts(
  sessionId: string
): Promise<FinancialConnectionsSessionRead> {
  const stripe = getStripeConnectClient()
  const session = await stripe.financialConnections.sessions.retrieve(sessionId)
  const holder = session.account_holder
  const accountHolderCustomerId =
    holder && typeof holder.customer === 'string'
      ? holder.customer
      : ((holder?.customer as { id?: string } | null | undefined)?.id ?? null)

  const fromSession = session.accounts?.data ?? []
  if (fromSession.length > 0) return { accountHolderCustomerId, accounts: fromSession }
  // Older API shapes do not expand `accounts` on the session; the list endpoint's
  // `session` filter answers the same question.
  const listed = await stripe.financialConnections.accounts.list({ session: sessionId, limit: 100 })
  return { accountHolderCustomerId, accounts: listed.data }
}

/** One account, re-read from Stripe. */
export async function retrieveAccount(
  accountId: string
): Promise<Stripe.FinancialConnections.Account> {
  return getStripeConnectClient().financialConnections.accounts.retrieve(accountId)
}

/**
 * Subscribe an account to daily transaction refreshes, and kick off an immediate one.
 *
 * ⚠️ Best-effort by design. "Subscriptions aren't allowed on inactive accounts", and an
 * account can go inactive between the auth flow and this call. Refusing the whole
 * connect over it would throw away a linked account the user just authenticated;
 * instead the credential lands `ready: false`, the connector shows `action-needed`, and
 * a reconnect fixes it. Returns whether the subscription took.
 */
export async function subscribeToTransactions(accountId: string): Promise<boolean> {
  try {
    await getStripeConnectClient().financialConnections.accounts.subscribe(accountId, {
      features: ['transactions'],
    })
    return true
  } catch (error) {
    logger.warn('Could not subscribe a bank account to transaction refreshes', {
      accountId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Disconnect an account at Stripe, permanently.
 *
 * 🛑 This is THE billing reaper's hand (open question **S4**). Stripe bills 30c per
 * institution per account holder per month for transactions, so an org that churned, an
 * account somebody disconnected in our UI, or a connector that was deleted keeps
 * costing money every month until this call is made - invisibly, until someone reads an
 * invoice. Nothing else stops the charge.
 *
 * ⚠️ It never throws. The reaper sweeps many accounts in one pass and one already-gone
 * account must not stop it reaching the next; an account Stripe has already disconnected
 * answers with an error that means "done".
 */
export async function disconnectAccountAtStripe(accountId: string): Promise<boolean> {
  try {
    await getStripeConnectClient().financialConnections.accounts.disconnect(accountId)
    logger.info('Disconnected a Financial Connections account at Stripe', { accountId })
    return true
  } catch (error) {
    logger.warn('Could not disconnect a Financial Connections account at Stripe', {
      accountId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
