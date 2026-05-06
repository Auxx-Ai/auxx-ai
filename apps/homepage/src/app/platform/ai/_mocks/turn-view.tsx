// apps/homepage/src/app/platform/ai/_mocks/turn-view.tsx

'use client'

import type { ReactNode } from 'react'
import { MockAssistantSlot } from './mock-assistant-message'
import {
  MockDraftApprovalCard,
  MockEntityListBlock,
  MockPlanStepsBlock,
  MockThreadListBlock,
} from './mock-blocks'
import { MockUserMessage } from './mock-user-message'
import type { ScriptBlock, TurnState } from './use-kopilot-story'

/**
 * Renders a single Kopilot story turn — user bubble + assistant slot
 * (thinking + blocks + streamed assistant content). Shared by
 * `MockKopilotWindow` (hero) and `MockKopilotPromptStory` (personas).
 */
export function TurnView({ turn }: { turn: TurnState }) {
  const hasAssistantSlot = !!turn.thinking || turn.blocks.length > 0 || turn.assistant.length > 0

  return (
    <div className='flex flex-col gap-3'>
      <MockUserMessage text={turn.user} />
      {hasAssistantSlot && (
        <MockAssistantSlot
          thinking={turn.thinking}
          blocks={renderBlocks(turn.blocks)}
          content={turn.assistant}
          streaming={!turn.settled && turn.assistant.length > 0}
        />
      )}
    </div>
  )
}

export function renderBlocks(blocks: ScriptBlock[]): ReactNode {
  if (!blocks.length) return null
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'thread-list':
        return <MockThreadListBlock key={i} rows={b.rows} />
      case 'entity-list':
        return <MockEntityListBlock key={i} title={b.title} rows={b.rows} />
      case 'plan-steps':
        return <MockPlanStepsBlock key={i} steps={b.steps} />
      case 'draft-approval':
        return (
          <MockDraftApprovalCard
            key={i}
            recipient={b.recipient}
            subject={b.subject}
            body={b.body}
          />
        )
    }
  })
}
