// --- Chat Message Bubble Component ---

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { AlertCircle, Loader2 } from 'lucide-react'
import React from 'react'
import type { ChatMessageType } from './chat-interface'

export const ChatMessageBubble = ({
  message,
  currentAgentId,
}: {
  message: ChatMessageType
  currentAgentId?: string
}) => {
  const isUser = message.sender === 'USER'
  const isAgent = message.sender === 'AGENT'
  const isSystem = message.sender === 'SYSTEM'
  // Determine if the message is from the *current* agent viewing the interface
  const isOwnAgentMessage = isAgent && message.agentId === currentAgentId

  // Use agent details from the message if available, otherwise fallback
  const agentName = message?.agent?.name ?? 'Agent'
  const agentAvatar = message?.agent?.image ?? undefined
  const agentInitials = agentName?.substring(0, 1).toUpperCase() ?? 'A'

  return (
    <div
      className={cn(
        'mb-3 flex items-end', // Use items-end for better alignment with avatar
        isUser ? 'justify-start' : 'justify-end',
        isOwnAgentMessage && 'justify-end' // Align own agent messages to the right
      )}>
      {/* Avatar for User (on right) or Other Agent (on left) */}
      {!isSystem &&
        (isUser || isOwnAgentMessage) && ( // Show avatar on right for user and own agent messages
          <Avatar className='order-2 ml-2 h-6 w-6 shrink-0'>
            <AvatarImage src={isUser ? undefined : (agentAvatar ?? undefined)} />
            <AvatarFallback className='text-xs'>{isUser ? 'U' : agentInitials}</AvatarFallback>
          </Avatar>
        )}
      {!isSystem &&
        !isUser &&
        !isOwnAgentMessage && ( // Show avatar on left for other agents/system
          <Avatar className='order-1 mr-2 h-6 w-6 shrink-0'>
            <AvatarImage src={agentAvatar ?? undefined} />
            <AvatarFallback className='text-xs'>{agentInitials}</AvatarFallback>
          </Avatar>
        )}

      {/* Message Content */}
      <div
        className={cn(
          'max-w-[75%] rounded-lg p-2 px-3 shadow-xs', // Add subtle shadow
          isUser
            ? 'order-2 rounded-bl-none bg-blue-100 dark:bg-blue-900/80' // User bubble style
            : isOwnAgentMessage
              ? 'order-1 rounded-br-none bg-muted' // Own agent bubble style
              : isSystem
                ? 'order-1 mx-auto w-full max-w-full bg-amber-100 text-center text-xs italic text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                : 'order-2 rounded-bl-none bg-muted', // Other agent bubble style
          isSystem && 'max-w-full!' // Allow system messages to take full width
        )}>
        <p className='whitespace-pre-wrap text-sm'>{message.content}</p>
        {/* Optionally add timestamp or status */}
        <span className='block pt-1 text-right text-xs text-muted-foreground/70 opacity-80'>
          {format(new Date(message.createdAt), 'p')} {/* Ensure timestamp is a Date object */}
          {message.status === 'sending' && <Loader2 className='ml-1 inline h-3 w-3 animate-spin' />}
          {message.status === 'error' && (
            <AlertCircle className='ml-1 inline h-3 w-3 text-destructive' />
          )}
        </span>
      </div>
    </div>
  )
}
