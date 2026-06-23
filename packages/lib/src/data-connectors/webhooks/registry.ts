// packages/lib/src/data-connectors/webhooks/registry.ts
// Resolve the webhook capability for a connector. Precedence: a capability pinned on
// the static definition (fixture / future app-connector) wins; otherwise a
// generic-rest connector names its provider in `config.webhook.provider` and we bind
// the matching driver. Returns null when the connector has no webhook surface.

import type { DataConnectorConfig, DataConnectorDefinition, WebhookCapability } from '../types'
import { shopifyWebhookCapability } from './shopify'
import { stripeWebhookCapability } from './stripe'

/** Provider key → driver. Generic-rest connectors select one via `config.webhook`. */
const PROVIDER_CAPABILITIES: Record<string, WebhookCapability> = {
  shopify: shopifyWebhookCapability,
  stripe: stripeWebhookCapability,
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
