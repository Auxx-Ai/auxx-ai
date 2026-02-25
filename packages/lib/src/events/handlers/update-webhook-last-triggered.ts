// packages/lib/src/events/handlers/update-webhook-last-triggered.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { WebhookDeliveryCreatedEvent } from '../types'

export async function updateWebhookLastTriggeredAt({
  data,
}: {
  data: WebhookDeliveryCreatedEvent
}) {
  if (data.data.status === 'success') {
    await database
      .update(schema.Webhook)
      .set({ lastTriggeredAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.Webhook.id, data.data.webhookId))
  }
}
