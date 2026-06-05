// packages/lib/src/agents/procedures/index.ts

export {
  type ClassifierCandidate,
  type ClassifyDeps,
  type ConversationMessage,
  classifyProcedure,
} from './classify'
export type { CompileError, CompileResult } from './compile'
export { compileProcedure } from './compile'
export { buildProcedureFieldResolver } from './context'
export {
  type CodeBlockMapEntry,
  type ConditionBlockAttrs,
  type ConditionCaseAttrs,
  isOwnStepBadge,
  type LocalAttributeNodeAttrs,
  type ParsedStepBadge,
  PROCEDURE_NODE_TYPES,
  type ProcedureNodeType,
  parseStepBadgeId,
  STEP_BADGE_PREFIXES,
  type SubProcedureMapEntry,
  type TiptapDoc,
  type TiptapNode,
} from './nodes'
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
  revertProcedure,
  updateAgentProcedure,
  updateDraftDoc,
  updateProcedure,
} from './queries'
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
export type {
  ArgBindingMap,
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
