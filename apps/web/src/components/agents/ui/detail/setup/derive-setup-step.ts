// apps/web/src/components/agents/ui/detail/setup/derive-setup-step.ts

import type { AgentDetail } from '../../../store/agent-store'

export type SetupStep = 'alignment' | 'personalization' | 'onboarding'

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
  personalization: {
    step: 'personalization',
    index: 2,
    title: 'Personalization',
    subtitle: 'Agent Personalization',
    description: 'Tailoring capabilities to fit your needs.',
  },
  onboarding: {
    step: 'onboarding',
    index: 3,
    title: 'Onboarding',
    subtitle: 'Agent Onboarding',
    description: 'Finalizing setup and preparing to assist you.',
  },
}

function isEmptyTiptapDoc(doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc) return true
  const content = (doc as { content?: unknown[] }).content
  if (!content || !Array.isArray(content) || content.length === 0) return true
  // A Tiptap "doc" with a single empty paragraph is also "empty".
  if (content.length === 1) {
    const node = content[0] as { type?: string; content?: unknown[] }
    if (node?.type === 'paragraph' && (!node.content || node.content.length === 0)) return true
  }
  return false
}

/**
 * Derive the current setup step from agent shape. The builder persona's three
 * phases (alignment → personalization → onboarding) line up with prompt /
 * toolsets / wrap-up, so derivation works without a sync channel.
 */
export function deriveSetupStep(agent: AgentDetail): SetupCopy {
  if (isEmptyTiptapDoc(agent.prompt)) return COPY.alignment
  if ((agent.toolsets ?? []).length === 0) return COPY.personalization
  return COPY.onboarding
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
