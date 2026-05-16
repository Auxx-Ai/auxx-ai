// apps/web/src/components/agents/ui/detail/setup/derive-setup-step.ts

import type { AgentDetail } from '../../../store/agent-store'

export type SetupStep = 'alignment' | 'onboarding' | 'personalization'

export interface SetupCopy {
  step: SetupStep
  index: 1 | 2 | 3
  title: string
  subtitle: string
  description: string
}

const COPY: Record<SetupStep, SetupCopy> = {
  alignment: {
    step: 'alignment',
    index: 1,
    title: 'Alignment',
    subtitle: 'Agent Alignment',
    description: 'Learning about your use case and setting objectives.',
  },
  onboarding: {
    step: 'onboarding',
    index: 2,
    title: 'Onboarding',
    subtitle: 'Agent Onboarding',
    description: 'Wiring up toolsets, knowledge, and the persona prompt.',
  },
  personalization: {
    step: 'personalization',
    index: 3,
    title: 'Personalization',
    subtitle: 'Agent Personalization',
    description: 'Finalizing name, avatar, and tone.',
  },
}

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

/**
 * Derive the current setup step from agent shape. Mirrors the persona's
 * three phases (alignment → onboarding → personalization) — the prompt and
 * toolsets are the Onboarding deliverable, the name is the Personalization
 * deliverable.
 */
export function deriveSetupStep(agent: AgentDetail): SetupCopy {
  if (isEmptyTiptapDoc(agent.prompt) || (agent.toolsets ?? []).length === 0) {
    return COPY.alignment
  }
  if (!agent.name || agent.name.trim() === '') return COPY.onboarding
  return COPY.personalization
}

/**
 * Completeness score for the progress strip — 0..1.
 * `(promptScore + toolsetScore + nameScore) / 3`, each in [0, 1].
 */
export function computeCompleteness(agent: AgentDetail): number {
  const promptScore = isEmptyTiptapDoc(agent.prompt) ? 0 : 1
  const toolsetScore = Math.min(1, (agent.toolsets?.length ?? 0) / 1)
  const nameScore = agent.name ? 1 : 0
  return (promptScore + toolsetScore + nameScore) / 3
}
