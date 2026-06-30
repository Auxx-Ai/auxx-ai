// packages/lib/src/webhooks/endpoint-templates/queries.ts
// Read helpers over the static template registry, called by the webhookEndpoint router.

import { webhookEndpointTemplates } from './templates'
import type { WebhookEndpointTemplate, WebhookTemplateSummary } from './types'

/** Gallery list projection — the heavy config/topics payload is dropped. */
export function listWebhookEndpointTemplates(): WebhookTemplateSummary[] {
  return webhookEndpointTemplates.map((t) => ({
    id: t.id,
    provider: t.provider,
    name: t.name,
    description: t.description,
    categories: t.categories,
    icon: t.icon,
    color: t.color,
    topicCount: t.topics.length,
    ...(t.blank && { blank: true }),
  }))
}

/** Full template detail (config + topics + note), or null when the id is unknown. */
export function getWebhookEndpointTemplate(id: string): WebhookEndpointTemplate | null {
  return webhookEndpointTemplates.find((t) => t.id === id) ?? null
}
