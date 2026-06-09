// apps/web/src/components/agents/ui/detail/setup/derive-setup-step.ts

import type { AgentDetail } from '../../../store/agent-store'

export type SetupStep = 'scoping' | 'capabilities' | 'behavior' | 'identity'

export interface SetupStepCopy {
  step: SetupStep
  title: string
  subtitle: string
  description: string
  /** True once this step's artifact exists on the agent. */
  done: boolean
}

export interface SetupProgress {
  /** All four steps, in order, each flagged done/not-done. */
  steps: SetupStepCopy[]
  /** The active step — lowest-index step that isn't done yet (or the last when all done). */
  current: SetupStepCopy
  /** 1-based index of `current`. 4 once everything is done. */
  index: 1 | 2 | 3 | 4
  /**
   * Completeness for the progress bar, in [0, 1]. Finished steps count fully;
   * the active step counts as half so the bar always shows motion — even on
   * step 1 before anything lands. Reaches exactly 1 only when all steps are done.
   */
  completeness: number
}

/** Partial credit the in-progress step contributes to the bar (so it's never empty). */
const IN_PROGRESS_CREDIT = 0.5

function isEmptyTiptapDoc(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return true
  const content = (doc as { content?: unknown[] }).content
  if (!content || !Array.isArray(content) || content.length === 0) return true
  if (content.length === 1) {
    const node = content[0] as { type?: string; content?: unknown[] }
    if (!node) return true
    // Empty Tiptap paragraph or empty KB-block placeholder.
    if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) return true
    if (node.type === 'block' && (!node.content || node.content.length === 0)) return true
  }
  return false
}

// Every agent is born with default toolsets (`source: 'auto_default'`, seeded by
// `createAgent` → `resolveDefaultToolsets`), so mere presence means nothing.
// Capabilities count as configured only once the builder deliberately picks
// toolsets — `set_agent_toolsets` inserts/promotes entries to `source: 'manual'`
// (and prompt `@[tool:…]` chips add `source: 'mention'`). Both are non-default.
const hasToolsets = (a: AgentDetail): boolean =>
  (a.toolsets ?? []).some((t) => t.source !== 'auto_default')
const hasPrompt = (a: AgentDetail): boolean => !isEmptyTiptapDoc(a.prompt)
const hasName = (a: AgentDetail): boolean => Boolean(a.name?.trim())

/** True once the builder has produced any deliverable — i.e. building has begun. */
const hasAnyArtifact = (a: AgentDetail): boolean => hasToolsets(a) || hasPrompt(a) || hasName(a)

/**
 * The four setup steps, in the order the builder persona authors them
 * (`agents-builder/persona-prompt.ts`): interview → toolsets → persona → identity.
 * Each step's `done` is a pure readout of the agent's current data, so the order
 * the builder *actually* writes fields in never matters.
 *
 * `scoping` has no durable artifact (the interview leaves nothing on the agent),
 * so it's "done" the moment any later artifact lands — i.e. it's the active phase
 * until building starts, then it's behind us.
 */
const STEP_DEFS: Array<{
  step: SetupStep
  title: string
  subtitle: string
  description: string
  isDone: (a: AgentDetail) => boolean
}> = [
  {
    step: 'scoping',
    title: 'Scoping',
    subtitle: 'Scoping the agent',
    description: 'Understanding your use case and goals.',
    isDone: hasAnyArtifact,
  },
  {
    step: 'capabilities',
    title: 'Capabilities',
    subtitle: 'Connecting capabilities',
    description: 'Wiring up the tools your agent can use.',
    isDone: hasToolsets,
  },
  {
    step: 'behavior',
    title: 'Behavior',
    subtitle: 'Defining behavior',
    description: "Writing the agent's instructions and persona.",
    isDone: hasPrompt,
  },
  {
    step: 'identity',
    title: 'Identity',
    subtitle: 'Adding identity',
    description: 'Finalizing the name and avatar.',
    isDone: hasName,
  },
]

/**
 * Derive the setup progress from the agent's current shape — monotonic and
 * order-independent. A step is `done` when its artifact exists; `current` is the
 * lowest-index step not yet done; `completeness` is `doneCount / 4`.
 */
export function deriveSetupProgress(agent: AgentDetail): SetupProgress {
  const steps: SetupStepCopy[] = STEP_DEFS.map((def) => ({
    step: def.step,
    title: def.title,
    subtitle: def.subtitle,
    description: def.description,
    done: def.isDone(agent),
  }))

  const doneCount = steps.filter((s) => s.done).length
  const firstUndone = steps.findIndex((s) => !s.done)
  const allDone = firstUndone === -1
  const currentIdx = allDone ? steps.length - 1 : firstUndone

  const completeness = (doneCount + (allDone ? 0 : IN_PROGRESS_CREDIT)) / steps.length

  return {
    steps,
    current: steps[currentIdx]!,
    index: (currentIdx + 1) as 1 | 2 | 3 | 4,
    completeness,
  }
}
