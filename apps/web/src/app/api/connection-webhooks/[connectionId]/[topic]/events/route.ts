// apps/web/src/app/api/connection-webhooks/[connectionId]/[topic]/events/route.ts

import { Credential } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createSsePollRoute } from '~/lib/sse/create-sse-poll-route'

export const GET = createSsePollRoute({
  getRedisKey: ({ connectionId, topic }) => `connection-webhook:${connectionId}:${topic}:events`,
  authorize: async (session, params, db) => {
    const connection = await db.query.Credential.findFirst({
      where: and(
        eq(Credential.id, params.connectionId),
        eq(Credential.organizationId, session.user.defaultOrganizationId)
      ),
      columns: { id: true },
    })
    return !!connection
  },
})
