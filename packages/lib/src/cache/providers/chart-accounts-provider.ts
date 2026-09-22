// packages/lib/src/cache/providers/chart-accounts-provider.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { sortChartTree } from '../../accounting/ledger/chart/account-tree'
import {
  type ChartAccountFields,
  loadChartAccountFields,
  readChartAccountValues,
} from '../../accounting/ledger/chart/chart-accounts'
import type { ChartAccountRow } from '../../accounting/ledger/types'
import { UnprocessableEntityError } from '../../errors'
import type { CacheProvider } from '../org-cache-provider'

const logger = createScopedLogger('cache:chart-accounts')

/** Computes every `gl_account` row for an org, archived ones stamped `isArchived` (plans/accounting/tasks/84 §1). */
export const chartAccountsProvider: CacheProvider<ChartAccountRow[]> = {
  async compute(orgId, db) {
    // Unprovisioned caches as `[]`; the reader owns the caller-specific refusal.
    let fields: ChartAccountFields
    try {
      fields = await loadChartAccountFields(orgId, 'not provisioned', db)
    } catch (error) {
      if (error instanceof UnprocessableEntityError) return []
      throw error
    }
    const defId = fields.code.entityDefinitionId
    if (!defId) return []

    const instances = await db
      .select({ id: schema.EntityInstance.id, archivedAt: schema.EntityInstance.archivedAt })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, defId)
        )
      )

    const read = await readChartAccountValues(
      db,
      orgId,
      instances.map((row) => row.id),
      fields
    )
    if (read.malformed.length > 0) {
      logger.warn('Skipped gl_account rows with no type', {
        organizationId: orgId,
        glAccountIds: read.malformed.join(','),
      })
    }

    // `archivedAt` lives on the instance, not among the decoded attributes.
    for (const row of instances) {
      const account = read.accounts.get(row.id)
      if (account && row.archivedAt) account.isArchived = true
    }

    return sortChartTree([...read.accounts.values()])
  },
}
