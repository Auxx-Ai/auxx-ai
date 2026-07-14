// packages/database/src/db/relations/sequence.ts
// Hand-written relations for the Sequences domain (see plans/sequences/plan.md §3.4).
// Not part of the split-relations.ts generation — mirrors the style of ../relations/workflow.ts.

import { relations } from 'drizzle-orm/relations'
import {
  EntityInstance,
  Integration,
  Organization,
  Sequence,
  SequenceRun,
  SequenceStep,
  SequenceSuppression,
  Thread,
  User,
  WorkflowApp,
  WorkflowRun,
} from '../schema'

export const sequenceRelations = relations(Sequence, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [Sequence.organizationId],
    references: [Organization.id],
  }),
  workflowApp: one(WorkflowApp, {
    fields: [Sequence.workflowAppId],
    references: [WorkflowApp.id],
  }),
  integration: one(Integration, {
    fields: [Sequence.integrationId],
    references: [Integration.id],
  }),
  signature: one(EntityInstance, {
    fields: [Sequence.signatureEntityInstanceId],
    references: [EntityInstance.id],
  }),
  createdBy: one(User, {
    fields: [Sequence.createdById],
    references: [User.id],
  }),
  steps: many(SequenceStep),
  runs: many(SequenceRun),
}))

export const sequenceStepRelations = relations(SequenceStep, ({ one }) => ({
  organization: one(Organization, {
    fields: [SequenceStep.organizationId],
    references: [Organization.id],
  }),
  sequence: one(Sequence, {
    fields: [SequenceStep.sequenceId],
    references: [Sequence.id],
  }),
}))

export const sequenceRunRelations = relations(SequenceRun, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [SequenceRun.organizationId],
    references: [Organization.id],
  }),
  sequence: one(Sequence, {
    fields: [SequenceRun.sequenceId],
    references: [Sequence.id],
  }),
  workflowRun: one(WorkflowRun, {
    fields: [SequenceRun.workflowRunId],
    references: [WorkflowRun.id],
  }),
  recipient: one(EntityInstance, {
    fields: [SequenceRun.recipientEntityInstanceId],
    references: [EntityInstance.id],
  }),
  thread: one(Thread, {
    fields: [SequenceRun.threadId],
    references: [Thread.id],
  }),
  enrolledBy: one(User, {
    fields: [SequenceRun.enrolledById],
    references: [User.id],
  }),
  suppressions: many(SequenceSuppression),
}))

export const sequenceSuppressionRelations = relations(SequenceSuppression, ({ one }) => ({
  organization: one(Organization, {
    fields: [SequenceSuppression.organizationId],
    references: [Organization.id],
  }),
  contact: one(EntityInstance, {
    fields: [SequenceSuppression.contactEntityInstanceId],
    references: [EntityInstance.id],
  }),
  sequenceRun: one(SequenceRun, {
    fields: [SequenceSuppression.sequenceRunId],
    references: [SequenceRun.id],
  }),
}))
