// packages/lib/src/apps/installations/roll-forward-installations.ts

import { type CatalogPayload, database, schema, type Transaction } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { onCacheEvent } from '../../cache/invalidate'
import { applyInstallationCatalog } from './app-field-provisioning'

/**
 * Move all active production installations of an app to a newly published
 * deployment. Called on publish for apps with `autoUpdateInstallations`.
 *
 * Triggers need no re-registration: webhook and polling paths resolve the
 * bundle through `currentDeployment` at invocation time, and the installed-apps
 * cache projection is invalidated by the caller. Installation-scoped custom
 * fields from the new catalog are provisioned per installation (idempotent).
 *
 * Returns the affected organization ids so callers can invalidate org caches.
 */
export async function rollForwardInstallations(params: { appId: string; deploymentId: string }) {
  const { appId, deploymentId } = params

  const transactionResult = await fromDatabase(
    database.transaction(async (tx: Transaction) => {
      const deployment = await tx.query.AppDeployment.findFirst({
        where: and(
          eq(schema.AppDeployment.id, deploymentId),
          eq(schema.AppDeployment.appId, appId)
        ),
        with: { app: { columns: { slug: true } } },
      })
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`)
      }

      const updated = await tx
        .update(schema.AppInstallation)
        .set({ currentDeploymentId: deploymentId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.AppInstallation.appId, appId),
            eq(schema.AppInstallation.installationType, 'production'),
            isNull(schema.AppInstallation.uninstalledAt)
          )
        )
        .returning({
          id: schema.AppInstallation.id,
          organizationId: schema.AppInstallation.organizationId,
        })

      for (const installation of updated) {
        // Reconcile the new catalog's custom fields per installation (installation-
        // AND connection-scoped, for any existing org-scoped connections). Best-effort
        // warm-up — the authoritative reconcile runs at connector sync setup and parks
        // visibly on any error, so a bad field must not abort the roll-forward txn.
        await applyInstallationCatalog(
          {
            appInstallationId: installation.id,
            organizationId: installation.organizationId,
            appSlug: deployment.app.slug,
            catalog: deployment.catalog as CatalogPayload | null,
          },
          tx
        )
      }

      return updated
    }),
    'roll-forward-installations'
  )

  if (transactionResult.isErr()) {
    return err({
      code: 'DATABASE_ERROR' as const,
      message: transactionResult.error.message,
      cause: transactionResult.error.cause,
    })
  }

  const organizationIds = [...new Set(transactionResult.value.map((i) => i.organizationId))]

  // Bust each org's customFields cache AFTER commit so the warm-up's provisioned
  // fields are resolvable immediately (mid-tx busting would let a concurrent read
  // refill the cache from pre-commit rows).
  for (const orgId of organizationIds) {
    await onCacheEvent('custom-field.created', { orgId })
  }

  return ok({
    installationIds: transactionResult.value.map((i) => i.id),
    organizationIds,
  })
}
