// packages/lib/src/agents/procedures/select.ts

import type { Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import { evaluateConditions } from '../../conditions/evaluate'
import type { ConditionGroup } from '../../conditions/types'
import { type ClassifyDeps, type ConversationMessage, classifyProcedure } from './classify'
import { buildProcedureFieldResolver } from './context'
import type { AgentProcedureEntity, ProcedureEntity, ProcedureVersionEntity } from './queries'
import { top } from './stack'
import type { CompiledProcedure, ProcedureFrame, ProcedureStack, TriggerExample } from './types'

/**
 * Selection — the layer that decides *which* procedure (if any) runs this turn and
 * hands back **frame 0** of the `ProcedureStack`. Composition: sticky resume →
 * zero-procedure short-circuit → deterministic ruleset pre-filter → ONE classifier
 * call → frame 0. This is the function Phase 4 calls between engine construction and
 * `submitMessage`, and the SAME function Phase 3 re-runs for digression (over the
 * other procedures via `excludeProcedureIds`).
 *
 * No runtime path is touched here — the turn-processor wiring is Phase 4.
 */

export type SelectionResult =
  | { kind: 'resume'; frame: ProcedureFrame } // sticky — top frame still running
  | { kind: 'selected'; frame: ProcedureFrame } // a fresh frame 0
  | { kind: 'none' } // free-form persona mode (today's behavior)

/**
 * One agent↔procedure LINK resolved for selection. Phase 4 builds these from the
 * `agents` org-cache projection; Phase 1 can read them via the Phase 0 `queries.ts`
 * (`listAgentProcedures` + `getProcedureById` + `getProcedureVersionById`) as a
 * stand-in — `ResolvedCandidate[]` is the stable seam, so the swap is one line in the
 * caller. `resolved` is `link.*Override ?? activeVersion.<field>` for each trigger
 * field — the criteria DEFAULTS are read off the ACTIVE VERSION's snapshot (the
 * versioned model), NOT the mutable procedure row, so unpublished edits never reach
 * a live run.
 */
export interface ResolvedCandidate {
  link: AgentProcedureEntity // enabled, priority, *Override fields
  procedure: ProcedureEntity // id + activeVersionId (criteria DEFAULTS come from activeVersion)
  activeVersion: ProcedureVersionEntity & { compiled: CompiledProcedure } // pinned build + criteria snapshot
  resolved: {
    whenToUse: string
    triggerExamples: TriggerExample[]
    ruleset: ConditionGroup[]
  }
}

export interface SelectProcedureArgs {
  stack: ProcedureStack
  candidates: ResolvedCandidate[]
  conversation: ConversationMessage[]
  ctx: ToolContext
  subject: Subject // turn's anchors (empty-anchors for internal runs)
  classifyDeps: Omit<ClassifyDeps, 'db'> // model/provider/org/user resolved by caller
  /** Phase 3 digression: exclude procedures already on the live stack. Defaults to []. */
  excludeProcedureIds?: string[]
}

export async function selectProcedure(args: SelectProcedureArgs): Promise<SelectionResult> {
  const { stack, candidates, conversation, ctx, subject, excludeProcedureIds = [] } = args

  // 0. STICKY: an active, unfinished top frame resumes — selection does NOT run, no
  //    classifier call. (Phase 3 digression bypasses this with an exclude-set.)
  const t = top(stack)
  if (t && t.status !== 'finished') return { kind: 'resume', frame: t }

  // 1. Zero-procedure short-circuit — NO LLM call, no regression for today's agents.
  const usable = candidates.filter(
    (c) =>
      c.link.enabled &&
      c.resolved.whenToUse.trim() !== '' && // empty whenToUse = nothing for the classifier to reason about
      !excludeProcedureIds.includes(c.procedure.id)
  )
  if (usable.length === 0) return { kind: 'none' }

  // 2. DETERMINISTIC ruleset pre-filter (cheap, before any LLM) over the RESOLVED
  //    ruleset. `[]` groups match all (`evaluateConditions` empty = true).
  const allGroups = usable.flatMap((c) => c.resolved.ruleset)
  const resolver = await buildProcedureFieldResolver(ctx, subject, allGroups)
  const survivors = usable
    .filter((c) => evaluateConditions(subject, c.resolved.ruleset, resolver))
    .sort((a, b) => b.link.priority - a.link.priority)
  if (survivors.length === 0) return { kind: 'none' }

  // 3. ONE classifier call among survivors (few-shot use/avoid) over the RESOLVED
  //    whenToUse/examples.
  const { id } = await classifyProcedure(
    conversation,
    survivors.map((c) => ({
      id: c.procedure.id,
      whenToUse: c.resolved.whenToUse,
      triggerExamples: c.resolved.triggerExamples,
    })),
    { ...args.classifyDeps, db: ctx.db }
  )
  if (!id) return { kind: 'none' }

  // 4. Build FRAME 0 — PIN the active version (the run reads this exact version
  //    throughout). A one-step compiled build is a valid frame 0 (whole-procedure-as-
  //    text fallback) — selection makes no multi-step assumption.
  const chosen = survivors.find((c) => c.procedure.id === id)
  if (!chosen) return { kind: 'none' }
  const frame: ProcedureFrame = {
    procedureId: chosen.procedure.id,
    procedureVersionId: chosen.activeVersion.id,
    cursor: chosen.activeVersion.compiled.entryStepId,
    status: 'running',
    history: [],
    pushedBy: 'selection',
  }
  return { kind: 'selected', frame }
}
