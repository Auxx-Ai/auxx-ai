// packages/lib/src/data-connectors/connector-webhook-registration.ts
// Step 8B — per-provider subscription registration. When a connector's webhook sync
// is enabled we mint a callback URL + signing secret (stored on the shared
// AppWebhookHandler table, keyed by `dataConnectorId`), then call the provider's
// subscription API via the connector's `WebhookCapability.register`. Teardown
// revokes the provider subscriptions and deletes the handler row.
//
// Built-in connectors (generic-rest / Shopify / Stripe) only — app-connector webhook
// registration (the app lambda owns verify/register) is deferred to the apps track.

import { randomBytes } from 'node:crypto'
import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  deleteConnectorWebhookHandler,
  getConnectorWebhookHandler,
  upsertConnectorWebhookHandler,
} from '@auxx/services/app-webhook-handlers'
import { prepareConnectorFetch } from './connector-runtime'
import { loadConnector } from './service'
import type { ConnectorWebhookState, DataConnectorConfig } from './types'
import { resolveWebhookCapability } from './webhooks/registry'

const logger = createScopedLogger('data-connector-webhook-registration')

/** Parse the `{ secret, callbackUrl, subscriptions }` metadata off a handler row. */
function parseWebhookState(metadata: string | null): ConnectorWebhookState | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as Partial<ConnectorWebhookState>
    if (!parsed.secret) return null
    return {
      secret: parsed.secret,
      callbackUrl: parsed.callbackUrl ?? '',
      subscriptions: parsed.subscriptions ?? [],
    }
  } catch {
    return null
  }
}

/**
 * Register (or re-register) a connector's provider webhooks. Idempotent: re-running
 * reuses the existing secret + row, re-subscribes the provider, and overwrites the
 * stored subscription list. A no-op (returns false) when the connector has no webhook
 * capability. Best-effort — a provider that rejects a topic is logged, not fatal.
 */
export async function registerConnectorWebhooks(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<boolean> {
  const loaded = await loadConnector(db, organizationId, connectorId)
  if (!loaded) return false
  const { connector } = loaded

  const { definition, credential } = await prepareConnectorFetch(
    db,
    organizationId,
    connector,
    connector.createdById ?? 'system'
  )
  const config = connector.config as DataConnectorConfig
  const capability = resolveWebhookCapability(config, definition)
  if (!capability) {
    logger.info('connector has no webhook capability — skipping registration', { connectorId })
    return false
  }

  // Reuse the existing secret if already registered, else mint one.
  const existing = await getConnectorWebhookHandler({ dataConnectorId: connectorId })
  const prior = existing.isOk() ? parseWebhookState(existing.value.metadata) : null
  const secret = prior?.secret ?? randomBytes(32).toString('hex')

  // Create/refresh the handler row first so the callback URL exists before we subscribe.
  const seeded = await upsertConnectorWebhookHandler({
    dataConnectorId: connectorId,
    connectionId: connector.credentialId,
    metadata: { secret, callbackUrl: '', subscriptions: prior?.subscriptions ?? [] },
  })
  if (seeded.isErr()) {
    logger.warn('failed to seed connector webhook handler', { connectorId, error: seeded.error })
    return false
  }
  const callbackUrl = seeded.value.url

  // Revoke any prior subscriptions before re-subscribing (avoid duplicates on re-run).
  if (prior?.subscriptions.length) {
    await capability.unregister({
      externalIds: prior.subscriptions.map((s) => s.externalId),
      credential,
      config,
    })
  }

  const subscriptions = await capability.register({
    callbackUrl,
    secret,
    topics: capability.topics,
    credential,
    config,
  })

  await upsertConnectorWebhookHandler({
    dataConnectorId: connectorId,
    connectionId: connector.credentialId,
    metadata: { secret, callbackUrl, subscriptions } satisfies ConnectorWebhookState,
  })

  logger.info('registered connector webhooks', {
    connectorId,
    callbackUrl,
    subscriptions: subscriptions.length,
  })
  return true
}

/**
 * Revoke a connector's provider webhooks + delete the handler row. Best-effort: a
 * provider error on revoke is logged (a dangling provider subscription is harmless
 * once our handler row is gone — its deliveries 404 at the receiver and drop).
 */
export async function unregisterConnectorWebhooks(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<void> {
  const existing = await getConnectorWebhookHandler({ dataConnectorId: connectorId })
  if (existing.isErr()) return // nothing registered

  const state = parseWebhookState(existing.value.metadata)
  if (state?.subscriptions.length) {
    const loaded = await loadConnector(db, organizationId, connectorId)
    if (loaded) {
      const { definition, credential } = await prepareConnectorFetch(
        db,
        organizationId,
        loaded.connector,
        loaded.connector.createdById ?? 'system'
      )
      const config = loaded.connector.config as DataConnectorConfig
      const capability = resolveWebhookCapability(config, definition)
      await capability?.unregister({
        externalIds: state.subscriptions.map((s) => s.externalId),
        credential,
        config,
      })
    }
  }

  await deleteConnectorWebhookHandler({ dataConnectorId: connectorId })
  logger.info('unregistered connector webhooks', { connectorId })
}
