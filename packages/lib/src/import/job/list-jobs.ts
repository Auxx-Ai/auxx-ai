// packages/lib/src/import/job/list-jobs.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { desc, eq } from 'drizzle-orm'

/**
 * Input for listing jobs.
 */
export interface ListJobsInput {
  organizationId: string
  search?: string
}

/**
 * List all import jobs for an organization with user and mapping info.
 *
 * @param db - Database instance
 * @param input - Organization ID and optional search filter
 * @returns Array of job list items
 */
export async function listJobsByOrg(db: Database, input: ListJobsInput) {
  const jobs = await db.query.ImportJob.findMany({
    where: eq(schema.ImportJob.organizationId, input.organizationId),
    with: {
      importMapping: {
        // `targetTable` was listed here and is NOT a column on `ImportMapping`
        // (it is a field on the in-memory mapping types in `import/types`). A
        // bogus key makes drizzle infer the BARE `ImportJob` row for the whole
        // query — `importMapping` and `createdBy` vanish from the return type —
        // so every consumer read them as `any`. Removing it restores inference.
        columns: {
          entityDefinitionId: true,
        },
      },
      createdBy: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
    orderBy: desc(schema.ImportJob.createdAt),
  })

  // Apply search filter if provided
  if (input.search) {
    const searchLower = input.search.toLowerCase()
    return jobs.filter((job) => job.sourceFileName.toLowerCase().includes(searchLower))
  }

  return jobs
}
