// src/events/connection-removed.event.ts
import { listWebhookHandlers, deleteWebhookHandler } from '@auxx/sdk/server'
import type { Connection } from '@auxx/sdk/server'

export default async function connectionRemoved({ connection }: { connection: Connection }) {
  const webhookHandlers = await listWebhookHandlers()

  for (const webhookHandler of webhookHandlers) {
    // const acmeResponse = await fetch(
    //   `https://api.acmeinc.com/api/v1/webhooks${webhookHandler.externalWebhookId}`,
    //   {
    //     method: 'DELETE',
    //     headers: {
    //       Authorization: `Bearer ${connection.value}`,
    //     },
    //   }
    // )

    // if (!acmeResponse.ok) {
    //   throw new Error('Failed to register webhook')
    // }

    await deleteWebhookHandler(webhookHandler.id)
  }
}
