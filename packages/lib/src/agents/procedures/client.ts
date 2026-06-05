// packages/lib/src/agents/procedures/client.ts

/**
 * Client-safe surface of the procedures module — pure types + the node-type
 * const only. The barrel (`index.ts`) re-exports `queries.ts`, which pulls in
 * `@auxx/database`; client code (the Phase-2 editor / node views) must import
 * from HERE, not the barrel (CLAUDE.md client-import rule). `./types` and
 * `./nodes` carry only type-level deps (`FieldType`/`ConditionGroup`/`FieldOptions`
 * are erased), so this entry stays free of server-only code.
 */

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
