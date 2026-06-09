// packages/lib/src/agents/procedures/nodes.ts

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '../../conditions/types'
import type { FieldOptions } from '../../custom-fields/field-options'
import type { CodeOutput, LocalAttribute, SubProcedureId } from './types'

/**
 * The TipTap node JSON contract the v2 compiler consumes. The v2 editor
 * (`phase-2-authoring-v2.md`) replaced the v1 control-flow block nodes with
 * **inline badges + doc-level maps + dual-mode conditions**. There are now only
 * four structural node types — the IF/ELSE-IF/ELSE construct (`conditionBlock`,
 * `conditionCase`, `conditionElse`, `conditionPredicate`). Everything else is
 * authored as prose carrying **inline step badges** (`reference` nodes whose
 * `attrs.id` is a prefixed string — see {@link parseStepBadgeId}) plus two
 * **doc-level maps** on {@link TiptapDoc} (`subProcedures` / `codeBlocks`).
 *
 * These are SHAPES only — the compiler walks the generic {@link TiptapNode} tree
 * and reads the attrs documented below.
 *
 * See plans/chat/v9/phase-2-fix-compiler-conditions.md §1 and §3.1.
 */

/** A generic TipTap node. The compiler narrows by `type` and reads `attrs`. */
export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** A doc-level sub-procedure definition — a named, drillable body of prose. */
export interface SubProcedureMapEntry {
  id: SubProcedureId
  name: string
  content: TiptapNode[]
}

/**
 * A doc-level code block — a named JavaScript snippet referenced by inline `code:<id>`
 * badges. Beyond the source, it carries the declared output bindings the §5 UI authors:
 * which `result` keys land in `var:*`. The block's `main(inputs)` reads the ambient
 * whole-procedure `inputs` bag by path (no per-block input config). The compiler lifts
 * the outputs onto the emitted `code` step ({@link parseCodeBindings}).
 */
export interface CodeBlockMapEntry {
  id: string
  name: string
  language: 'javascript'
  code: string
  outputs?: CodeOutput[]
}

/**
 * The authored procedure document. Beyond the prose tree (`content`), it carries
 * the v2 doc-level maps and declared scratch:
 *
 * - `localAttributes` — declared `var:*` scratch, lifted verbatim into `compiled`.
 * - `subProcedures` — named bodies reached by drilling in; **referenced** from
 *   prose by inline `subprocedure:<id>` badges (NOT inline nodes).
 * - `codeBlocks` — named JS snippets; **referenced** from prose by inline
 *   `code:<id>` badges (NOT inline nodes).
 */
export interface TiptapDoc {
  type: 'doc'
  content?: TiptapNode[]
  /** Declared scratch variables, lifted verbatim into `CompiledProcedure.localAttributes`. */
  localAttributes?: LocalAttribute[]
  /** Doc-level sub-procedure bodies, compiled into the shared `steps` map. */
  subProcedures?: SubProcedureMapEntry[]
  /** Doc-level code blocks, lifted into `CompiledProcedure.codeBlocks`. */
  codeBlocks?: CodeBlockMapEntry[]
}

// ── inline step-badge grammar ─────────────────────────────────────────────
//
// Inline badges are `reference` nodes whose `attrs.id` is a prefixed string. The
// editor's canonical prefix test lives in `procedure-step-badge.tsx`
// (`isProcedureStepId`); this is the pure lib twin the compiler shares.

/** Inline-badge id prefixes (the lib twin of the editor's `procedure-step-badge.tsx`). */
export const STEP_BADGE_PREFIXES = {
  subProcedure: 'subprocedure:',
  code: 'code:',
  route: 'route:',
} as const

/** A parsed inline step badge. `route` carries the terminal/switch outcome. */
export type ParsedStepBadge =
  | { kind: 'subprocedure'; subProcedureId: SubProcedureId }
  | { kind: 'code'; codeBlockId: string }
  | { kind: 'route'; outcome: 'finished' | 'handoff' }
  | { kind: 'route'; outcome: 'switch'; switchToProcedureId: string }

/**
 * Parse a `reference` node's `attrs.id` into a step badge, or `null` if the id is
 * a plain reference (a `field:` / `entity:` / `tool:` / record id, etc.). PURE —
 * the lib twin of the editor's `isProcedureStepId`/`ProcedureStepBadge`. Used by
 * the compiler (split the prose chain) and `doc-to-text` (render markers).
 */
export function parseStepBadgeId(id: string): ParsedStepBadge | null {
  if (id.startsWith(STEP_BADGE_PREFIXES.subProcedure)) {
    return {
      kind: 'subprocedure',
      subProcedureId: id.slice(STEP_BADGE_PREFIXES.subProcedure.length),
    }
  }
  if (id.startsWith(STEP_BADGE_PREFIXES.code)) {
    return { kind: 'code', codeBlockId: id.slice(STEP_BADGE_PREFIXES.code.length) }
  }
  if (id.startsWith(STEP_BADGE_PREFIXES.route)) {
    const payload = id.slice(STEP_BADGE_PREFIXES.route.length)
    if (payload === 'handoff') return { kind: 'route', outcome: 'handoff' }
    if (payload.startsWith('switch:')) {
      return {
        kind: 'route',
        outcome: 'switch',
        switchToProcedureId: payload.slice('switch:'.length),
      }
    }
    // `route:finished` and any unknown route payload → a terminal end.
    return { kind: 'route', outcome: 'finished' }
  }
  return null
}

/**
 * Whether an inline badge is an **own-step** badge (splits the prose chain) vs. an inline op.
 * `code:` is an own step (D2) — it compiles to a deterministic `code` step the stepper walks
 * through, NOT an inline hint left in an instruction's prose.
 */
export function isOwnStepBadge(id: string): boolean {
  return (
    id.startsWith(STEP_BADGE_PREFIXES.subProcedure) ||
    id.startsWith(STEP_BADGE_PREFIXES.route) ||
    id.startsWith(STEP_BADGE_PREFIXES.code)
  )
}

/**
 * Parse the declared output bindings carried on a doc-level `codeBlocks` map entry
 * (authored by the §5 binding UI). Tolerant: a malformed or absent entry is dropped, so a
 * half-authored block compiles to a code step with the outputs it does have (the compiler
 * then `validate`s the survivors). Inputs are gone in v9 — the block reads the ambient
 * `inputs` bag by path. PURE.
 */
export function parseCodeBindings(entry: { outputs?: unknown } | undefined): {
  outputs: CodeOutput[]
} {
  const outputs: CodeOutput[] = []
  for (const raw of Array.isArray(entry?.outputs) ? entry.outputs : []) {
    const name = typeof (raw as CodeOutput)?.name === 'string' ? (raw as CodeOutput).name : ''
    if (name) outputs.push({ name, surfaceToModel: (raw as CodeOutput)?.surfaceToModel === true })
  }
  return { outputs }
}

// ── per-node attr shapes (documentation of the contract) ─────────────────

/**
 * `conditionBlock` node — the dual-mode IF/ELSE-IF/ELSE construct. `mode` is a
 * **block-level** attr (decision D1): the whole construct is either a `text` gate
 * (NL predicates) or a `structured` gate (ConditionGroups); every arm shares it.
 */
export interface ConditionBlockAttrs {
  id: string
  mode: 'text' | 'structured'
}

/**
 * `conditionCase` node — one IF / ELSE-IF arm. In `structured` mode `group` holds
 * the builder state; in `text` mode the leading `conditionPredicate` child holds
 * the NL test instead. Arm order = precedence; there is no `kind` attr.
 */
export interface ConditionCaseAttrs {
  id: string
  group?: ConditionGroup
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
  conditionPredicate: 'conditionPredicate',
} as const

export type ProcedureNodeType = (typeof PROCEDURE_NODE_TYPES)[keyof typeof PROCEDURE_NODE_TYPES]

// Deterministic, key-order-independent JSON serialization — used to content-hash
// a {@link TiptapDoc} so the hash is stable across a Postgres `jsonb` round-trip.
// Lives in @auxx/utils/json now; re-exported so existing `import { stableStringify }
// from './nodes'` call sites keep working.
export { stableStringify } from '@auxx/utils/json'
