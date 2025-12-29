// packages/lib/src/import/job/get-job.ts

import { eq, and } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/**
 * Get an import job by ID, scoped to organization.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param jobId - Import job ID
 * @returns Import job or null if not found
 */
export async function getJobByOrg(
  db: Database,
  organizationId: string,
  jobId: string
) {
  return db.query.ImportJob.findFirst({
    where: and(
      eq(schema.ImportJob.id, jobId),
      eq(schema.ImportJob.organizationId, organizationId)
    ),
  })
}

/**
 * Get an import job with its mapping, scoped to organization.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param jobId - Import job ID
 * @returns Import job with mapping or null if not found
 */
export async function getJobWithMapping(
  db: Database,
  organizationId: string,
  jobId: string
) {
  return db.query.ImportJob.findFirst({
    where: and(
      eq(schema.ImportJob.id, jobId),
      eq(schema.ImportJob.organizationId, organizationId)
    ),
    with: {
      importMapping: true,
    },
  })
}

/**
 * Get an import job with full mapping and properties.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param jobId - Import job ID
 * @returns Import job with mapping and properties or null
 */
export async function getJobWithMappingProperties(
  db: Database,
  organizationId: string,
  jobId: string
) {
  return db.query.ImportJob.findFirst({
    where: and(
      eq(schema.ImportJob.id, jobId),
      eq(schema.ImportJob.organizationId, organizationId)
    ),
    with: {
      importMapping: {
        with: {
          properties: true,
        },
      },
    },
  })
}
