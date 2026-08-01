// apps/web/src/app/api/app-triggers/[installationId]/[triggerId]/events/route.ts

import { AppInstallation } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createSsePollRoute } from '~/lib/sse/create-sse-poll-route'

export const GET = createSsePollRoute({
  getRedisKey: ({ installationId, triggerId }) =>
    `app-trigger-test:${installationId}:${triggerId}:events`,
  authorize: async (session, params, db) => {
    const { installationId } = params
    if (!installationId) return false

    const installation = await db.query.AppInstallation.findFirst({
      where: and(
        eq(AppInstallation.id, installationId),
        eq(AppInstallation.organizationId, session.user.defaultOrganizationId)
      ),
      columns: { id: true },
    })
    return !!installation
  },
})
