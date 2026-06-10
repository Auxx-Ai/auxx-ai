// packages/lib/src/agents/procedures/index.ts

export {
  type BackstopVerdict,
  backstopClassify,
  classifyTextBranch,
  goalMetCheck,
} from './classifier'
export {
  type ClassifierCandidate,
  type ClassifyDeps,
  type ConversationMessage,
  classifyProcedure,
} from './classify'
export type { CompileError, CompileResult, CompileWarning } from './compile'
export { compileProcedure } from './compile'
export {
  buildCodeInputs,
  buildProcedureFieldResolver,
  buildProcedurePredicateResolver,
  readProcedureRef,
  scopedVar,
  writeProcedureVar,
} from './context'
export {
  advanceProcedure,
  awaitCustomer,
  digress,
  endProcedure,
  handoffToHuman,
  PROC_SIGNAL_KEY,
  PROCEDURE_CONTROL_TOOLS,
  type ProcedureSignal,
} from './control-tools'
export { sessionMessagesToConversation } from './conversation'
export {
  listAgentIdsForProcedure,
  reconcileAgentProcedureMentions,
  reconcileProcedureMentionsForAgents,
  reconcileProcedureMentionsForAllAgents,
} from './mention-reconcile'
export {
  type CodeBlockMapEntry,
  type ConditionBlockAttrs,
  type ConditionCaseAttrs,
  isOwnStepBadge,
  type LocalAttributeNodeAttrs,
  type ParsedStepBadge,
  PROCEDURE_NODE_TYPES,
  type ProcedureNodeType,
  parseCodeBindings,
  parseStepBadgeId,
  STEP_BADGE_PREFIXES,
  type SubProcedureMapEntry,
  type TiptapDoc,
  type TiptapNode,
} from './nodes'
export type { ProcedureObserver, ProcedureTransitionEvent } from './observer'
export {
  PROCEDURE_SLICE_KEY,
  PROCEDURE_STEP_KEY,
  readProcedureSlice,
  writeProcedureSlice,
} from './persist'
export type {
  AgentProcedureEntity,
  AgentProcedureOverrides,
  ProcedureDefaults,
  ProcedureEntity,
  ProcedureVersionEntity,
} from './queries'
export {
  attachProcedure,
  countAgentsUsingProcedure,
  createProcedure,
  deleteProcedure,
  detachProcedure,
  discardProcedureDraft,
  getProcedureById,
  getProcedureVersionById,
  listAgentProcedures,
  listProcedures,
  listProcedureVersions,
  publishProcedure,
  readCompiled,
  renameProcedureVersion,
  restoreProcedureVersion,
  updateAgentProcedure,
  updateDraftDoc,
  updateProcedure,
} from './queries'
export { buildReanchorBreadcrumb } from './re-anchor'
export {
  type ResolvedCandidate,
  type SelectionResult,
  type SelectProcedureArgs,
  selectProcedure,
} from './select'
export {
  atDepthCap,
  clear,
  depth,
  emptyStack,
  MAX_DEPTH,
  pop,
  push,
  replaceTop,
  top,
} from './stack'
export {
  type CodeErrorNote,
  type CodeOutputValue,
  type InterpretResult,
  interpretSignal,
  type PrepareResult,
  prepareTurn,
  type StepperDeps,
} from './stepper'
export {
  applySelection,
  type BuildStepperDepsArgs,
  buildActiveStepInput,
  buildStepperDeps,
  type RunProcedureTurnArgs,
  resolveCandidatesFromCache,
  runProcedureTurn,
} from './turn-wiring'
export type {
  ArgBindingMap,
  CodeOutput,
  CompiledProcedure,
  LocalAttribute,
  ProcedureFrame,
  ProcedureStack,
  ProcedureStep,
  StepId,
  SubProcedure,
  SubProcedureId,
  TriggerExample,
} from './types'
