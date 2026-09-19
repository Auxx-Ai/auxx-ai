// packages/database/src/db/schema/entity-instance-edit-snapshot.ts
// The pre-edit state of one record under an open edit-in-place (74-D1).
// The ROW IS THE FLAG: a row exists ⇔ the edit is open, so the lock and the
// `edit` stamp are an indexed key lookup and never touch `EntityInstance.metadata`.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityDefinition } from './entity-definition'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

export const EntityInstanceEditSnapshot = pgTable(
  'EntityInstanceEditSnapshot',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    /** One open edit per record — the uniqueness below is what makes the first Edit win (66 D9). */
    entityInstanceId: text().notNull(),
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, { onDelete: 'cascade' }),
    /** `{ record, children }` — see `EditSnapshotPayload` in `lib/entity-instances/edit-snapshot.ts`. */
    snapshot: jsonb().notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Deliberately no FK: deleting a user must not silently close somebody's open edit. */
    byUserId: text().notNull(),
  },
  (t) => [
    unique('EntityInstanceEditSnapshot_org_instance_key').on(t.organizationId, t.entityInstanceId),
    foreignKey({
      name: 'EntityInstanceEditSnapshot_entityInstanceId_fk',
      columns: [t.organizationId, t.entityInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('cascade'),
    index('EntityInstanceEditSnapshot_org_def_idx').on(t.organizationId, t.entityDefinitionId),
  ]
)

/** Type for selecting from EntityInstanceEditSnapshot */
export type EntityInstanceEditSnapshotEntity = typeof EntityInstanceEditSnapshot.$inferSelect

/** Type for inserting into EntityInstanceEditSnapshot */
export type EntityInstanceEditSnapshotInsert = typeof EntityInstanceEditSnapshot.$inferInsert
