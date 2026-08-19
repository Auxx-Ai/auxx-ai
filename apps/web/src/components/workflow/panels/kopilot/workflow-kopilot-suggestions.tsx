// apps/web/src/components/workflow/panels/kopilot/workflow-kopilot-suggestions.tsx
'use client'

import { useStore } from '@xyflow/react'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'

/**
 * Empty-chat suggestions for the workflow builder panel.
 *
 * Registration is all-or-nothing in `KopilotEmptyState`: the moment ANY slice
 * is registered the generic fallback list ("Summarize my open tickets", …)
 * disappears. That is why both branches below register something — a builder
 * chat must never offer inbox prompts.
 *
 * Mounted inside the panel (not the editor) so the slices unregister with the
 * frame, and only while a workflow is actually loaded.
 */
export function WorkflowKopilotSuggestions() {
  // React Flow is the only owner of the node list — the workflow store cannot
  // reach it. A `.length` selector returns a primitive, so the subscription
  // only re-renders on add/remove, not on every drag.
  const nodeCount = useStore((s) => s.nodes.length)

  // A fresh workflow is either empty or a lone seeded trigger — nothing to
  // explain yet, so offer build prompts instead of audit prompts.
  const isBlank = nodeCount <= 1

  if (isBlank) {
    return (
      <>
        <KopilotSuggestion
          text='Build a workflow that tags new tickets by topic'
          icon='workflow'
          priority={3}
          autoSubmit
        />
        <KopilotSuggestion
          text='Send a Slack alert when a high-priority ticket arrives'
          icon='sparkle'
          priority={2}
          autoSubmit
        />
        <KopilotSuggestion
          text='Add a trigger for when a record is created'
          icon='plus'
          priority={1}
          autoSubmit
        />
        <KopilotSuggestion text='What can you build in a workflow?' icon='list' autoSubmit />
      </>
    )
  }

  return (
    <>
      <KopilotSuggestion
        text='Explain what this workflow does'
        icon='sparkle'
        priority={3}
        autoSubmit
      />
      <KopilotSuggestion
        text='Find problems in this workflow'
        icon='search'
        priority={2}
        autoSubmit
      />
      <KopilotSuggestion text='Add an error branch to this workflow' icon='plus' priority={1} />
      <KopilotSuggestion text='Add a condition after the trigger' icon='workflow' />
    </>
  )
}
