// apps/web/src/app/api/webhook-endpoints/[endpointId]/events/route.ts
// SSE stream of live deliveries for a generic inbound WebhookEndpoint, read from the
// topic-agnostic Redis list the ingress writes (`webhook-endpoint:<id>:events`). Mirrors
// the app-trigger events route — a thin config over `createSsePollRoute`.

import { WebhookEndpoint } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createSsePollRoute } from '~/lib/sse/create-sse-poll-route'

export const GET = createSsePollRoute({
  getRedisKey: ({ endpointId }) => `webhook-endpoint:${endpointId}:events`,
  authorize: async (session, params, db) => {
    const { endpointId } = params
    if (!endpointId) return false

    const endpoint = await db.query.WebhookEndpoint.findFirst({
      where: and(
        eq(WebhookEndpoint.id, endpointId),
        eq(WebhookEndpoint.organizationId, session.user.defaultOrganizationId)
      ),
      columns: { id: true },
    })
    return !!endpoint
  },
})
