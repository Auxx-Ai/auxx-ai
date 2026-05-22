// apps/chat-widget/src/views/conversation/system-line.tsx
//
// Centered, muted text rendered between message bubbles for thread lifecycle
// events (taken_over / returned_to_ai / archived / reopened / assignee changed
// / visitor identified).
//
// Renders visitor-facing copy only — P4.4 ships the functional surface; the
// polished admin/header treatment lives in Phase 4b.

import type { ThreadEvent } from '~/transport/thread-events'

interface SystemLineProps {
  event: ThreadEvent
}

export function SystemLine({ event }: SystemLineProps) {
  const text = visitorCopyFor(event)
  if (!text) return null
  const timestamp = new Date(event.createdAt).toLocaleString()
  return (
    <div
      className='self-center px-3 text-center text-xs italic text-muted-foreground'
      title={timestamp}>
      {text}
    </div>
  )
}

/**
 * Resolve visitor-facing copy for a thread event. Returning `null` hides the
 * event entirely (assignee churn, visitor-self-identified, etc.).
 */
function visitorCopyFor(event: ThreadEvent): string | null {
  switch (event.type) {
    case 'thread:taken_over':
      return 'An agent joined the chat'
    case 'thread:returned_to_ai':
      return 'AI is responding again'
    case 'thread:archived':
      return 'Chat ended'
    case 'thread:reopened':
      return 'Chat reopened'
    case 'thread:assignee:changed':
      // Pure internal triage churn — the visitor doesn't care which human is
      // the current row owner. The visible "agent joined" line comes from
      // `thread:taken_over` instead.
      return null
    case 'thread:visitor:identified':
      // The visitor performed this action themselves; surfacing it would be
      // noise. The admin-side view renders this one.
      return null
    default:
      return null
  }
}
