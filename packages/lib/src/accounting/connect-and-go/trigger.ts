// packages/lib/src/accounting/connect-and-go/trigger.ts

import { createScopedLogger } from '@auxx/logger'
import { registerAppConnectionAddedHook } from '../../apps/connections/connection-added-hooks'
import { getCachedAppByInstallationId } from '../../cache/org-cache-helpers'
import { listAccountingProviderIds } from '../providers/provider'

const logger = createScopedLogger('accounting:connect-and-go')

/** Queue `prepareConnectAndGo` for one org; a second request while one is queued collapses. */
export async function enqueueConnectAndGoPrepare(
  organizationId: string,
  actorUserId: string
): Promise<void> {
  // Lazy: the queue graph is server-only and heavy.
  const [{ getQueue }, { Queues }] = await Promise.all([
    import('../../jobs/queues'),
    import('../../jobs/queues/types'),
  ])
  // BullMQ rejects a custom jobId containing ':' ("Custom Id cannot contain :").
  await getQueue(Queues.maintenanceQueue).add(
    'connectAndGoPrepareJob',
    { organizationId, actorUserId },
    { jobId: `connect-and-go-${organizationId}`, removeOnComplete: true, removeOnFail: true }
  )
}

/**
 * Prepare setup whenever an org-scoped connection is added to an app that is a registered
 * accounting provider (provider ids are the apps' slugs). Called once at boot with the providers.
 */
export function registerConnectAndGoTrigger(): void {
  registerAppConnectionAddedHook('accounting:connect-and-go', async (ctx) => {
    if (ctx.userId !== null) return
    const app = await getCachedAppByInstallationId(ctx.organizationId, ctx.appInstallationId)
    if (!app || !listAccountingProviderIds().includes(app.slug)) return
    await enqueueConnectAndGoPrepare(ctx.organizationId, ctx.actorUserId)
    logger.info('Queued connect-and-go prepare', {
      organizationId: ctx.organizationId,
      providerId: app.slug,
    })
  })
}
