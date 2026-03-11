// packages/services/src/app-versions/calculate-next-version.ts

import { database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'

/**
 * Calculate the next semver version for a production deployment.
 * Finds the latest production deployment and bumps the minor version.
 * Falls back to "0.1.0" if no previous production version exists.
 */
export async function calculateNextVersion(appId: string): Promise<string> {
  const latest = await database.query.AppDeployment.findFirst({
    where: and(
      eq(schema.AppDeployment.appId, appId),
      eq(schema.AppDeployment.deploymentType, 'production')
    ),
    orderBy: desc(schema.AppDeployment.createdAt),
    columns: { version: true },
  })

  if (!latest?.version) return '0.1.0'

  const match = latest.version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return '0.1.0'

  const [, major, minor] = match
  return `${major}.${Number(minor) + 1}.0`
}
