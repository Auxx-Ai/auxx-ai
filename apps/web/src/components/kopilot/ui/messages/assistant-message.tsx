// apps/web/src/components/kopilot/ui/messages/assistant-message.tsx

import { Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { KopilotMessage, ThinkingGroup } from '../../stores/kopilot-store'
import { useKopilotStore } from '../../stores/kopilot-store'
import { AuxxBlock } from '../blocks/auxx-block'
import { MessageActions } from './message-actions'
import { ToolStatusPills } from './tool-status-pills'

interface AssistantMessageProps {
  message?: KopilotMessage
  /** When streaming, render this content instead of message.content */
  streamingContent?: string
  onThumbsUp?: () => void
  onThumbsDown?: () => void
  feedback?: { isPositive: boolean }
}

export function AssistantMessage({
  message,
  streamingContent,
  onThumbsUp,
  onThumbsDown,
  feedback,
}: AssistantMessageProps) {
  const isStreaming = streamingContent !== undefined
  const content = isStreaming ? streamingContent : (message?.content ?? '')

  const thinkingGroups = useKopilotStore((s) => s.thinkingGroups)
  const activeThinkingGroupId = useKopilotStore((s) => s.activeThinkingGroupId)

  // Find the thinking group attached to this message
  const thinkingGroup = message?.id
    ? Object.values(thinkingGroups).find((g) => g.messageId === message.id)
    : undefined
  // While streaming (no message yet), show the active thinking group
  const activeGroup =
    streamingContent !== undefined && activeThinkingGroupId
      ? thinkingGroups[activeThinkingGroupId]
      : undefined
  const group: ThinkingGroup | undefined = thinkingGroup ?? activeGroup

  // Memoize components so react-markdown can reconcile without remounting blocks
  const markdownComponents = useMemo(
    () => ({
      pre({ children }: { children?: React.ReactNode }) {
        return <>{children}</>
      },
      code({ className, children }: { className?: string; children?: React.ReactNode }) {
        const match = className?.match(/^language-auxx:(.+)$/)
        if (match) {
          return <AuxxBlock type={match[1]} rawContent={String(children).trim()} />
        }
        return (
          <pre>
            <code className={className}>{children}</code>
          </pre>
        )
      },
    }),
    []
  )

  return (
    <div className='group/message flex gap-2'>
      <div className='animate-hue-rotate relative size-fit'>
        <div className='bg-conic/decreasing relative flex size-5 items-center justify-center rounded-full from-violet-500 via-lime-300 to-violet-400 blur-md' />
        <div className='absolute inset-0 flex items-center justify-center'>
          <Sparkles className='size-3.5' />
        </div>
      </div>
      <div className='min-w-0 flex-1 space-y-1'>
        {group && group.steps.length > 0 && <ToolStatusPills group={group} />}
        <div className='prose prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 max-w-none text-sm dark:prose-invert'>
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {isStreaming ? `${content}\u258C` : content}
          </Markdown>
        </div>
        {!isStreaming && message && (
          <MessageActions
            role='assistant'
            content={content}
            feedback={feedback}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
          />
        )}
      </div>
    </div>
  )
}
