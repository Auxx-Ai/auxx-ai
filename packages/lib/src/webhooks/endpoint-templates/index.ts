// packages/lib/src/webhooks/endpoint-templates/index.ts
// Predefined webhook-endpoint templates (Shopify, Stripe, GitHub, +blank). Pure data.

export { getWebhookEndpointTemplate, listWebhookEndpointTemplates } from './queries'
export { webhookEndpointTemplates } from './templates'
export type {
  WebhookEndpointTemplate,
  WebhookTemplateCategory,
  WebhookTemplateConfig,
  WebhookTemplateSummary,
  WebhookTemplateTopic,
} from './types'
