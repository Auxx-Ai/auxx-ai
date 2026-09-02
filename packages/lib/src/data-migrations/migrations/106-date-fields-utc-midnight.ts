// packages/lib/src/data-migrations/migrations/106-date-fields-utc-midnight.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-106')

/**
 * Round every `FieldType.DATE` value to the nearest UTC midnight.
 *
 * A DATE value is a calendar day, stored canonically as `YYYY-MM-DDT00:00:00.000Z`
 * (plans/money/tasks/33-calendar-day-fields.md section 3). Before that contract
 * was declared the browser date picker wrote the writer's LOCAL midnight
 * (`07:00Z` / `08:00Z` from Pacific time), and the seeders wrote arbitrary
 * instants, so a UTC+2 writer's May 10 read as May 9 to a UTC-7 teammate and
 * to every UTC-day reader (filters, tariff rate lookup, quote expiry).
 *
 * **Nearest, not truncate**: `+12h`, then truncate to the day. Truncation is off
 * by one for every writer east of UTC (May 9 `22:00Z` is a May 10 pick from
 * Berlin). Rounding recovers the intended day for every zone from UTC-12 to
 * UTC+12, and it is the same rule the write funnel now applies, so a row this
 * migration touched and a row written afterwards are indistinguishable.
 *
 * DATETIME and TIME are instants and are not touched. `updatedAt` is not
 * bumped and no events fire: this is a reinterpretation of the stored value,
 * not an edit, which is why it is raw SQL and not the field-value write path.
 *
 * Idempotent: the WHERE clause only matches rows that are not yet at midnight.
 */
export const migration106DateFieldsUtcMidnight: DataMigrationDef = {
  id: '106-date-fields-utc-midnight',
  description:
    'Round every DATE field value to the nearest UTC midnight (a DATE is a calendar day)',
  async run(db: Database): Promise<void> {
    const result = await db.execute(sql`
      UPDATE "FieldValue" fv
      SET "valueDate" = (date_trunc('day', (fv."valueDate" AT TIME ZONE 'UTC') + interval '12 hours')) AT TIME ZONE 'UTC'
      FROM "CustomField" cf
      WHERE cf.id = fv."fieldId"
        AND cf.type = 'DATE'
        AND fv."valueDate" IS NOT NULL
        AND (fv."valueDate" AT TIME ZONE 'UTC')::time <> '00:00:00'
    `)

    logger.info('Rounded DATE field values to UTC midnight', {
      rowsUpdated: result.rowCount ?? 0,
    })
  },
}
