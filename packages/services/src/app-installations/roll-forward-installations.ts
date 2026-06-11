// packages/services/src/app-installations/roll-forward-installations.ts

import { type CatalogPayload, database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { provisionAppFields } from '../custom-fields/app-field-provisioning'
import { fromDatabase } from '../shared/utils'

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
        await provisionAppFields(
          deployment.catalog as CatalogPayload | null,
          'installation',
          { appInstallationId: installation.id, organizationId: installation.organizationId },
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

  return ok({
    installationIds: transactionResult.value.map((i) => i.id),
    organizationIds: [...new Set(transactionResult.value.map((i) => i.organizationId))],
  })
}
