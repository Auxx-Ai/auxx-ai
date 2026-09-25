// packages/lib/src/data-migrations/migrations/__tests__/192-retry-period-locked-work-items.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ALL_DATA_MIGRATIONS } from '../../registry'
import { migration192RetryPeriodLockedWorkItems } from '../192-retry-period-locked-work-items'

describe('192-retry-period-locked-work-items', () => {
  it('is registered', () => {
    expect(ALL_DATA_MIGRATIONS.map((m) => m.id)).toContain('192-retry-period-locked-work-items')
  })

  it('makes the parked rows due now, touching only the work-item table', async () => {
    const calls: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const db = {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          calls.push({ table, values })
          return { where: () => ({ returning: async () => [{ id: 'wi_1' }] }) }
        },
      }),
    } as unknown as Database

    await migration192RetryPeriodLockedWorkItems.run(db)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.table).toBe(schema.AccountingWorkItem)
    expect(calls[0]!.values.nextAttemptAt).toBeInstanceOf(Date)
  })
})
