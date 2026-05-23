// apps/chat-widget/src/views/conversation/welcome-bubble.tsx
//
// Synthetic first-bubble greeting rendered when a thread has zero real
// Messages. Plays a brief typing animation, then swaps in the rendered
// `welcomeMessageTemplate` (Tiptap doc) using the same walker as the Home
// greeting. Never persisted — lives in its own slot beside `messages`, never
// added to the messages array so mark-read / scroll-to-bottom / persistence
// side effects ignore it. The bubble unmounts the moment any real message
// arrives because the parent gates on `messages.length === 0`.

import { useEffect, useState } from 'preact/hooks'
import type { IdentifyPayload } from '~/identify'
import type { ChatConfig, TiptapNode } from '~/transport/config'
import { renderGreetingInline } from '../home/greeting'
import { Bubble, type BubbleAvatar } from './bubble'

interface WelcomeBubbleProps {
  agent: ChatConfig['agent']
  template: TiptapNode | null
  identify: IdentifyPayload | null
  /** Milliseconds the typing-dots animation shows before the bubble swaps in. */
  typingDelayMs?: number
}

export function WelcomeBubble({
  agent,
  template,
  identify,
  typingDelayMs = 900,
}: WelcomeBubbleProps) {
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setShowContent(true), typingDelayMs)
    return () => window.clearTimeout(t)
  }, [typingDelayMs])

  const avatar: BubbleAvatar | undefined = agent
    ? { name: agent.name, avatarUrl: agent.avatarUrl }
    : undefined

  if (!showContent) {
    return <Bubble sender='AGENT' avatar={avatar} typing />
  }

  return (
    <Bubble sender='AGENT' avatar={avatar}>
      <WelcomeContent agent={agent} template={template} identify={identify} />
    </Bubble>
  )
}

/**
 * Render the Tiptap welcome template using the shared Home greeting walker.
 * Falls back to a sensible default mentioning the configured agent (or org)
 * by name when no template is set.
 */
function WelcomeContent({
  agent,
  template,
  identify,
}: {
  agent: WelcomeBubbleProps['agent']
  template: TiptapNode | null
  identify: IdentifyPayload | null
}) {
  if (template) return <>{renderGreetingInline(template, identify)}</>
  const name = agent?.name ?? 'Support'
  return <>Hi there, you're speaking with {name}'s AI Agent. How can I help you today?</>
}
