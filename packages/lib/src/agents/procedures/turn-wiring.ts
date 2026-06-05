// packages/lib/src/agents/procedures/turn-wiring.ts

import { KopilotContextStore, syncContextSlice } from '../../ai/agent-framework/context'
import type { AgentEngine } from '../../ai/agent-framework/engine'
import type { Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import type { AgentEvent } from '../../ai/agent-framework/types'
import type { ProcedureStepInput } from '../../ai/kopilot/prompts/sections/types'
import type { CachedAgentProcedure } from '../../cache/org-cache-keys'
import { backstopClassify, classifyTextBranch, goalMetCheck } from './classifier'
import type { ClassifyDeps, ConversationMessage } from './classify'
import { PROCEDURE_STEP_KEY, readProcedureSlice, writeProcedureSlice } from './persist'
import type { AgentProcedureEntity, ProcedureEntity, ProcedureVersionEntity } from './queries'
import { getProcedureById, getProcedureVersionById, readCompiled } from './queries'
import { type ResolvedCandidate, type SelectionResult, selectProcedure } from './select'
import { depth, emptyStack, push, top } from './stack'
import { interpretSignal, type PrepareResult, prepareTurn, type StepperDeps } from './stepper'
import type { CompiledProcedure, ProcedureStack } from './types'

/**
 * The Phase-4 turn glue that the live processors call. This module owns the
 * *data wiring* around the already-built Phase-1 selection (`selectProcedure`)
 * and Phase-3 stepper (`prepareTurn` / `interpretSignal`):
 *
 *  - {@link resolveCandidatesFromCache} — `agents` org-cache projection →
 *    `ResolvedCandidate[]` (the stable selection seam).
 *  - {@link applySelection} — map a `SelectionResult` onto the persisted stack.
 *  - {@link buildActiveStepInput} — a `prepareTurn` inject result →
 *    `ProcedureStepInput` (what the `agentProcedureStep` prompt section reads).
 *  - {@link buildStepperDeps} — construct the 7-field `StepperDeps` (3 org-cache
 *    reads + 4 classifier closures) the stepper needs every turn.
 *
 * It does NOT own the engine loop. The sandwich (calling `prepareTurn` →
 * `engine.submitMessage` → `interpretSignal`, honouring `reinvoke`/`inlineFallback`,
 * and mounting the control tools) lands once the engine re-entry contract for
 * `reinvoke` is settled — `submitMessage` always appends a user message + resets
 * turn state, so a same-turn re-drain needs a dedicated entry point. See
 * plans/chat/v9/phase-4-wiring.md §1 + the verified-against-Phase-3 addendum.
 */

// ── candidate projection → ResolvedCandidate ──────────────────────────────

/**
 * Adapt the `agents` org-cache projection ({@link CachedAgentProcedure}, already
 * resolved `override ?? default`) into the {@link ResolvedCandidate} shape
 * `selectProcedure` consumes. Selection reads only `link.{enabled,priority}`,
 * `procedure.id`, `activeVersion.{id,compiled}`, and `resolved.*`; the entity
 * sub-objects carry exactly those (cast to the entity types — the projection is
 * not a full row, and selection never touches the missing columns).
 */
export function resolveCandidatesFromCache(
  procedures: readonly CachedAgentProcedure[]
): ResolvedCandidate[] {
  return procedures.map((p) => ({
    link: {
      id: p.linkId,
      procedureId: p.procedureId,
      enabled: p.enabled,
      priority: p.priority,
    } as unknown as AgentProcedureEntity,
    procedure: {
      id: p.procedureId,
      activeVersionId: p.activeVersionId,
    } as unknown as ProcedureEntity,
    activeVersion: {
      id: p.activeVersionId,
      compiled: p.compiled,
    } as unknown as ProcedureVersionEntity & { compiled: CompiledProcedure },
    resolved: {
      whenToUse: p.whenToUse,
      triggerExamples: p.triggerExamples,
      ruleset: p.ruleset,
    },
  }))
}

// ── selection → stack ─────────────────────────────────────────────────────

/**
 * Fold a {@link SelectionResult} into the persisted stack: `selected` pushes the
 * fresh frame 0; `resume` and `none` leave the stack untouched (the resumed frame
 * is already the top, and `none` is free-form persona mode).
 */
export function applySelection(stack: ProcedureStack, selection: SelectionResult): ProcedureStack {
  if (selection.kind === 'selected') return push(stack, selection.frame)
  return stack
}

// ── prepareTurn inject result → prompt-section input ───────────────────────

/**
 * Build the {@link ProcedureStepInput} the `agentProcedureStep` section renders,
 * from the active instruction step + the running version's compiled doc-level
 * maps (so inline `subprocedure:`/`code:` badges resolve to names) + the stack
 * depth. `topicLabel`/`returnToLabel` are left undefined for now — the breadcrumb
 * (Phase 3 `buildReanchorBreadcrumb`) carries the re-anchor line; richer side-request
 * labels are a follow-up.
 */
export function buildActiveStepInput(args: {
  activeStep: { doc: unknown }
  compiled: CompiledProcedure
  stack: ProcedureStack
  breadcrumb?: string
  codeOutputs?: { name: string; value: unknown }[]
  codeErrors?: { codeBlockId: string; error: string }[]
}): ProcedureStepInput {
  return {
    activeStep: { doc: args.activeStep.doc },
    procedureMaps: {
      subProcedures: Object.entries(args.compiled.subProcedures).map(([id, sub]) => ({
        id,
        name: sub.name,
      })),
      codeBlocks: Object.keys(args.compiled.codeBlocks).map((id) => ({ id, name: id })),
    },
    depth: depth(args.stack),
    breadcrumb: args.breadcrumb,
    codeOutputs: args.codeOutputs,
    codeErrors: args.codeErrors,
  }
}

// ── StepperDeps construction ───────────────────────────────────────────────

export interface BuildStepperDepsArgs {
  ctx: ToolContext
  subject: Subject
  /** Resolved candidates for THIS agent (from {@link resolveCandidatesFromCache}). */
  candidates: ResolvedCandidate[]
  /** This turn's conversation, for the classifier closures. */
  conversation: ConversationMessage[]
  /** Model/provider/org/user resolved by the caller (turn model — BYO-model). */
  classifyDeps: ClassifyDeps
}

/**
 * Construct the {@link StepperDeps} the Phase-3 stepper consumes: 3 org-cache
 * reads (`readVersion` / `loadActiveVersion` / `selectOther`) backed by the
 * candidate projection with a by-id DB fallback, and 4 classifier closures
 * (`pickTextBranch` / `checkGoalMet` / `classifyBackstop`) bound to this turn's
 * conversation + model.
 */
export function buildStepperDeps(args: BuildStepperDepsArgs): StepperDeps {
  const { ctx, subject, candidates, conversation, classifyDeps } = args
  const { organizationId } = classifyDeps

  // Pinned-version read: projection hit when the pin == an attached procedure's
  // active version (the common case), else a by-id DB read so an in-flight run
  // keeps its pinned version after an admin republish/revert.
  const readVersion: StepperDeps['readVersion'] = async (procedureVersionId) => {
    const hit = candidates.find((c) => c.activeVersion.id === procedureVersionId)
    if (hit) return { compiled: hit.activeVersion.compiled }
    const result = await getProcedureVersionById({ organizationId, procedureVersionId })
    if (result.isErr() || !result.value) return null
    const compiled = readCompiled(result.value)
    return compiled ? { compiled } : null
  }

  // Resolve a standalone procedure's CURRENT active version (for a `switch`):
  // projection hit when attached, else load the procedure + its active version.
  const loadActiveVersion: StepperDeps['loadActiveVersion'] = async (procedureId) => {
    const hit = candidates.find((c) => c.procedure.id === procedureId)
    if (hit) {
      return {
        procedureVersionId: hit.activeVersion.id,
        compiled: hit.activeVersion.compiled,
      }
    }
    const proc = await getProcedureById({ organizationId, procedureId })
    if (proc.isErr() || !proc.value?.activeVersionId) return null
    const version = await getProcedureVersionById({
      organizationId,
      procedureVersionId: proc.value.activeVersionId,
    })
    if (version.isErr() || !version.value) return null
    const compiled = readCompiled(version.value)
    return compiled ? { procedureVersionId: version.value.id, compiled } : null
  }

  // Digression re-run: Phase-1 selection over the agent's OTHER procedures. Use
  // an empty stack so the sticky-resume short-circuit doesn't fire, and exclude
  // the procedure that digressed.
  const selectOther: StepperDeps['selectOther'] = async (excludeProcedureId) => {
    const selection = await selectProcedure({
      stack: emptyStack(),
      candidates,
      conversation,
      ctx,
      subject,
      classifyDeps,
      excludeProcedureIds: [excludeProcedureId],
    })
    if (selection.kind !== 'selected') return null
    const chosen = candidates.find((c) => c.procedure.id === selection.frame.procedureId)
    if (!chosen) return null
    return {
      procedureId: selection.frame.procedureId,
      procedureVersionId: selection.frame.procedureVersionId,
      compiled: chosen.activeVersion.compiled,
    }
  }

  return {
    ctx,
    readVersion,
    loadActiveVersion,
    selectOther,
    pickTextBranch: (predicates) => classifyTextBranch(conversation, predicates, classifyDeps),
    checkGoalMet: (reply, activeStep) => goalMetCheck(reply, activeStep, classifyDeps),
    classifyBackstop: (reply, activeStep) => backstopClassify(reply, activeStep, classifyDeps),
    runCode,
  }
}

/**
 * The {@link StepperDeps.runCode} adapter over `invokeLambdaExecutor` — the same JS
 * sandbox the workflow code node uses (`workflow-engine/nodes/action-nodes/code.ts`).
 * Dynamically imported to keep `@auxx/services` off the import graph until a code step
 * actually runs. Unwraps the neverthrow `Result` + the structured runtime/validation
 * errors into the stepper's `{ ok, error }` contract; NEVER throws (a thrown adapter
 * would surface as an unhandled turn failure instead of D5 gate-by-absence).
 */
const runCode: StepperDeps['runCode'] = async (block, codeInput) => {
  try {
    const { invokeLambdaExecutor } = await import('@auxx/services/lambda-execution')
    const result = await invokeLambdaExecutor({
      caller: 'procedure-stepper',
      payload: {
        type: 'code',
        code: block.code,
        codeLanguage: 'javascript',
        codeInput,
        inputsConfig: [],
        variables: {},
        timeout: 30000,
      },
    })
    if (result.isErr()) return { ok: false, error: result.error.message }
    const meta = result.value.metadata
    if (meta?.runtime_error) return { ok: false, error: meta.runtime_error.message }
    if (meta?.validation_error) return { ok: false, error: meta.validation_error.message }
    const execResult = result.value.execution_result
    const out =
      execResult && typeof execResult === 'object' ? (execResult as Record<string, unknown>) : {}
    return { ok: true, result: out }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ── the sandwich ───────────────────────────────────────────────────────────

/** Bound on same-turn re-drains; the engine's token budget is the real backstop. */
const MAX_REINVOKES = 8

export interface RunProcedureTurnArgs {
  engine: AgentEngine
  /** The customer message that opened this turn (drained via `submitMessage`). */
  inboundText: string
  /** This agent's projected procedures (org-cache). `[]` → caller should skip entirely. */
  procedures: readonly CachedAgentProcedure[]
  subject: Subject
  conversation: ConversationMessage[]
  /** Model/provider/org/user (turn model — BYO-model) + db for the classifiers. */
  classifyDeps: ClassifyDeps
  /**
   * Build a fresh {@link ToolContext} whose `context` is a `KopilotContextStore`
   * hydrated from the engine's CURRENT `domainState`. Called per stepper phase so
   * the post-drain control signal (synced into `domainState` by the query loop) is
   * visible to `interpretSignal`.
   */
  buildCtx: () => ToolContext
  /** Consume one engine drain (`submitMessage`/`continueTurn`), return the reply text. */
  drain: (gen: AsyncGenerator<AgentEvent>) => Promise<string>
  /**
   * Invoked once (best-effort) when this turn escalated to a human — a routing
   * `handoff` step or the `handoff_to_human` control tool. The chat caller flips
   * the thread to the human queue; internal autonomous runs have no human queue
   * and omit it. The stack is already cleared by the stepper. See §6 reconciliation.
   */
  onHandoff?: () => Promise<void> | void
}

/**
 * The Phase-4 turn sandwich: Phase-1 selection, then a loop that wraps the engine
 * drain between Phase-3 `prepareTurn` (write the active step → drain) and
 * `interpretSignal` (read the control signal → mutate the stack), honouring
 * `reinvoke` (same-turn re-drain via {@link AgentEngine.continueTurn}) and
 * `inlineFallback` (one persona-only drain). Returns the final customer-facing
 * reply (last non-empty across all drains) for the caller to deliver.
 *
 * The stack + the turn-local active step ride `domainState` (mutated in place — the
 * engine carries the same object forward), so they persist via the caller's normal
 * `updateSessionDomainState`. See plans/chat/v9/phase-4-wiring.md §1.
 */
export async function runProcedureTurn(args: RunProcedureTurnArgs): Promise<string> {
  const { engine, inboundText, procedures, subject, conversation, classifyDeps, buildCtx, drain } =
    args
  const candidates = resolveCandidatesFromCache(procedures)
  // Set by either handoff path; flips the thread to a human once, after the loop.
  let handedOff = false
  // getState() shallow-clones, so `.domainState` is the live object — mutate in place.
  const liveDomainState = () => engine.getState().domainState as Record<string, unknown>

  const makeDeps = (ctx: ToolContext): StepperDeps =>
    buildStepperDeps({ ctx, subject, candidates, conversation, classifyDeps })

  // 1. selection — sticky resume / fresh frame 0 / none.
  let stack = readProcedureSlice(liveDomainState()) ?? emptyStack()
  const selection = await selectProcedure({
    stack,
    candidates,
    conversation,
    ctx: buildCtx(),
    subject,
    classifyDeps,
  })
  stack = applySelection(stack, selection)

  // 2. the sandwich loop.
  let finalReply = ''
  let firstDrain = true
  for (let i = 0; i <= MAX_REINVOKES; i++) {
    const prepDeps = makeDeps(buildCtx())
    const prep: PrepareResult = await prepareTurn(stack, prepDeps)
    stack = prep.stack
    if (prep.kind === 'free-form' && prep.handoff) handedOff = true

    // 2a. write the active step (or clear it) BEFORE the drain.
    const dsPre = liveDomainState()
    dsPre[PROCEDURE_STEP_KEY] = await resolveActiveStepInput(prep, prepDeps)
    writeProcedureSlice(dsPre, stack)

    // 2b. drain — submitMessage opens the turn, continueTurn re-drains same-turn.
    const reply = await drain(
      firstDrain ? engine.submitMessage(inboundText, {}) : engine.continueTurn()
    )
    firstDrain = false
    if (reply.trim()) finalReply = reply

    // Free-form (no frame) → persona-only turn, nothing to interpret.
    if (prep.kind === 'free-form') break

    // 2c. interpret the control signal off the post-drain domainState, clear it,
    //     persist the cleared store + the mutated stack before any re-drain.
    const interpretCtx = buildCtx()
    const res = await interpretSignal(stack, reply, makeDeps(interpretCtx))
    stack = res.stack
    if (res.handoff) handedOff = true
    const dsPost = liveDomainState()
    if (interpretCtx.context instanceof KopilotContextStore) {
      syncContextSlice(dsPost, interpretCtx.context)
    }
    writeProcedureSlice(dsPost, stack)

    if (res.reinvoke) continue
    if (res.inlineFallback) {
      liveDomainState()[PROCEDURE_STEP_KEY] = undefined
      const extra = await drain(engine.continueTurn())
      if (extra.trim()) finalReply = extra
      break
    }
    break
  }

  writeProcedureSlice(liveDomainState(), stack)
  // Escalate once, after the loop, so the turn's closing reply is already computed
  // (the caller still delivers it — flipping the thread doesn't gate this send).
  if (handedOff) await args.onHandoff?.()
  return finalReply
}

/** Build the `ProcedureStepInput` for an inject result (else `undefined` → section drops out). */
async function resolveActiveStepInput(
  prep: PrepareResult,
  deps: StepperDeps
): Promise<ProcedureStepInput | undefined> {
  if (prep.kind !== 'inject') return undefined
  const frame = top(prep.stack)
  if (!frame) return undefined
  const version = await deps.readVersion(frame.procedureVersionId)
  if (!version) return undefined
  return buildActiveStepInput({
    activeStep: prep.activeStep,
    compiled: version.compiled,
    stack: prep.stack,
    breadcrumb: prep.breadcrumb,
    codeOutputs: prep.codeOutputs,
    codeErrors: prep.codeErrors,
  })
}
