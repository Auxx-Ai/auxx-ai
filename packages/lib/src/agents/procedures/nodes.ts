// packages/lib/src/agents/procedures/nodes.ts

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '../../conditions/types'
import type { FieldOptions } from '../../custom-fields/field-options'
import type { ArgBindingMap, LocalAttribute, SubProcedureId } from './types'

/**
 * The TipTap node JSON contract the compiler consumes (Phase 2 builds the editor
 * that produces it). Mirror `kb-article/{block,panel}-node.ts` JSON shape:
 * `{ type, attrs?, content? }`. These are SHAPES only — the compiler walks the
 * generic {@link TiptapNode} tree and reads the attrs documented below.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §3.
 */

/** A generic TipTap node. The compiler narrows by `type` and reads `attrs`. */
export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/**
 * The authored procedure document. Beyond the node tree (`content`), it carries
 * top-level declared assets referenced by id/name — the create/consume pairs:
 * `localAttributes` ("Create attribute") and `subProcedures` register here
 * (the latter also appears inline as `subProcedure` nodes whose `block+`
 * children compile into steps).
 */
export interface TiptapDoc {
  type: 'doc'
  content?: TiptapNode[]
  /** Declared scratch variables, lifted verbatim into `CompiledProcedure.localAttributes`. */
  localAttributes?: LocalAttribute[]
}

// ── per-node attr shapes (documentation of the contract) ─────────────────

/** `conditionCase` node: one IF / ELSE-IF arm carrying a single `ConditionGroup`. */
export interface ConditionCaseAttrs {
  group: ConditionGroup
}

/** `routingStep` leaf — a terminal/branching outcome for the frame. */
export interface RoutingStepAttrs {
  outcome: 'finished' | 'handoff' | 'switch' | 'call'
  /** when `outcome: 'call'` — the local sub-procedure to run. */
  subProcedureId?: SubProcedureId
  /** when `outcome: 'switch'` — the standalone Procedure to replace the frame with. */
  switchToProcedureId?: string
  toolName?: string
}

/** `codeStep` leaf — an inline JavaScript block (compiles to a `code` step + `codeBlocks` entry). */
export interface CodeStepAttrs {
  codeBlockId: string
  language: 'javascript'
  code: string
  inputs: unknown[]
  outputs: unknown[]
}

/** `toolStep` leaf — a single tool call; `assignTo` names the `localAttribute` its result writes into. */
export interface ToolStepAttrs {
  toolName: string
  argBindings?: ArgBindingMap
  assignTo?: string
}

/** `subProcedure` container — the "Create sub-procedure" definition; its `block+` children compile into `steps`. */
export interface SubProcedureNodeAttrs {
  subProcedureId: SubProcedureId
  name: string
}

/** `localAttribute` declaration — the "Create attribute" definition (same `dataType`/`options` a CustomField uses). */
export interface LocalAttributeNodeAttrs {
  name: string
  dataType: FieldType
  options?: FieldOptions
}

/** The node `type` strings the compiler recognizes as structural (non-prose). */
export const PROCEDURE_NODE_TYPES = {
  conditionBlock: 'conditionBlock',
  conditionCase: 'conditionCase',
  conditionElse: 'conditionElse',
  routingStep: 'routingStep',
  codeStep: 'codeStep',
  toolStep: 'toolStep',
  subProcedure: 'subProcedure',
} as const

export type ProcedureNodeType = (typeof PROCEDURE_NODE_TYPES)[keyof typeof PROCEDURE_NODE_TYPES]
