// packages/database/src/db/relations/evals.ts
// Grouped relations for the evals domain

import { relations } from 'drizzle-orm/relations'
import { Agent, EvalCase, EvalRun, EvalSuiteRun, Organization, Procedure, User } from '../schema'

export const evalCaseRelations = relations(EvalCase, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [EvalCase.organizationId],
    references: [Organization.id],
  }),
  agent: one(Agent, {
    fields: [EvalCase.agentId],
    references: [Agent.id],
  }),
  procedure: one(Procedure, {
    fields: [EvalCase.procedureId],
    references: [Procedure.id],
  }),
  createdBy: one(User, {
    fields: [EvalCase.createdById],
    references: [User.id],
  }),
  runs: many(EvalRun),
}))

export const evalSuiteRunRelations = relations(EvalSuiteRun, ({ one, many }) => ({
  organization: one(Organization, {
    fields: [EvalSuiteRun.organizationId],
    references: [Organization.id],
  }),
  createdBy: one(User, {
    fields: [EvalSuiteRun.createdById],
    references: [User.id],
  }),
  runs: many(EvalRun),
}))

export const evalRunRelations = relations(EvalRun, ({ one }) => ({
  organization: one(Organization, {
    fields: [EvalRun.organizationId],
    references: [Organization.id],
  }),
  case: one(EvalCase, {
    fields: [EvalRun.caseId],
    references: [EvalCase.id],
  }),
  suiteRun: one(EvalSuiteRun, {
    fields: [EvalRun.suiteRunId],
    references: [EvalSuiteRun.id],
  }),
}))
