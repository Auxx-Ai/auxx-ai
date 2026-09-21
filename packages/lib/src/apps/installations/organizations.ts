// packages/lib/src/apps/installations/organizations.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'

/**
 * Every organization holding a live installation of one of these app slugs.
 *
 * Cross-org by construction: the callers are boot-time sweeps that have no org
 * yet. A per-org resolve through the installed-apps cache would be one Redis
 * round trip per organization.
 */
export async function listOrganizationsWithApp(
  db: Database,
  slugs: readonly string[],
  options: { excludeDemo?: boolean } = {}
): Promise<string[]> {
  const wanted = [...new Set(slugs)]
  if (!wanted.length) return []
  const query = db
    .selectDistinct({ organizationId: schema.AppInstallation.organizationId })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
  const rows = options.excludeDemo
    ? await query
        .innerJoin(
          schema.Organization,
          eq(schema.Organization.id, schema.AppInstallation.organizationId)
        )
        .where(
          and(
            isNull(schema.AppInstallation.uninstalledAt),
            inArray(schema.App.slug, wanted),
            isNull(schema.Organization.demoExpiresAt)
          )
        )
    : await query.where(
        and(isNull(schema.AppInstallation.uninstalledAt), inArray(schema.App.slug, wanted))
      )
  return rows.map((row) => row.organizationId)
}
