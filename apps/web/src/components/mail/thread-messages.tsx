// src/components/mail/thread-messages.tsx
'use client'

import React from 'react'
import EmailDisplay from './email-display'
import MessageDisplay from './message-display'
import { useThreadData, useThreadEmailActions } from './thread-provider'

/**
 * Display component for thread messages and tags
 */
export function ThreadMessages() {
  // Get data from context
  const { thread } = useThreadData()
  const messageActions = useThreadEmailActions()

  if (!thread) return null

  const messages = thread.messages
  return (
    <div className="flex flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col space-y-4">
        {/* Show proposed actions at the top if any exist */}
        {/* {proposedActions && proposedActions.items.length > 0 && (
          <div className="px-4">
            <ProposedActionInline
              actions={proposedActions.items}
              onApprove={handleApprove}
              onReject={handleReject}
              processingIds={[
                ...(approveMutation.variables ? [approveMutation.variables.id] : []),
                ...(rejectMutation.variables ? [rejectMutation.variables.id] : []),
              ]}
            />
          </div>
        )} */}

        {/* Email messages */}
        <div className="flex flex-col gap-4 px-4 py-2">
          {messages?.map((message: any, index: number) => {
            // Check if this is the last message in the array
            const isLastMessage = index === messages.length - 1

            // Note: messageType computed from integration.provider at message level
            switch (message.messageType) {
              case 'EMAIL':
                return (
                  <EmailDisplay
                    key={message.id}
                    message={message}
                    messageActions={messageActions}
                    isOpen={isLastMessage}
                  />
                )
              default:
                return (
                  <MessageDisplay
                    key={message.id}
                    message={message}
                    messageActions={messageActions}
                    isOpen={isLastMessage}
                  />
                )
            }
          })}
        </div>
      </div>
    </div>
  )
}
