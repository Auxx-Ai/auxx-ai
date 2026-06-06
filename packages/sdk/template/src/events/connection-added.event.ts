// src/events/connection-added.event.ts
import { createWebhookHandler, updateWebhookHandler } from '@auxx/sdk/server'
import type { Connection, ConnectionAddedResult } from '@auxx/sdk/server'

export default async function connectionAdded({
  connection,
}: {
  connection: Connection
}): Promise<ConnectionAddedResult> {
  // You can create multiple webhook handlers for the same file
  const webhookHandler = await createWebhookHandler({
    fileName: 'example',
  })

  // create Webhook in third party system, with webhook handler URL
  // const acmeResponse = await fetch(`https://api.acmeinc.com/api/v1/registerWebhook`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/vnd.api+json',
  //     Authorization: `Bearer ${connection.value}`,
  //   },
  //   body: JSON.stringify({
  //     name: 'prospect-enrolled',
  //     url: webhookHandler.url,
  //   }),
  // })

  // if (!acmeResponse.ok) {
  //   throw new Error('Failed to register webhook')
  // }

  // const body = await acmeResponse.json()

  // We store the external webhook ID in Auxx.ai so we can clean it later
  await updateWebhookHandler(webhookHandler.id, {
    externalWebhookId: 'someId', //body.webhookId,
  })

  // Optionally name this connection so it's recognizable in the connections
  // list (otherwise it falls back to the app name, e.g. "Acme (2)"). Use
  // whatever identifies the account — the authenticated email, a workspace
  // name, a shop domain, etc. Returning nothing keeps the default label.
  // const profile = await fetch('https://api.acmeinc.com/me', {
  //   headers: { Authorization: `Bearer ${connection.value}` },
  // }).then((r) => r.json())
  // return { label: profile.email }

  return {}
}
