// packages/lib/src/agents/procedures/compile.ts

import { createHash } from 'node:crypto'
import { generateId } from '@auxx/utils'
import type { ConditionGroup } from '../../conditions/types'
import { docToText } from '../../tiptap'
import {
  type ParsedStepBadge,
  PROCEDURE_NODE_TYPES,
  parseCodeBindings,
  type TiptapDoc,
  type TiptapNode,
} from './nodes'
import { segmentNodes } from './segment'
import type { CompiledProcedure, ProcedureStep, StepId, SubProcedureId } from './types'

/**
 * Compile an authored v2 procedure TipTap doc into the runtime step tree. PURE:
 * no DB, no I/O. The v2 doc shape (plan §1):
 *
 * - **prose + inline badges** — contiguous prose coalesces into `instruction`
 *   steps; `@tool` / `code:` reference badges **stay inline** in the step's `doc`,
 *   while a `subprocedure:` or `route:` badge is an **own step** that flushes the
 *   prose and emits its own `routing` step (D4/D5).
 * - **doc-level maps** — `doc.subProcedures[]` bodies compile into the shared
 *   `steps` map (reached only via a `call`); `doc.codeBlocks[]` lift into
 *   `compiled.codeBlocks` (referenced by inline `code:<id>` badges).
 * - **dual-mode conditions** — a `conditionBlock` always compiles to a real
 *   `condition` step (a gate); `mode` is block-level, each case carries a
 *   `group` (structured) or a compiled `predicate` string (text). Bodies are
 *   always separate steps (D1/D2/D3).
 *
 * `next` is threaded tree-structured (no gotos). Returns `errors[]` (never
 * throws) for any structural problem that should block publish.
 *
 * See plans/chat/v9/phase-2-fix-compiler-conditions.md §3.3.
 */

export interface CompileError {
  code:
    | 'MISSING_SWITCH_TARGET'
    | 'MISSING_CALL_TARGET'
    | 'UNKNOWN_SUBPROCEDURE'
    | 'UNKNOWN_CODE_BLOCK'
    | 'UNKNOWN_OUTPUT_ATTRIBUTE'
    | 'EMPTY_CONDITION_GROUP'
    | 'EMPTY_PREDICATE'
    | 'DANGLING_REF'
    | 'CYCLE'
  message: string
  stepId?: StepId
  subProcedureId?: SubProcedureId
}

/**
 * Non-blocking compile signals — surfaced for authoring lint, but they do NOT
 * block publish. `UNCALLED_SUBPROCEDURE` is intentionally a warning: a procedure's
 * sub-procedures / code blocks are first-class building blocks that persist even
 * when no badge references them (authored via the Building blocks popover).
 */
export interface CompileWarning {
  code: 'UNCALLED_SUBPROCEDURE'
  message: string
  subProcedureId?: SubProcedureId
}

export interface CompileResult {
  compiled: CompiledProcedure
  contentHash: string
  errors?: CompileError[]
  warnings?: CompileWarning[]
}

export function compileProcedure(doc: TiptapDoc): CompileResult {
  const contentHash = createHash('sha256').update(JSON.stringify(doc), 'utf8').digest('hex')

  const steps: Record<StepId, ProcedureStep> = {}
  const codeBlocks: CompiledProcedure['codeBlocks'] = {}
  const subProcedures: Record<SubProcedureId, CompiledProcedure['subProcedures'][string]> = {}

  const emit = (step: ProcedureStep): StepId => {
    steps[step.id] = step
    return step.id
  }

  /** A trivial empty instruction step — used for an empty body or empty sub-procedure. */
  const emitTrivial = (continuation: StepId | null): StepId =>
    emit({
      id: generateId(),
      kind: 'instruction',
      doc: { type: 'fragment', content: [] },
      next: continuation,
    })

  // Prose-vs-control segmentation is shared with `doc-to-dsl.ts` — see `segment.ts`.

  // Per-block output bindings, lifted from the doc-level `codeBlocks` map onto each emitted
  // `code` step (the compiled block holds source only; the declared outputs live on the step).
  const codeOutputsById = new Map(
    (doc.codeBlocks ?? [])
      .filter((cb) => cb?.id)
      .map((cb) => [cb.id, parseCodeBindings(cb).outputs])
  )

  /** Compile one `subprocedure:`/`route:`/`code:` own-step badge, linking to `continuation`. */
  const compileBadge = (badge: ParsedStepBadge, continuation: StepId | null): StepId => {
    if (badge.kind === 'code') {
      // A deterministic code step — its declared outputs come from the doc-level code-block entry.
      const outputs = codeOutputsById.get(badge.codeBlockId) ?? []
      return emit({
        id: generateId(),
        kind: 'code',
        codeBlockId: badge.codeBlockId,
        outputs,
        next: continuation,
      })
    }
    if (badge.kind === 'subprocedure') {
      // a call returns to `continuation` after the sub-procedure finishes.
      return emit({
        id: generateId(),
        kind: 'routing',
        outcome: 'call',
        subProcedureId: badge.subProcedureId,
        next: continuation,
      })
    }
    if (badge.kind === 'route') {
      // every terminal ends the frame — `next` is null regardless of `continuation`.
      if (badge.outcome === 'switch') {
        return emit({
          id: generateId(),
          kind: 'routing',
          outcome: 'switch',
          switchToProcedureId: badge.switchToProcedureId,
          next: null,
        })
      }
      return emit({ id: generateId(), kind: 'routing', outcome: badge.outcome, next: null })
    }
    // All badge kinds are handled above — keep the chain intact for an unknown future kind.
    return emitTrivial(continuation)
  }

  /** Compile a `conditionBlock` → a real `condition` step (a gate); bodies are own steps. */
  const compileCondition = (node: TiptapNode, continuation: StepId | null): StepId => {
    const id = generateId()
    const mode = node.attrs?.mode === 'structured' ? 'structured' : 'text'
    const cases: { thenStep: StepId | null; group?: ConditionGroup; predicate?: string }[] = []
    let elseStep: StepId | null = null

    for (const child of node.content ?? []) {
      if (child.type === PROCEDURE_NODE_TYPES.conditionCase) {
        // The arm body = the case's children minus the leading `conditionPredicate`.
        const body = (child.content ?? []).filter(
          (c) => c.type !== PROCEDURE_NODE_TYPES.conditionPredicate
        )
        const thenStep = compileSequence(body, continuation)
        if (mode === 'structured') {
          cases.push({ thenStep, group: (child.attrs?.group ?? {}) as ConditionGroup })
        } else {
          cases.push({ thenStep, predicate: predicateText(child) })
        }
      } else if (child.type === PROCEDURE_NODE_TYPES.conditionElse) {
        elseStep = compileSequence(child.content ?? [], continuation)
      }
    }

    return emit({ id, kind: 'condition', mode, cases, elseStep, next: continuation })
  }

  /**
   * Compile a linear list of nodes into a chain of steps whose final step's
   * `next` is `continuation`. Returns the chain's entry step id (or `continuation`
   * if the list produces no body steps).
   */
  const compileSequence = (nodes: TiptapNode[], continuation: StepId | null): StepId | null => {
    const units = segmentNodes(nodes)

    // Thread back-to-front so each unit's tail points at the entry of the rest.
    let nextEntry = continuation
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!
      if (unit.kind === 'prose') {
        nextEntry = emit({
          id: generateId(),
          kind: 'instruction',
          doc: { type: 'fragment', content: unit.nodes },
          next: nextEntry,
        })
      } else if (unit.kind === 'condition') {
        nextEntry = compileCondition(unit.node, nextEntry)
      } else {
        nextEntry = compileBadge(unit.badge, nextEntry)
      }
    }
    return nextEntry
  }

  // ── body ──────────────────────────────────────────────────────────────
  const topLevel = doc.content ?? []
  let entryStepId = compileSequence(topLevel, null)
  if (entryStepId === null) entryStepId = emitTrivial(null)

  // ── code blocks (doc-level map → compiled.codeBlocks, referenced by `code:` badges) ──
  for (const cb of doc.codeBlocks ?? []) {
    if (!cb?.id) continue
    codeBlocks[cb.id] = { language: cb.language ?? 'javascript', code: cb.code ?? '' }
  }

  // ── sub-procedures (doc-level map → shared `steps`, reached only via a `call`) ──
  for (const sp of doc.subProcedures ?? []) {
    if (!sp?.id) continue
    let subEntry = compileSequence(sp.content ?? [], null)
    if (subEntry === null) subEntry = emitTrivial(null)
    subProcedures[sp.id] = { id: sp.id, name: sp.name ?? '', entryStepId: subEntry }
  }

  const compiled: CompiledProcedure = {
    entryStepId,
    steps,
    codeBlocks,
    subProcedures,
    localAttributes: doc.localAttributes ?? [],
  }

  const { errors, warnings } = validate(compiled)
  return {
    compiled,
    contentHash,
    ...(errors.length > 0 ? { errors } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/** Render a `conditionCase`'s `conditionPredicate` child to a plain NL test string. */
function predicateText(caseNode: TiptapNode): string {
  const pred = (caseNode.content ?? []).find(
    (c) => c.type === PROCEDURE_NODE_TYPES.conditionPredicate
  )
  return pred ? docToText(pred) : ''
}

// ── validation ────────────────────────────────────────────────────────────

function validate(compiled: CompiledProcedure): {
  errors: CompileError[]
  warnings: CompileWarning[]
} {
  const { steps, codeBlocks, subProcedures, localAttributes } = compiled
  const errors: CompileError[] = []
  const warnings: CompileWarning[] = []

  const subProcIds = new Set(Object.keys(subProcedures))
  const calledSubProcs = new Set<SubProcedureId>()
  const attrNames = new Set(localAttributes.map((a) => a.name))

  const exists = (ref: StepId | null): boolean => ref === null || ref in steps

  for (const step of Object.values(steps)) {
    // dangling next / branch refs (the compiler threads these, so this is a guard)
    const refs: (StepId | null)[] = [step.next]
    if (step.kind === 'condition') {
      refs.push(step.elseStep, ...step.cases.map((c) => c.thenStep))
    }
    for (const ref of refs) {
      if (!exists(ref)) {
        errors.push({
          code: 'DANGLING_REF',
          message: `Step references unknown step "${ref}".`,
          stepId: step.id,
        })
      }
    }

    if (step.kind === 'condition') {
      for (const c of step.cases) {
        if (step.mode === 'structured') {
          const conditions = c.group?.conditions
          if (!Array.isArray(conditions) || conditions.length === 0) {
            errors.push({
              code: 'EMPTY_CONDITION_GROUP',
              message: 'A Rules-mode condition arm has no conditions.',
              stepId: step.id,
            })
          }
        } else if (!c.predicate || c.predicate.trim().length === 0) {
          errors.push({
            code: 'EMPTY_PREDICATE',
            message: 'A Text-mode condition arm has an empty predicate.',
            stepId: step.id,
          })
        }
      }
    }

    if (step.kind === 'routing') {
      if (step.outcome === 'switch' && !step.switchToProcedureId) {
        errors.push({
          code: 'MISSING_SWITCH_TARGET',
          message: 'A switch step has no switchToProcedureId.',
          stepId: step.id,
        })
      }
      if (step.outcome === 'call') {
        if (!step.subProcedureId) {
          errors.push({
            code: 'MISSING_CALL_TARGET',
            message: 'A call step has no subProcedureId.',
            stepId: step.id,
          })
        } else {
          calledSubProcs.add(step.subProcedureId)
          if (!subProcIds.has(step.subProcedureId)) {
            errors.push({
              code: 'UNKNOWN_SUBPROCEDURE',
              message: `Call targets undeclared sub-procedure "${step.subProcedureId}".`,
              stepId: step.id,
              subProcedureId: step.subProcedureId,
            })
          }
        }
      }
    }

    // a `code` step must reference a known block and write only declared attributes.
    // Inputs are gone in v9 — the block reads the ambient `inputs` bag, no per-block refs.
    if (step.kind === 'code') {
      if (!(step.codeBlockId in codeBlocks)) {
        errors.push({
          code: 'UNKNOWN_CODE_BLOCK',
          message: `Code step references unknown code block "${step.codeBlockId}".`,
          stepId: step.id,
        })
      }
      for (const output of step.outputs) {
        if (!attrNames.has(output.name)) {
          errors.push({
            code: 'UNKNOWN_OUTPUT_ATTRIBUTE',
            message: `Code output "${output.name}" is not a declared local attribute.`,
            stepId: step.id,
          })
        }
      }
    }
  }

  // A declared sub-procedure that is never called. NON-BLOCKING (warning, not
  // error): unreferenced building blocks are kept on purpose — see CompileWarning.
  for (const id of subProcIds) {
    if (!calledSubProcs.has(id)) {
      warnings.push({
        code: 'UNCALLED_SUBPROCEDURE',
        message: `Sub-procedure "${id}" is declared but never called.`,
        subProcedureId: id,
      })
    }
  }

  // cycle detection over the call graph (a sub-procedure that call's itself transitively)
  errors.push(...detectCallCycles(compiled))

  return { errors, warnings }
}

/** Steps reachable from `entry` following `next` / condition branches (NOT crossing `call`). */
function reachableFrom(steps: Record<StepId, ProcedureStep>, entry: StepId | null): Set<StepId> {
  const seen = new Set<StepId>()
  const stack: (StepId | null)[] = [entry]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === null || seen.has(id)) continue
    const step = steps[id]
    if (!step) continue
    seen.add(id)
    stack.push(step.next)
    if (step.kind === 'condition') {
      stack.push(step.elseStep, ...step.cases.map((c) => c.thenStep))
    }
  }
  return seen
}

/** Detect cycles in the scope call-graph: `__body__` + each sub-procedure, edges via `call`. */
function detectCallCycles(compiled: CompiledProcedure): CompileError[] {
  const { steps, subProcedures, entryStepId } = compiled
  const scopes: { id: string; entry: StepId | null }[] = [
    { id: '__body__', entry: entryStepId },
    ...Object.values(subProcedures).map((s) => ({ id: s.id, entry: s.entryStepId })),
  ]

  const adjacency = new Map<string, Set<string>>()
  for (const scope of scopes) {
    const targets = new Set<string>()
    for (const id of reachableFrom(steps, scope.entry)) {
      const step = steps[id]!
      if (
        step.kind === 'routing' &&
        step.outcome === 'call' &&
        step.subProcedureId &&
        subProcedures[step.subProcedureId]
      ) {
        targets.add(step.subProcedureId)
      }
    }
    adjacency.set(scope.id, targets)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(scopes.map((s) => [s.id, WHITE]))
  const errors: CompileError[] = []

  const dfs = (node: string): boolean => {
    color.set(node, GRAY)
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next) ?? WHITE
      if (c === GRAY) return true // back-edge → cycle
      if (c === WHITE && dfs(next)) return true
    }
    color.set(node, BLACK)
    return false
  }

  for (const scope of scopes) {
    if ((color.get(scope.id) ?? WHITE) === WHITE && dfs(scope.id)) {
      errors.push({
        code: 'CYCLE',
        message: 'A sub-procedure call cycle was detected.',
        subProcedureId: scope.id,
      })
      break
    }
  }
  return errors
}
