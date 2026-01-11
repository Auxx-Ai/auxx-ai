// packages/database/src/db/schema/task-assignment.ts
// Drizzle table for TaskAssignment

import { pgTable, index, uniqueIndex, text, timestamp, type AnyPgColumn, sql } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Task } from './task'
import { User } from './user'
import { Organization } from './organization'

/**
 * TaskAssignment table for tracking user assignments to tasks
 * One row per user-task pair (uniqueness enforced)
 *
 * Soft delete pattern: Set unassignedAt timestamp when removing (null = active assignment)
 */
export const TaskAssignment = pgTable(
  'TaskAssignment',
  {
    /** Primary key - unique assignment identifier */
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    /** Organization this assignment belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Task being assigned */
    taskId: text()
      .notNull()
      .references((): AnyPgColumn => Task.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** User assigned to this task */
    assignedToUserId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** When assignment was created */
    assignedAt: timestamp({ precision: 3 })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),

    /** User who made the assignment */
    assignedById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** When assignment was removed (null = still assigned) */
    unassignedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    // Organization isolation
    index('TaskAssignment_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),

    // Foreign key support
    index('TaskAssignment_taskId_idx').using('btree', table.taskId.asc().nullsLast()),

    index('TaskAssignment_assignedToUserId_idx').using(
      'btree',
      table.assignedToUserId.asc().nullsLast()
    ),

    // Find all tasks assigned to a user (with unassignedAt filter)
    index('TaskAssignment_organizationId_assignedToUserId_unassignedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.assignedToUserId.asc().nullsLast(),
      table.unassignedAt.asc().nullsLast()
    ),

    // Timeline of assignments for a task
    index('TaskAssignment_taskId_assignedAt_idx').using(
      'btree',
      table.taskId.asc().nullsLast(),
      table.assignedAt.asc().nullsLast()
    ),

    // Soft delete: Filter for active assignments only
    index('TaskAssignment_unassignedAt_idx').using('btree', table.unassignedAt.asc().nullsLast()),

    // Unique constraint: One assignment per user per task
    uniqueIndex('TaskAssignment_taskId_assignedToUserId_key').using(
      'btree',
      table.taskId.asc().nullsLast(),
      table.assignedToUserId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from TaskAssignment table */
export type TaskAssignmentEntity = typeof TaskAssignment.$inferSelect

/** Type for inserting into TaskAssignment table */
export type TaskAssignmentInsert = typeof TaskAssignment.$inferInsert
