// apps/web/src/app/api/workflows/[workflowId]/webhook/events/route.ts

import { WorkflowApp } from '@auxx/database/schema'
import { and, eq } from 'drizzle-orm'
import { createSsePollRoute } from '~/lib/sse/create-sse-poll-route'

export const GET = createSsePollRoute({
  getRedisKey: ({ workflowId }) => `webhook:test:${workflowId}:events`,
  authorize: async (session, params, db) => {
    const workflow = await db.query.WorkflowApp.findFirst({
      where: and(
        eq(WorkflowApp.id, params.workflowId),
        eq(WorkflowApp.organizationId, session.user.defaultOrganizationId)
      ),
      columns: { id: true },
    })
    return !!workflow
  },
})
