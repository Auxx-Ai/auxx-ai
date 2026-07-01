// packages/lib/src/export/job/get-job.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'

/**
 * Get an export job by ID, scoped to organization.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param jobId - Export job ID
 * @returns Export job or undefined if not found
 */
export async function getExportJobByOrg(db: Database, organizationId: string, jobId: string) {
  return db.query.ExportJob.findFirst({
    where: and(eq(schema.ExportJob.id, jobId), eq(schema.ExportJob.organizationId, organizationId)),
  })
}

/**
 * List recent export jobs for an organization, newest first. Optionally scoped
 * to a single entity definition.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param options - Optional entity-definition filter + result limit
 */
export async function listExportJobsByOrg(
  db: Database,
  organizationId: string,
  options?: { entityDefinitionId?: string; limit?: number }
) {
  return db.query.ExportJob.findMany({
    where: and(
      eq(schema.ExportJob.organizationId, organizationId),
      options?.entityDefinitionId
        ? eq(schema.ExportJob.entityDefinitionId, options.entityDefinitionId)
        : undefined
    ),
    orderBy: desc(schema.ExportJob.createdAt),
    limit: options?.limit ?? 50,
  })
}
