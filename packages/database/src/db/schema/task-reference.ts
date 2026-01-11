// packages/database/src/db/schema/task-reference.ts
// Drizzle table for TaskReference

import { pgTable, index, uniqueIndex, text, timestamp, type AnyPgColumn, sql } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Task } from './task'
import { EntityInstance } from './entity-instance'
import { EntityDefinition } from './entity-definition'
import { Organization } from './organization'
import { User } from './user'

/**
 * TaskReference table for linking tasks to entity instances
 * Tasks can reference any entity instance (contact, account, ticket, opportunity, etc.)
 * One row per task-entity pair (uniqueness enforced)
 *
 * Soft delete pattern: Set deletedAt timestamp when removing reference (null = active)
 */
export const TaskReference = pgTable(
  'TaskReference',
  {
    /** Primary key - unique reference identifier */
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    /** Organization this reference belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Task containing this reference */
    taskId: text()
      .notNull()
      .references((): AnyPgColumn => Task.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Entity instance being referenced */
    referencedEntityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Entity definition type (for UI display and validation) */
    referencedEntityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** When this reference was created */
    createdAt: timestamp({ precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),

    /** User who created this reference */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** When reference was deleted (null = still referenced) */
    deletedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    // Organization isolation
    index('TaskReference_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),

    // Foreign key support
    index('TaskReference_taskId_idx').using('btree', table.taskId.asc().nullsLast()),

    index('TaskReference_referencedEntityInstanceId_idx').using(
      'btree',
      table.referencedEntityInstanceId.asc().nullsLast()
    ),

    index('TaskReference_referencedEntityDefinitionId_idx').using(
      'btree',
      table.referencedEntityDefinitionId.asc().nullsLast()
    ),

    // Find all tasks referencing a specific entity (with deletedAt filter)
    index('TaskReference_organizationId_referencedEntityInstanceId_deletedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.referencedEntityInstanceId.asc().nullsLast(),
      table.deletedAt.asc().nullsLast()
    ),

    // Soft delete: Filter for active references only
    index('TaskReference_deletedAt_idx').using('btree', table.deletedAt.asc().nullsLast()),

    // Unique constraint: One reference per task-entity pair
    uniqueIndex('TaskReference_taskId_referencedEntityInstanceId_key').using(
      'btree',
      table.taskId.asc().nullsLast(),
      table.referencedEntityInstanceId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from TaskReference table */
export type TaskReferenceEntity = typeof TaskReference.$inferSelect

/** Type for inserting into TaskReference table */
export type TaskReferenceInsert = typeof TaskReference.$inferInsert
