// packages/lib/src/evals/index.ts
//
// Server-side evals service layer. Exposed to the worker and the `eval` tRPC
// router via `@auxx/lib/evals`. Explicit named exports only (CLAUDE.md).

export type {
  EvalCaseEntity,
  EvalRunEntity,
  EvalSuiteRunEntity,
} from '@auxx/database'

export {
  createResponseJudge,
  type GradeAgentSimulationInput,
  type GradeResult,
  gradeAgentSimulation,
  type JudgeTranscriptTurn,
  type ResponseJudge,
  type ResponseJudgment,
} from './agent-grader'
export { type CompareOutcome, evaluateComparator, MISSING } from './comparators'
export {
  compareSuiteRuns,
  type DiffChildRunsOptions,
  type DiffChildRunsResult,
  diffChildRuns,
} from './diff'
export {
  type EditorToolEntry,
  listAgentEffectiveTools,
  projectEditorToolEntries,
  validateAgentToolMock,
} from './editor-support'
export {
  cancelEvalRun,
  checkpointEvalTrace,
  claimEvalRun,
  type FinalizeEvalRunInput,
  failQueuedEvalRun,
  finalizeEvalRun,
  heartbeatEvalRun,
  markStaleEvalRunsTimedOut,
} from './lifecycle'
export { type ModelRunSummary, summarizeEvalRunForModel } from './model-summary'
export {
  type PreparedRunSnapshots,
  type PrepareRunInput,
  prepareRunSnapshots,
} from './prepare-run'
export {
  type CaseLatestRuns,
  type CreateEvalCaseInput,
  type CreateQueuedEvalRunInput,
  type CreateSuiteRunWithChildrenInput,
  createEvalCase,
  createQueuedEvalRun,
  createSuiteRunWithChildren,
  deleteEvalCase,
  deleteEvalRun,
  getEvalCaseById,
  getEvalRun,
  getEvalRunCredits,
  getEvalSuiteRun,
  getLatestRunsByCaseIds,
  type LatestRunSummary,
  listEvalCasesByAgent,
  listEvalRuns,
  listEvalSuiteRuns,
  listSuiteChildRunSummaries,
  mergeLatestWithPinned,
  type SuiteChildRunSummary,
  type UpdateEvalCaseInput,
  updateEvalCase,
} from './queries'
export {
  type AgentRuntimeSnapshotV1,
  buildEffectiveAgentRuntimeFromSnapshot,
  buildToolManifest,
  type CreateAgentRuntimeSnapshotInput,
  createAgentRuntimeSnapshot,
  getCodeRevision,
  type ProviderModel,
  type ReconstructedRuntime,
  type SnapshotVerification,
  type ToolManifestEntry,
  toolSchemaDigest,
  verifyRuntimeAgainstSnapshot,
} from './runtime-snapshot'
export {
  type AgentSimulationResult,
  type FinalResolver,
  type RunAgentSimulationInput,
  runAgentSimulation,
} from './simulation/executor'
export {
  buildSimulationFieldResolver,
  type SimulationFieldOverlay,
  type SimulationSubjectInput,
  type StartingFieldInput,
} from './simulation/field-resolver'
export {
  argsMatch,
  createMockResolver,
  type MockMatch,
  type MockOutputValidation,
  scaffoldFromSchema,
  type ToolInvocationRecord,
  UNMATCHED_MOCK_ERROR,
  type UnmatchedToolPolicy,
  validateMockOutput,
  type WrapToolsDeps,
  wrapToolsWithMocks,
} from './simulation/mock-tools'
export {
  type AgentConversationSource,
  LlmPersonaConversationSource,
  type PersonaTurn,
} from './simulation/persona'
export {
  type AgentDefinitionSnapshotV1,
  buildDefinitionSnapshot,
  canonicalize,
  hashSnapshots,
  stableHash,
  stripSecrets,
} from './snapshots'
export {
  renderProcedureText,
  type SimulationSuggestion,
  type SuggestAgentSimulationsInput,
  type SuggestResult,
  suggestAgentSimulations,
} from './suggestions'
export { getToolExampleOutput } from './tool-examples'
export type {
  EvalRunErrorCode,
  EvalServiceError,
  RuntimeSnapshot,
} from './types'
export {
  type EvalValidationReport,
  type ValidateEvalCaseInput,
  validateEvalCase,
} from './validate'
