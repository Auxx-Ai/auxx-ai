// packages/lib/src/data-connectors/webhooks/registry.ts
// Resolve the webhook capability for a connector. Precedence: a capability pinned on
// the static definition (fixture / future app-connector) wins; otherwise a
// generic-rest connector names its provider in `config.webhook.provider` and we bind
// the matching driver. Returns null when the connector has no webhook surface.

import type { DataConnectorConfig, DataConnectorDefinition, WebhookCapability } from '../types'
import { fixtureWebhookCapability } from './fixture'
import { shopifyWebhookCapability } from './shopify'
import { stripeWebhookCapability } from './stripe'

/** Provider key → driver. Generic-rest connectors select one via `config.webhook`. */
const PROVIDER_CAPABILITIES: Record<string, WebhookCapability> = {
  shopify: shopifyWebhookCapability,
  stripe: stripeWebhookCapability,
}

/**
 * Connection provider key → driver, for the unified connection-keyed ingress. Keyed
 * off the connection's provider (`Credential.type` for platform connections) — the
 * same drivers, but selected from the connection rather than a connector's config, so
 * a connection can carry webhook triggers with no data connector. Includes `fixture`
 * for the provider-neutral test harness.
 */
const CONNECTION_WEBHOOK_CAPABILITIES: Record<string, WebhookCapability> = {
  shopify: shopifyWebhookCapability,
  stripe: stripeWebhookCapability,
  fixture: fixtureWebhookCapability,
}

/**
 * The webhook capability a connector exposes, or null. The static definition's
 * `webhook` takes precedence (fixture); else the generic-rest `config.webhook.provider`
 * selects a provider driver.
 */
export function resolveWebhookCapability(
  config: DataConnectorConfig,
  definition: DataConnectorDefinition
): WebhookCapability | null {
  if (definition.webhook) return definition.webhook
  const provider = config.webhook?.provider
  if (provider) return PROVIDER_CAPABILITIES[provider] ?? null
  return null
}

/**
 * The webhook capability a CONNECTION exposes, or null. Keyed off the connection's
 * provider (`Credential.type` for platform connections — `'shopify'`, `'stripe'`).
 * Unlike {@link resolveWebhookCapability}, this resolves from the connection itself,
 * so a connection with webhook triggers but no data connector still verifies/resolves.
 * Returns null for connections whose provider has no `WebhookSpec` (the honest v1
 * boundary — only spec-bearing providers get webhook triggers).
 */
export function resolveConnectionWebhookCapability(connection: {
  type?: string | null
}): WebhookCapability | null {
  const provider = connection.type
  if (!provider) return null
  return CONNECTION_WEBHOOK_CAPABILITIES[provider] ?? null
}
