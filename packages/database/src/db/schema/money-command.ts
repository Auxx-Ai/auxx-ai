// packages/database/src/db/schema/money-command.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, jsonb, pgTable, text, timestamp, unique } from './_shared'
import { Organization } from './organization'

/** Durable MoneyCommand owner; organization deletion cascades, scoped financial references preserve history. */
export const MoneyCommand = pgTable(
  'MoneyCommand',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    commandKey: text().notNull(),
    kind: text().notNull(),
    payloadHash: text().notNull(),
    actorSnapshot: jsonb().notNull(),
    resultIds: jsonb().notNull().default({}),
  },
  (t) => [
    unique('MoneyCommand_org_id_key').on(t.organizationId, t.id),
    unique('MoneyCommand_key').on(t.organizationId, t.commandKey),
  ]
)
