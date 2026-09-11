// packages/lib/src/apps/installations/resolve-active-installation.ts

import { database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { pickPreferredInstallation } from './preferred-installation'

/**
 * Resolve the installation ID the engine should execute an app's code as, for a
 * given app and organization.
 *
 * Reads every installation that has not been uninstalled (`uninstalledAt IS
 * NULL`) and picks with {@link pickPreferredInstallation} — production first.
 * This is also what guards against a stale frontend cache still referencing a
 * previous (soft-deleted) installation.
 *
 * 🛑 `findMany` + `pickPreferredInstallation`, NOT `findFirst`. An org can hold
 * a `development` AND a `production` installation of one app at the same time,
 * and an unordered `findFirst` returns whichever row the database hands back.
 *
 * This resolver is the authoritative one: `app-workflow-block-processor`
 * overwrites the node's stored `installationId` with whatever comes back here,
 * so a disagreement with the read path is not a cosmetic mismatch. It shipped
 * as an unordered `findFirst` and executed blocks as the development
 * installation while the settings page wrote to the production one — an admin
 * enabling writes got `INSUFFICIENT_PERMISSIONS` from the app's own capability
 * gate, because app settings are keyed by `appInstallationId`.
 */
export async function resolveActiveInstallationId(
  appId: string,
  organizationId: string
): Promise<Result<string, Error>> {
  try {
    const installations = await database.query.AppInstallation.findMany({
      where: and(
        eq(schema.AppInstallation.appId, appId),
        eq(schema.AppInstallation.organizationId, organizationId),
        isNull(schema.AppInstallation.uninstalledAt)
      ),
      columns: { id: true, installationType: true },
    })

    const installation = pickPreferredInstallation(installations)

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
