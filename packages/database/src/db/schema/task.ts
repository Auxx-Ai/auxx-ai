// packages/database/src/db/schema/task.ts
// Drizzle table for Task

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, sql, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * Task table for storing organization tasks with metadata
 * Tasks can be linked to multiple entity instances via TaskReference
 * Tasks can be assigned to multiple users via TaskAssignment
 *
 * Soft delete pattern: Set archivedAt timestamp when archiving (null = active)
 * Denormalized fields (assignedUserCount, referenceCount) updated via application logic
 */
export const Task = pgTable(
  'Task',
  {
    /** Primary key - unique task identifier */
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    /** Organization this task belongs to (isolation boundary) */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Task title/description (required) */
    title: text().notNull(),

    /** Optional detailed description */
    description: text(),

    /** Creation timestamp (audit trail) */
    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),

    /** Optional deadline for task completion */
    deadline: timestamp({ precision: 3 }),

    /** Completion timestamp (null if task not completed) */
    completedAt: timestamp({ precision: 3 }),

    /** User who created this task */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** User who completed this task (null if not completed) */
    completedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Priority level: low, medium, high, or null */
    priority: text(),

    /** Archived timestamp for soft delete (null = active) */
    archivedAt: timestamp({ precision: 3 }),

    /** Combined searchable text from title + description (for full-text search) */
    searchText: text().notNull(),

    /** Cache of assigned user count (avoid expensive COUNT aggregations) */
    assignedUserCount: integer().notNull().default(0),

    /** Cache of referenced entity count (for UI display) */
    referenceCount: integer().notNull().default(0),

    /** Last modification timestamp */
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Organization isolation
    index('Task_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),

    // Common queries (filter by org + archived status + deadline)
    index('Task_organizationId_archivedAt_deadline_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.archivedAt.asc().nullsLast(),
      table.deadline.asc().nullsLast()
    ),

    // Filter by creator
    index('Task_organizationId_createdById_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdById.asc().nullsLast()
    ),

    // Sorting by deadline
    index('Task_organizationId_deadline_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.deadline.asc().nullsLast()
    ),

    // Sorting by creation date
    index('Task_organizationId_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdAt.asc().nullsLast()
    ),

    // Filtering completed tasks
    index('Task_organizationId_completedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.completedAt.asc().nullsLast()
    ),

    // Note: Full-text search GIN index should be added via raw SQL migration:
    // CREATE INDEX Task_searchText_gin ON "Task" USING GIN(to_tsvector('english', "searchText"))
  ]
)

/** Type for inserting into Task table */
export type TaskInsert = typeof Task.$inferInsert
