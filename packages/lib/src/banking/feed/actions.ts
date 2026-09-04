// packages/lib/src/banking/feed/actions.ts

/**
 * The four things the bank-accounts settings page can do to a feed: connect,
 * reconnect, sync now, and disconnect.
 *
 * No permission checks. The router asserts `ledgerPost` on all four
 * (`docs/lib-module-guide.md` §6).
 */

import { getCredential } from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getProviderByKey } from '../../connections/providers'
import { enqueueConnectorSync } from '../../data-connectors/data-connector-queue'
import { getConnectorReadiness, READINESS_REASON } from '../../data-connectors/readiness'
import { listStreams } from '../../data-connectors/service'
import { BadRequestError, NotFoundError } from '../../errors'
import { guard } from '../guard'
import { getBankAccount } from '../reads'
import { updateBankAccount } from '../writes'
import { FC_PROVIDER_KEY } from './fc-client'
import { reapBankFeedAccount, stampFeedDisconnectedAt } from './reaper'

const logger = createScopedLogger('banking-feed')

/**
 * Which connection definition the bank feed runs on.
 *
 * ⚠️ This is a POINTER, not a branch. Decision **B13** forbids
 * `if (provider === 'x')`; it does not forbid naming which definition a feature is
 * configured to use, any more than `hostedProvisionKey: 'stripeConnect'` on a provider
 * def is a branch. Everything the connect flow then does is read off that definition's
 * DECLARED capabilities, so pointing this constant at a second aggregator of the same
 * shape is the whole change - which is the acceptance test B13 sets.
 */
export const BANK_FEED_PROVIDER_KEY = FC_PROVIDER_KEY

/** Where the connect surface starts a bank connection, and how to open it. */
export interface BankConnectionStart {
  /**
   * The platform `hosted-provision` start route. Session-guarded, and where the
   * one-shot state token is minted - the same door every redirect provider uses,
   * because two doors onto one flow is how one of them ends up without the guard.
   */
  startUrl: string
  /**
   * DECLARED on the definition. `true` ⇒ the browser `fetch`es `startUrl` and mounts
   * whatever comes back rather than navigating; `false` ⇒ it navigates. The browser
   * still branches on what the response actually says - this only tells it not to
   * expect a page navigation before it asks.
   */
  embed: boolean
  /** The org may hold several logins for this provider. Declared, read generically. */
  multiAccount: boolean
  providerKey: string
}

/** Where the flow returns to. Relative, and validated by the start route. */
const LANDING_PATH = '/app/accounting/settings/bank-accounts'

/**
 * Open a bank connection.
 *
 * Reconnecting is the same call: Financial Connections has no "repair this account"
 * endpoint, so a reconnect is a fresh authentication that lands on the account the org
 * already has, and `provisionBankFeed` re-arms the existing pair rather than making a
 * second one.
 */
export function startBankConnection(): BankConnectionStart {
  const provider = getProviderByKey(BANK_FEED_PROVIDER_KEY)
  if (!provider) {
    throw new NotFoundError(
      'The bank feed connection is not configured on this deployment. Add an account by hand and import statements into it.'
    )
  }
  return {
    startUrl: `/api/connections/${BANK_FEED_PROVIDER_KEY}/hosted-provision/start?returnTo=${encodeURIComponent(LANDING_PATH)}`,
    embed: provider.capabilities?.embed === true,
    multiAccount: provider.capabilities?.multiAccount === true,
    providerKey: BANK_FEED_PROVIDER_KEY,
  }
}

/** What `syncBankAccountFeed` answers. */
export interface BankFeedSyncResult {
  connectorId: string
  queued: true
}

/**
 * Queue a manual sync for one bank account's feed.
 *
 * 🛑 Gated on `getConnectorReadiness`, which refuses `disconnected` BEFORE any config
 * check - and that ordering is the whole guard (#2051). Uninstall and bank
 * deactivation both preserve the credential and the streams, so a disconnected
 * connector satisfies every structural predicate there is; one click on Sync now moves
 * it to `error`, which discards the Disconnected banner and puts it outside every
 * repair path, permanently.
 */
export async function syncBankAccountFeed(
  db: Database,
  params: { organizationId: string; bankAccountId: string }
): Promise<Result<BankFeedSyncResult, Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const connectorId = await requireConnectorId(db, organizationId, bankAccountId)
      const connector = await db.query.DataConnector.findFirst({
        where: (dc, { and, eq: e }) =>
          and(e(dc.id, connectorId), e(dc.organizationId, organizationId)),
      })
      if (!connector) {
        throw new NotFoundError('The feed behind this bank account no longer exists')
      }

      const streams = await listStreams(db, organizationId, connectorId)
      const readiness = getConnectorReadiness(connector, streams)
      if (!readiness.canSync) {
        const problem = readiness.problems[0]
        throw new BadRequestError(
          problem === 'disconnected'
            ? 'This feed is disconnected. Reconnect the bank to start it again - every transaction already synced is kept.'
            : `This feed cannot sync yet: ${problem ? READINESS_REASON[problem] : 'it is not set up'}.`
        )
      }

      await enqueueConnectorSync({ connectorId, organizationId, trigger: 'manual' })
      logger.info('Queued a manual bank feed sync', { organizationId, connectorId })
      return { connectorId, queued: true as const }
    },
    'Failed to queue a bank feed sync',
    { organizationId, bankAccountId }
  )
}

/** What `disconnectBankAccountFeed` answers. */
export interface BankFeedDisconnectResult {
  connectorId: string
  /** True when Stripe confirmed the account was released, so billing stops. */
  releasedAtProvider: boolean
}

/**
 * Stop a feed for good.
 *
 * Three effects, and the third is the one that is easy to forget:
 *  1. the `DataConnector` goes `disconnected`;
 *  2. the `bank_account` goes with it, so the settings row says so;
 *  3. the account is RELEASED at Stripe, which is the only thing that stops the 30c
 *     per month (open question **S4**). Skip it and a customer who disconnected every
 *     bank in the UI keeps paying for all of them forever.
 *
 * 🛑 Not one row is deleted. A coded and posted bank line is the source document of a
 * journal entry (plans/bank-connection/02 §5.1).
 */
export async function disconnectBankAccountFeed(
  db: Database,
  params: { organizationId: string; actorUserId: string; bankAccountId: string }
): Promise<Result<BankFeedDisconnectResult, Error>> {
  const { organizationId, actorUserId, bankAccountId } = params
  return guard(
    async () => {
      const connectorId = await requireConnectorId(db, organizationId, bankAccountId)
      const connector = await db.query.DataConnector.findFirst({
        where: (dc, { and, eq: e }) =>
          and(e(dc.id, connectorId), e(dc.organizationId, organizationId)),
        columns: { id: true, credentialId: true },
      })

      let releasedAtProvider = false
      const providerAccountId = connector?.credentialId
        ? await readProviderAccountId(organizationId, connector.credentialId)
        : null
      if (providerAccountId) {
        releasedAtProvider = await reapBankFeedAccount(db, { connectorId, providerAccountId })
      }

      // The status write happens whether or not Stripe answered. A release that failed
      // is a billing problem the nightly reaper will retry; leaving the feed reading
      // "connected" because of it would be a correctness problem on the settings page.
      await db
        .update(schema.DataConnector)
        .set({
          status: 'disconnected',
          error:
            'You disconnected this bank. Reconnect it to start the feed again - every ' +
            'transaction already synced is kept.',
        })
        .where(eq(schema.DataConnector.id, connectorId))

      // The reaper's clock, on its own key: `updatedAt` is reset by every later
      // write to the row (`FEED_DISCONNECTED_AT_KEY`). Stamped even when Stripe
      // did not answer above, because that is precisely the case the nightly
      // sweep has to pick up fourteen days from now.
      await stampFeedDisconnectedAt(db, connectorId)

      const updated = await updateBankAccount(db, {
        organizationId,
        actorUserId,
        bankAccountId,
        status: 'disconnected',
      })
      if (updated.isErr()) throw updated.error

      logger.info('Disconnected a bank feed', { organizationId, connectorId, releasedAtProvider })
      return { connectorId, releasedAtProvider }
    },
    'Failed to disconnect a bank feed',
    { organizationId, bankAccountId }
  )
}

/** The connector behind a bank account, refusing by name when there is none. */
async function requireConnectorId(
  db: Database,
  organizationId: string,
  bankAccountId: string
): Promise<string> {
  const account = await getBankAccount(db, { organizationId, bankAccountId })
  if (account.isErr()) throw account.error
  if (!account.value) {
    throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
  }
  if (!account.value.connectorId) {
    throw new BadRequestError(
      'This account was added by hand and has no feed. Connect a bank, or import statements into it.'
    )
  }
  return account.value.connectorId
}

/** The `fca_...` id off a credential, or null when the row or the key has gone. */
async function readProviderAccountId(
  organizationId: string,
  credentialId: string
): Promise<string | null> {
  const credential = await getCredential(credentialId, organizationId)
  if (credential.isErr()) return null
  const id = (credential.value.metadata as Record<string, unknown> | undefined)?.providerAccountId
  return typeof id === 'string' && id.length > 0 ? id : null
}
