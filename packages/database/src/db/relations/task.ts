// packages/database/src/db/relations/task.ts
// Relations for Task, TaskAssignment, and TaskReference tables

import { relations } from 'drizzle-orm/relations'
import {
  Task,
  TaskAssignment,
  TaskReference,
  Organization,
  User,
  EntityInstance,
  EntityDefinition,
} from '../schema'

/**
 * Task relations
 */
export const taskRelations = relations(Task, ({ one, many }) => ({
  /** Organization this task belongs to */
  organization: one(Organization, {
    fields: [Task.organizationId],
    references: [Organization.id],
  }),
  /** User who created the task */
  createdBy: one(User, {
    fields: [Task.createdById],
    references: [User.id],
    relationName: 'task_createdById_user_id',
  }),
  /** User who completed the task */
  completedBy: one(User, {
    fields: [Task.completedById],
    references: [User.id],
    relationName: 'task_completedById_user_id',
  }),
  /** Task assignments (many-to-many with users) */
  assignments: many(TaskAssignment),
  /** Task references (many-to-many with entity instances) */
  references: many(TaskReference),
}))

/**
 * TaskAssignment relations
 */
export const taskAssignmentRelations = relations(TaskAssignment, ({ one }) => ({
  /** Organization this assignment belongs to */
  organization: one(Organization, {
    fields: [TaskAssignment.organizationId],
    references: [Organization.id],
  }),
  /** The task being assigned */
  task: one(Task, {
    fields: [TaskAssignment.taskId],
    references: [Task.id],
  }),
  /** User assigned to the task */
  assignedTo: one(User, {
    fields: [TaskAssignment.assignedToUserId],
    references: [User.id],
    relationName: 'taskAssignment_assignedToUserId_user_id',
  }),
  /** User who made the assignment */
  assignedBy: one(User, {
    fields: [TaskAssignment.assignedById],
    references: [User.id],
    relationName: 'taskAssignment_assignedById_user_id',
  }),
}))

/**
 * TaskReference relations
 */
export const taskReferenceRelations = relations(TaskReference, ({ one }) => ({
  /** Organization this reference belongs to */
  organization: one(Organization, {
    fields: [TaskReference.organizationId],
    references: [Organization.id],
  }),
  /** The task containing this reference */
  task: one(Task, {
    fields: [TaskReference.taskId],
    references: [Task.id],
  }),
  /** The referenced entity instance */
  entityInstance: one(EntityInstance, {
    fields: [TaskReference.referencedEntityInstanceId],
    references: [EntityInstance.id],
  }),
  /** The entity definition type */
  entityDefinition: one(EntityDefinition, {
    fields: [TaskReference.referencedEntityDefinitionId],
    references: [EntityDefinition.id],
  }),
  /** User who created this reference */
  createdBy: one(User, {
    fields: [TaskReference.createdById],
    references: [User.id],
  }),
}))
