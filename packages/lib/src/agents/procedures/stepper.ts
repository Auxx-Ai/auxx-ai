// packages/lib/src/agents/procedures/stepper.ts

import type { ToolContext } from '../../ai/agent-framework/tool-context'
import { evaluateConditions } from '../../conditions/evaluate'
import { buildCodeInputs, buildProcedurePredicateResolver, writeProcedureVar } from './context'
import { PROC_SIGNAL_KEY, type ProcedureSignal } from './control-tools'
import { buildReanchorBreadcrumb } from './re-anchor'
import { atDepthCap, clear, pop, push, replaceTop, top } from './stack'
import type {
  CompiledProcedure,
  ProcedureFrame,
  ProcedureStack,
  ProcedureStep,
  StepId,
} from './types'

/** The only step kind the stepper stops on / classifies against. */
type InstructionStep = Extract<ProcedureStep, { kind: 'instruction' }>

/** The silent-reply backstop verdict (mirror of `classifier.ts` `BackstopVerdict`). */
type BackstopVerdict = { onProcedure: boolean; multiTurn: boolean }

/**
 * The deterministic stepper — `prepareTurn` (this file) walks the top frame's
 * cursor through every DETERMINISTIC step (conditions → branch, routing → stack
 * op) until it reaches an `instruction` step to inject, or the stack empties
 * (free-form). `interpretSignal` (the post-turn half) lands in a later step.
 *
 * **Invariant: `prepareTurn` is pure navigation EXCEPT for `code` steps.** An
 * `instruction` step's inline `tool:` references are hints the MODEL acts on inside the
 * engine loop. A `code` step is the ONE deterministic side effect the stepper performs
 * (D1): it runs the block (a real Lambda call) and writes its outputs to `var:*`. This
 * is safe against the resume re-fire hazard because the stepper walks *through* a code
 * step (advances to `next`, never rests on it), so the cursor always rests on the next
 * `instruction`; on resume `prepareTurn` re-enters there, behind the code, and it does
 * NOT re-fire (plan §"Why deterministic"). A genuine graph loop back through the block
 * re-runs it (desired); a crash after the run but before cursor-persist gives
 * at-least-once on retry (same as the workflow code node). Aside from code outputs, the
 * only state it mutates is the cursor + the stack (pop/push/replace/clear from routing).
 *
 * The module is what Phase 4 calls; it does not touch the turn processor.
 * See plans/chat/v9/phase-3-stepper-and-stack.md §2.
 */

/** A loaded build keyed by procedureVersionId + the procedure it belongs to. */
type LoadedVersion = { procedureVersionId: string; compiled: CompiledProcedure }

export interface StepperDeps {
  /** Carries db / subject / context / appAccounts for resolution. */
  ctx: ToolContext
  /**
   * Load the PINNED version's compiled tree by id (the run reads the exact version
   * it started on — STACK #10). `null` = the pin was hard-deleted (shouldn't happen;
   * pinned versions are retention-protected) → the frame is discarded and recovery
   * re-advances the parent. Phase 4 backs this with `getProcedureVersionById` +
   * `readCompiled` (org-cache hit when the pin == the active version).
   */
  readVersion: (procedureVersionId: string) => Promise<{ compiled: CompiledProcedure } | null>
  /**
   * Resolve a standalone procedure's CURRENT active version (for a `switch`) and
   * pin it into the new frame. `null` = no resolvable active version → discard +
   * recover. Phase 4 backs this with the `agents` org-cache projection.
   */
  loadActiveVersion: (procedureId: string) => Promise<LoadedVersion | null>
  /**
   * Run Phase 1 selection over the agent's OTHER enabled procedures (digression).
   * Used by `interpretSignal`; declared here so the deps object is shared.
   */
  selectOther: (excludeProcedureId: string) => Promise<{
    procedureId: string
    procedureVersionId: string
    compiled: CompiledProcedure
  } | null>
  /**
   * Pick a `text`-mode condition arm by classifying the conversation against the
   * compiled predicate strings. Returns the matching case index, or `null` for the
   * else/fallthrough. Backed by `classifier.ts` `classifyTextBranch`; Phase 4 binds
   * the turn's conversation into this closure.
   */
  pickTextBranch: (predicates: string[]) => Promise<number | null>
  /**
   * Advance-check (#11) — verify the ONE irreversible signal before honoring it: did
   * the reply actually MEET the active step's goal? Backed by `classifier.ts`
   * `goalMetCheck`. Used by {@link interpretSignal} only.
   */
  checkGoalMet: (reply: string, activeStep: InstructionStep) => Promise<boolean>
  /**
   * Silent-reply backstop (#2) — when the model emitted no control tool, did the
   * reply stay on the active step? Backed by `classifier.ts` `backstopClassify`.
   */
  classifyBackstop: (reply: string, activeStep: InstructionStep) => Promise<BackstopVerdict>
  /**
   * Run a `code` step's block in the sandbox and return its result (D1). Injected so
   * the stepper stays free of `@auxx/services` — Phase 4 binds the `invokeLambdaExecutor`
   * adapter (`turn-wiring.ts`). A throw / timeout / runtime error resolves to
   * `{ ok: false, error }` (never rejects), so the stepper applies D5/D6 gate-by-absence.
   */
  runCode: (
    block: { code: string },
    codeInput: Record<string, unknown>
  ) => Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }>
}

/** A surfaced (`surfaceToModel`) code output the walk produced on its way to the landed step (D4). */
export type CodeOutputValue = { name: string; value: unknown }
/** A failed code step's note, surfaced to the model so it can cope honestly (D5). */
export type CodeErrorNote = { codeBlockId: string; error: string }

export type PrepareResult =
  | {
      kind: 'inject'
      stack: ProcedureStack
      activeStep: Extract<ProcedureStep, { kind: 'instruction' }>
      /** Re-anchor line when this turn resumed a parent after a `digression` pop (§5). */
      breadcrumb?: string
      /** `surfaceToModel` outputs computed by `code` steps walked this turn (D4). */
      codeOutputs?: CodeOutputValue[]
      /** Failure notes from `code` steps that threw/timed out this turn (D5). */
      codeErrors?: CodeErrorNote[]
    }
  /** Stack emptied / handoff cleared → persona-only, no procedure section this turn (#9). */
  | { kind: 'free-form'; stack: ProcedureStack; handoff?: boolean }

export interface InterpretResult {
  stack: ProcedureStack
  /** Re-run `prepareTurn` + the engine loop AGAIN this same turn (advance / digress goto 1 / end). */
  reinvoke: boolean
  /** Park: ship the reply and wait for the next customer message. */
  endTurn: boolean
  /** Re-run the loop WITHOUT a procedure section this turn (persona-only) and re-interpret (#9). */
  inlineFallback?: boolean
  /**
   * Escalate to a human — set by both handoff paths (routing `handoff` outcome in
   * `prepareTurn`, the `handoff_to_human` control tool in `interpretSignal`). The
   * caller flips the thread to the human queue; internal runs have no queue and
   * ignore it. The stack is already cleared. See plans/chat/v9 §6 reconciliation.
   */
  handoff?: boolean
}

/** Runaway guards — a valid compiled tree threads `next` acyclically, so these never trip. */
const MAX_FRAME_TRANSITIONS = 1000
const MAX_STEPS_PER_FRAME = 1000

/**
 * Advance the live stack to the next `instruction` step to inject, applying every
 * deterministic transition (condition branch, routing pop/handoff/switch/call) and
 * re-advancing the now-top frame after each stack op. Executes nothing.
 */
export async function prepareTurn(
  stack: ProcedureStack,
  deps: StepperDeps
): Promise<PrepareResult> {
  let working = stack
  // The most recent `digression` frame popped THIS turn — its parent gets a
  // re-anchor breadcrumb on the instruction we eventually inject (§5).
  let poppedDigression: ProcedureFrame | null = null
  // Accumulates code effects across EVERY frame walked this turn (a code step may sit in
  // a sub-procedure frame, its branch land in the parent) — surfaced on the inject result.
  const codeAcc: CodeAccumulator = { outputs: [], errors: [] }

  for (let i = 0; i < MAX_FRAME_TRANSITIONS; i++) {
    const frame = top(working)
    if (!frame) return { kind: 'free-form', stack: working }

    const version = await deps.readVersion(frame.procedureVersionId)
    if (!version) {
      // Hard-deleted pin → discard the frame, recover by re-advancing the parent.
      working = pop(working).stack
      continue
    }

    const action = await advanceFrame(frame, version.compiled, deps, codeAcc)

    switch (action.type) {
      case 'instruction': {
        const breadcrumb = poppedDigression
          ? buildReanchorBreadcrumb(action.step, poppedDigression) || undefined
          : undefined
        return {
          kind: 'inject',
          stack: working,
          activeStep: action.step,
          breadcrumb,
          ...(codeAcc.outputs.length > 0 ? { codeOutputs: codeAcc.outputs } : {}),
          ...(codeAcc.errors.length > 0 ? { codeErrors: codeAcc.errors } : {}),
        }
      }

      case 'pop': {
        const { stack: next, popped } = pop(working)
        working = next
        if (popped?.pushedBy === 'digression') poppedDigression = popped
        continue // re-advance the now-top (parent) at its parked cursor
      }

      case 'handoff':
        // Routing handoff leaves the agent — clear the stack, escalate to a human,
        // fall to persona-only for this turn's closing message.
        return { kind: 'free-form', stack: clear(working), handoff: true }

      case 'switch': {
        const target = await deps.loadActiveVersion(action.toProcedureId)
        if (!target) {
          working = pop(working).stack // unresolvable target → discard + recover
          continue
        }
        working = replaceTop(
          working,
          newFrame(
            action.toProcedureId,
            target.procedureVersionId,
            target.compiled.entryStepId,
            'switch'
          )
        )
        continue
      }

      case 'call': {
        const sub = version.compiled.subProcedures[action.subProcedureId]
        if (!sub) continue // unknown sub (the compiler guards this) → resume at parked cursor
        if (atDepthCap(working)) {
          // Depth-cap relief: run the sub-procedure INLINE in the current frame (no
          // push). The post-call continuation (`routing.next`, parked below) is lost
          // at the cap — an accepted edge at MAX_DEPTH (acceptance: "runs inline").
          frame.cursor = sub.entryStepId
          continue
        }
        working = push(
          working,
          newFrame(frame.procedureId, frame.procedureVersionId, sub.entryStepId, 'call')
        )
        continue
      }
    }
  }

  // Runaway guard tripped (malformed tree) — fail safe to persona-only.
  return { kind: 'free-form', stack: working }
}

/** What advancing one frame from its cursor resolved to. */
type FrameAction =
  | { type: 'instruction'; step: Extract<ProcedureStep, { kind: 'instruction' }> }
  | { type: 'pop' } // frame finished (terminal `finished`, dangling, or chain end)
  | { type: 'handoff' }
  | { type: 'switch'; toProcedureId: string }
  | { type: 'call'; subProcedureId: string }

/** Code effects collected as the stepper walks through `code` steps this turn. */
type CodeAccumulator = { outputs: CodeOutputValue[]; errors: CodeErrorNote[] }

/**
 * Walk one frame's cursor through deterministic steps until an `instruction` (stop)
 * or a terminal. Mutates `frame.cursor` in place (the stack is rehydrated per turn
 * and re-serialized after). For a `call`, parks `frame.cursor` at the routing step's
 * `next` so the parent resumes there when the child pops. A `code` step is RUN here
 * (the one side effect) and its results pushed into `codeAcc`.
 */
async function advanceFrame(
  frame: ProcedureFrame,
  compiled: CompiledProcedure,
  deps: StepperDeps,
  codeAcc: CodeAccumulator
): Promise<FrameAction> {
  const predicate = buildProcedurePredicateResolver(deps.ctx, frame)
  const entity = deps.ctx.subject ?? {}
  let cursor: StepId | null = frame.cursor

  for (let i = 0; i < MAX_STEPS_PER_FRAME; i++) {
    if (cursor === null) break
    const step = compiled.steps[cursor]
    if (!step) break // dangling ref → treat as finished

    if (step.kind === 'instruction') {
      frame.cursor = cursor
      return { type: 'instruction', step }
    }

    if (step.kind === 'code') {
      await runCodeStep(step, compiled, frame, deps, codeAcc)
      cursor = step.next // deterministic — always advance, never rest on the code step
      continue
    }

    if (step.kind === 'routing') {
      switch (step.outcome) {
        case 'finished':
          return { type: 'pop' }
        case 'handoff':
          return { type: 'handoff' }
        case 'switch':
          return { type: 'switch', toProcedureId: step.switchToProcedureId ?? '' }
        case 'call':
          frame.cursor = step.next // park the parent's return cursor
          return { type: 'call', subProcedureId: step.subProcedureId ?? '' }
      }
    }

    // condition — pick the branch (no LLM for structured; one classify for text)
    cursor = await pickConditionBranch(step, predicate, entity, deps)
  }

  frame.cursor = null
  return { type: 'pop' } // chain ended without a terminal → frame finished
}

/**
 * Resolve which step a `condition` descends to. `structured` evaluates each case's
 * `group` in order (first true wins) against the in-procedure resolver — pure reads,
 * idempotent. `text` asks the classifier which arm holds. Either falls through to
 * `elseStep ?? next`.
 */
async function pickConditionBranch(
  step: Extract<ProcedureStep, { kind: 'condition' }>,
  predicate: ReturnType<typeof buildProcedurePredicateResolver>,
  entity: unknown,
  deps: StepperDeps
): Promise<StepId | null> {
  if (step.mode === 'structured') {
    for (const branch of step.cases) {
      if (!branch.group) continue
      await predicate.prime([branch.group])
      if (evaluateConditions(entity, [branch.group], predicate.resolver)) return branch.thenStep
    }
    return step.elseStep ?? step.next
  }

  const idx = await deps.pickTextBranch(step.cases.map((c) => c.predicate ?? ''))
  if (idx !== null && idx >= 0 && idx < step.cases.length) return step.cases[idx]!.thenStep
  return step.elseStep ?? step.next
}

/**
 * Run a `code` step: build the ambient `inputs` bag via {@link buildCodeInputs} (every
 * declared local attribute read LIVE — a `var:*` written by an earlier code step is visible,
 * an unwritten one gates to `undefined`), invoke the sandbox, then apply D5/D6:
 *
 *  - **ok** → write each declared output to its scoped `var:*`; collect the
 *    `surfaceToModel` ones (skipping `undefined`, so we never claim a value was computed
 *    that wasn't).
 *  - **err** → CLEAR each declared output (`var:* = undefined`) and collect an error
 *    note. Clearing is load-bearing: `var:*` persists across turns, so on a loop re-run
 *    a stale prior-success value would otherwise survive and a downstream condition would
 *    branch on it instead of taking its else-arm. Clearing makes gate-by-absence (D6)
 *    actually hold on re-run, not just on first execution.
 */
async function runCodeStep(
  step: Extract<ProcedureStep, { kind: 'code' }>,
  compiled: CompiledProcedure,
  frame: ProcedureFrame,
  deps: StepperDeps,
  codeAcc: CodeAccumulator
): Promise<void> {
  const block = compiled.codeBlocks[step.codeBlockId]
  const clearOutputs = async (error: string) => {
    for (const output of step.outputs)
      await writeProcedureVar(deps.ctx, frame, output.name, undefined)
    codeAcc.errors.push({ codeBlockId: step.codeBlockId, error })
  }

  if (!block) {
    await clearOutputs(`code block "${step.codeBlockId}" not found`)
    return
  }

  const codeInput = await buildCodeInputs(deps.ctx, frame, compiled.localAttributes)
  const outcome = await deps.runCode({ code: block.code }, codeInput)
  if (!outcome.ok) {
    await clearOutputs(outcome.error)
    return
  }

  for (const output of step.outputs) {
    const value = outcome.result[output.name]
    await writeProcedureVar(deps.ctx, frame, output.name, value)
    if (output.surfaceToModel && value !== undefined)
      codeAcc.outputs.push({ name: output.name, value })
  }
}

/** A fresh running frame at `cursor`, pushed by `pushedBy`. */
function newFrame(
  procedureId: string,
  procedureVersionId: string,
  cursor: StepId | null,
  pushedBy: ProcedureFrame['pushedBy']
): ProcedureFrame {
  return { procedureId, procedureVersionId, cursor, status: 'running', history: [], pushedBy }
}

/**
 * Post-turn — read the recorded control signal, delete it, and mutate the stack
 * (STACK per-turn algorithm steps 2–3). This is the second half Phase 4 calls after
 * the engine loop; the `reply` is the model's customer-facing text this turn.
 *
 * The `reinvoke` vs `endTurn` split is the phase's subtlest point (STACK #8): a
 * proactive `digress` produced NO customer text, so the routed procedure opens
 * same-turn (`reinvoke`); the backstop off-procedure path already shipped a reply,
 * so a push opens NEXT turn (`endTurn`, no goto 1). `advance` is the only signal we
 * verify (#11) — it is the one irreversible cursor move; the rest self-correct.
 *
 * See plans/chat/v9/phase-3-stepper-and-stack.md §3.
 */
export async function interpretSignal(
  stack: ProcedureStack,
  reply: string,
  deps: StepperDeps
): Promise<InterpretResult> {
  const signal = (await deps.ctx.context.read(PROC_SIGNAL_KEY)) as ProcedureSignal | undefined
  // Turn-local key — `var:*` persists across turns, so delete it after reading.
  await deps.ctx.context.write(PROC_SIGNAL_KEY, undefined)

  const frame = top(stack)
  if (!frame) return { stack, reinvoke: false, endTurn: true } // no active frame → nothing to do

  const activeStep = await loadActiveInstruction(frame, deps)

  switch (signal?.kind) {
    case 'advance': {
      // Verify the irreversible signal; on `met` advance the cursor (goto 1), else
      // treat as `await` and stay on the step.
      if (activeStep && (await deps.checkGoalMet(reply, activeStep))) {
        frame.cursor = activeStep.next
        return { stack, reinvoke: true, endTurn: false }
      }
      frame.status = 'awaiting_customer'
      return { stack, reinvoke: false, endTurn: true }
    }

    case 'await':
      frame.status = 'awaiting_customer'
      return { stack, reinvoke: false, endTurn: true }

    case 'digress': {
      // Proactive: the model emitted no customer text; the routed procedure opens
      // THIS turn (reinvoke). At the depth cap, refuse the push → persona-only inline.
      if (atDepthCap(stack)) return { stack, reinvoke: false, endTurn: false, inlineFallback: true }
      const pick = await deps.selectOther(frame.procedureId)
      if (!pick) return { stack, reinvoke: false, endTurn: false, inlineFallback: true } // no match → one-off inline
      const pushed = push(
        stack,
        newFrame(pick.procedureId, pick.procedureVersionId, pick.compiled.entryStepId, 'digression')
      )
      return { stack: pushed, reinvoke: true, endTurn: false }
    }

    case 'handoff':
      return { stack: clear(stack), reinvoke: false, endTurn: true, handoff: true }

    case 'end':
      // Pop, resume parent at its parked cursor next prepareTurn. (A digression's
      // re-anchor breadcrumb only attaches on the deterministic `finished` pop — an
      // end-signal pop resumes correctly but without the "Back to…" line.)
      return { stack: pop(stack).stack, reinvoke: true, endTurn: false }

    default: {
      // SILENT reply — no control tool. The backstop (#2).
      if (!activeStep) {
        frame.status = 'awaiting_customer'
        return { stack, reinvoke: false, endTurn: true }
      }
      const verdict = await deps.classifyBackstop(reply, activeStep)
      if (verdict.onProcedure) {
        // Continued the step but forgot to signal → treat as await (self-corrects);
        // never auto-advance off a guess.
        frame.status = 'awaiting_customer'
        return { stack, reinvoke: false, endTurn: true }
      }
      // Off-procedure — the reply already shipped under the parent's step prompt. The
      // persona-only answer stands; push a frame ONLY if clearly multi-turn, opening
      // NEXT turn (no goto 1).
      if (verdict.multiTurn && !atDepthCap(stack)) {
        const pick = await deps.selectOther(frame.procedureId)
        if (pick) {
          const pushed = push(
            stack,
            newFrame(
              pick.procedureId,
              pick.procedureVersionId,
              pick.compiled.entryStepId,
              'digression'
            )
          )
          return { stack: pushed, reinvoke: false, endTurn: true }
        }
      }
      return { stack, reinvoke: false, endTurn: true }
    }
  }
}

/** Load the active step at a frame's cursor, narrowed to an `instruction` (else `undefined`). */
async function loadActiveInstruction(
  frame: ProcedureFrame,
  deps: StepperDeps
): Promise<InstructionStep | undefined> {
  if (frame.cursor === null) return undefined
  const version = await deps.readVersion(frame.procedureVersionId)
  const step = version?.compiled.steps[frame.cursor]
  return step?.kind === 'instruction' ? step : undefined
}
