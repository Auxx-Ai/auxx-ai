// packages/services/src/app-installations/resolve-active-installation.ts

import { database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'

/**
 * Resolve the current active installation ID for a given app and organization.
 *
 * Queries the database for an installation that has not been uninstalled
 * (`uninstalledAt IS NULL`). This is used to guard against stale frontend
 * caches that may still reference a previous (soft-deleted) installation.
 */
export async function resolveActiveInstallationId(
  appId: string,
  organizationId: string
): Promise<Result<string, Error>> {
  try {
    const installation = await database.query.AppInstallation.findFirst({
      where: and(
        eq(schema.AppInstallation.appId, appId),
        eq(schema.AppInstallation.organizationId, organizationId),
        isNull(schema.AppInstallation.uninstalledAt)
      ),
      columns: { id: true },
    })

    if (!installation) {
      return err(
        new Error(`No active installation found for app ${appId} in org ${organizationId}`)
      )
    }

    return ok(installation.id)
  } catch (error) {
    return err(error instanceof Error ? error : new Error('Failed to resolve active installation'))
  }
}
