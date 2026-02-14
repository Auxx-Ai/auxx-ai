import { WebhookModel } from '@auxx/database/models'
import type { WebhookDeliveryCreatedEvent } from '../types'

export async function updateWebhookLastTriggeredAt({
  data,
}: {
  data: WebhookDeliveryCreatedEvent
}) {
  if (data.data.status === 'success') {
    const webhookModel = new WebhookModel()
    await webhookModel.updateByIdGlobal(data.data.webhookId, { lastTriggeredAt: new Date() as any })
  }
}
