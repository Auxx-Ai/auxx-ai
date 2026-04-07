// apps/web/src/components/kopilot/ui/messages/user-message.tsx

import type { KopilotMessage } from '../../stores/kopilot-store'
import { MessageActions } from './message-actions'

interface UserMessageProps {
  message: KopilotMessage
  onEdit?: () => void
  onRetry?: () => void
}

export function UserMessage({ message, onEdit, onRetry }: UserMessageProps) {
  return (
    <div className='group/message flex flex-col items-end gap-1'>
      <div
        className='bg-illustration text-muted-foreground max-w-4/5 ring-border-illustration shadow-black/6.5 ml-auto w-fit rounded-l-xl rounded-br rounded-tr-xl px-3 py-2 text-sm/5 shadow ring-1'
        dangerouslySetInnerHTML={{ __html: message.content }}
      />
      <MessageActions role='user' content={message.content} onEdit={onEdit} onRetry={onRetry} />
    </div>
  )
}
