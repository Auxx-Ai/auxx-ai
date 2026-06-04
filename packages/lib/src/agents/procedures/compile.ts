// packages/lib/src/agents/procedures/compile.ts

import { createHash } from 'node:crypto'
import { generateId } from '@auxx/utils'
import type { ConditionGroup } from '../../conditions/types'
import { PROCEDURE_NODE_TYPES, type TiptapDoc, type TiptapNode } from './nodes'
import type {
  ArgBindingMap,
  CompiledProcedure,
  LocalAttribute,
  ProcedureStep,
  StepId,
  SubProcedureId,
} from './types'

/**
 * Compile an authored procedure TipTap doc into the runtime step tree. PURE:
 * no DB, no I/O. Coalesces contiguous prose into single `instruction` steps,
 * threads `next` tree-structured (no gotos), lifts declared assets, and returns
 * `errors[]` (never throws) for any structural problem that should block publish.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §4.
 */

export interface CompileError {
  code:
    | 'MISSING_SWITCH_TARGET'
    | 'MISSING_CALL_TARGET'
    | 'UNKNOWN_SUBPROCEDURE'
    | 'UNCALLED_SUBPROCEDURE'
    | 'UNKNOWN_CODE_BLOCK'
    | 'UNKNOWN_ATTRIBUTE'
    | 'DANGLING_REF'
    | 'CYCLE'
  message: string
  stepId?: StepId
  subProcedureId?: SubProcedureId
}

export interface CompileResult {
  compiled: CompiledProcedure
  contentHash: string
  errors?: CompileError[]
}

const STRUCTURAL = new Set<string>([
  PROCEDURE_NODE_TYPES.conditionBlock,
  PROCEDURE_NODE_TYPES.routingStep,
  PROCEDURE_NODE_TYPES.codeStep,
  PROCEDURE_NODE_TYPES.toolStep,
  PROCEDURE_NODE_TYPES.subProcedure,
])

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

  /**
   * Compile a linear list of nodes into a chain of steps whose final step's
   * `next` is `continuation`. Returns the chain's entry step id (or `continuation`
   * if the list produces no body steps). `subProcedure` nodes are skipped — they
   * are compiled separately and reachable only via a `call`.
   */
  const compileSequence = (nodes: TiptapNode[], continuation: StepId | null): StepId | null => {
    // Partition into ordered units: maximal prose runs vs single structural nodes.
    type Unit = { prose: TiptapNode[] } | { node: TiptapNode }
    const units: Unit[] = []
    let proseRun: TiptapNode[] = []
    const flush = () => {
      if (proseRun.length > 0) {
        units.push({ prose: proseRun })
        proseRun = []
      }
    }
    for (const node of nodes) {
      if (node.type === PROCEDURE_NODE_TYPES.subProcedure) continue // compiled separately
      if (STRUCTURAL.has(node.type)) {
        flush()
        units.push({ node })
      } else {
        proseRun.push(node)
      }
    }
    flush()

    // Thread back-to-front so each unit's tail points at the entry of the rest.
    let nextEntry = continuation
    for (let i = units.length - 1; i >= 0; i--) {
      const unit = units[i]!
      nextEntry =
        'prose' in unit
          ? emit({
              id: generateId(),
              kind: 'instruction',
              doc: { type: 'fragment', content: unit.prose },
              next: nextEntry,
            })
          : compileNode(unit.node, nextEntry)
    }
    return nextEntry
  }

  /** Compile one structural node, linking its tail to `continuation`. Returns its entry id. */
  const compileNode = (node: TiptapNode, continuation: StepId | null): StepId => {
    const attrs = node.attrs ?? {}
    switch (node.type) {
      case PROCEDURE_NODE_TYPES.conditionBlock: {
        const id = generateId()
        const cases: { group: ConditionGroup; thenStep: StepId | null }[] = []
        let elseStep: StepId | null = null
        for (const child of node.content ?? []) {
          if (child.type === PROCEDURE_NODE_TYPES.conditionCase) {
            cases.push({
              group: (child.attrs?.group ?? {}) as ConditionGroup,
              thenStep: compileSequence(child.content ?? [], continuation),
            })
          } else if (child.type === PROCEDURE_NODE_TYPES.conditionElse) {
            elseStep = compileSequence(child.content ?? [], continuation)
          }
        }
        return emit({ id, kind: 'condition', cases, elseStep, next: continuation })
      }
      case PROCEDURE_NODE_TYPES.routingStep: {
        const outcome = attrs.outcome as 'finished' | 'handoff' | 'switch' | 'call'
        // 'call' returns to `continuation`; every other outcome ends this frame.
        const next = outcome === 'call' ? continuation : null
        return emit({
          id: generateId(),
          kind: 'routing',
          outcome,
          toolName: attrs.toolName as string | undefined,
          switchToProcedureId: attrs.switchToProcedureId as string | undefined,
          subProcedureId: attrs.subProcedureId as SubProcedureId | undefined,
          next,
        })
      }
      case PROCEDURE_NODE_TYPES.codeStep: {
        const codeBlockId = (attrs.codeBlockId as string | undefined) ?? generateId()
        codeBlocks[codeBlockId] = {
          language: 'javascript',
          code: (attrs.code as string | undefined) ?? '',
          inputs: (attrs.inputs as unknown[] | undefined) ?? [],
          outputs: (attrs.outputs as unknown[] | undefined) ?? [],
        }
        return emit({ id: generateId(), kind: 'code', codeBlockId, next: continuation })
      }
      case PROCEDURE_NODE_TYPES.toolStep: {
        return emit({
          id: generateId(),
          kind: 'tool',
          toolName: (attrs.toolName as string | undefined) ?? '',
          argBindings: attrs.argBindings as ArgBindingMap | undefined,
          assignTo: attrs.assignTo as string | undefined,
          next: continuation,
        })
      }
      default:
        // Unknown structural node — treat as an empty instruction so the chain stays intact.
        return emitTrivial(continuation)
    }
  }

  // ── body ──────────────────────────────────────────────────────────────
  const topLevel = doc.content ?? []
  let entryStepId = compileSequence(topLevel, null)
  if (entryStepId === null) entryStepId = emitTrivial(null)

  // ── sub-procedures (compiled into the shared `steps` map, reached only via `call`) ──
  for (const node of topLevel) {
    if (node.type !== PROCEDURE_NODE_TYPES.subProcedure) continue
    const subProcedureId = node.attrs?.subProcedureId as SubProcedureId | undefined
    if (!subProcedureId) continue
    const name = (node.attrs?.name as string | undefined) ?? ''
    let subEntry = compileSequence(node.content ?? [], null)
    if (subEntry === null) subEntry = emitTrivial(null)
    subProcedures[subProcedureId] = { id: subProcedureId, name, entryStepId: subEntry }
  }

  const localAttributes: LocalAttribute[] = doc.localAttributes ?? []

  const compiled: CompiledProcedure = {
    entryStepId,
    steps,
    codeBlocks,
    subProcedures,
    localAttributes,
  }

  const errors = validate(compiled)
  return { compiled, contentHash, ...(errors.length > 0 ? { errors } : {}) }
}

// ── validation ────────────────────────────────────────────────────────────

function validate(compiled: CompiledProcedure): CompileError[] {
  const { steps, codeBlocks, subProcedures, localAttributes } = compiled
  const errors: CompileError[] = []

  const subProcIds = new Set(Object.keys(subProcedures))
  const attrNames = new Set(localAttributes.map((a) => a.name))
  const calledSubProcs = new Set<SubProcedureId>()

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

    if (step.kind === 'code' && !(step.codeBlockId in codeBlocks)) {
      errors.push({
        code: 'UNKNOWN_CODE_BLOCK',
        message: `Code step references unknown code block "${step.codeBlockId}".`,
        stepId: step.id,
      })
    }

    if (step.kind === 'tool' && step.assignTo) {
      // assignTo must name a declared local attribute or look like a CRM FieldReference.
      const looksLikeFieldRef = /[.:]/.test(step.assignTo)
      if (!attrNames.has(step.assignTo) && !looksLikeFieldRef) {
        errors.push({
          code: 'UNKNOWN_ATTRIBUTE',
          message: `Tool step assigns to undeclared attribute "${step.assignTo}".`,
          stepId: step.id,
        })
      }
    }
  }

  // a declared sub-procedure that is never called (the run-time 422, surfaced at compile)
  for (const id of subProcIds) {
    if (!calledSubProcs.has(id)) {
      errors.push({
        code: 'UNCALLED_SUBPROCEDURE',
        message: `Sub-procedure "${id}" is declared but never called.`,
        subProcedureId: id,
      })
    }
  }

  // cycle detection over the call graph (a sub-procedure that call's itself transitively)
  errors.push(...detectCallCycles(compiled))

  return errors
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
