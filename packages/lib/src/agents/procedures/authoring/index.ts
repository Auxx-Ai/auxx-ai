// packages/lib/src/agents/procedures/authoring/index.ts

export { buildProcedureDoc, emptyDoc, ProcedureBuildError } from './build-doc'
export { docToDsl } from './doc-to-dsl'
export {
  DSL_MAX_STEPS,
  DSL_MAX_SUBPROCEDURES,
  DSL_MAX_TEXT_LEN,
  PROCEDURE_DSL_SCHEMA,
  type ProcedureDsl,
  type ProcedureDslCase,
  type ProcedureDslStep,
  type ProcedureDslStepKind,
  type ProcedureDslSubProcedure,
  validateProcedureDsl,
} from './dsl'
export { checkBodyPreservation } from './guard'
export {
  collectOpaqueOccurrences,
  type OpaqueOccurrence,
  occurrencesByContainer,
} from './opaque'
export {
  type AttachedProcedureDraft,
  type AuthoringProcedureSummary,
  createAttachedProcedureDraft,
  getAttachedProcedureDraft,
  hashDoc,
  listAgentProceduresForAuthoring,
  StaleDraftError,
  updateAttachedProcedureCriteria,
  updateAttachedProcedureDraftIfHash,
} from './queries'
