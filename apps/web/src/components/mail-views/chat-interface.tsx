// ~/components/mail/chat-interface.tsx
'use client'
import { getPusherClient } from '@auxx/lib/realtime/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import {
  AlertCircle,
  Archive,
  CircleCheck,
  Loader2,
  Paperclip,
  SendHorizonal,
  Settings2,
  User,
} from 'lucide-react'
import type { Channel } from 'pusher-js' // Import Pusher types
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { ChatMessageBubble } from './chat-message-bubble'

// --- Define Types (Align with chat-service.ts and API responses) ---
// Consider centralizing these types if used elsewhere
interface AgentInfo {
  id: string
  name?: string | null
  image?: string | null
}
export interface ChatMessageType {
  id: string
  sessionId: string
  threadId: string
  content: string
  sender: 'USER' | 'AGENT' | 'SYSTEM'
  createdAt: Date | string // Handle potential string dates from API
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error'
  agent?: AgentInfo
  agentId?: string | null
}
interface ChatInterfaceProps {
  threadId: string
  centered?: boolean
}
// --- Main Chat Interface Component ---
export default function ChatInterface({ threadId, centered }: ChatInterfaceProps) {
  const { pusher: pusherEnv } = useEnv()
  const [newMessage, setNewMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isUserTyping, setIsUserTyping] = useState(false)
  // const [isAgentTyping, setIsAgentTyping] = useState(false)
  const agentTypingTimerRef = useRef<NodeJS.Timeout | null>(null)
  // const sendAgentTypingState = api.chat.setAgentTyping.useMutation({
  //   onError: (error) => {
  //     console.error('Failed to send typing state:', error)
  //   },
  // })
  // --- Refs for Scrolling ---
  const scrollAreaRef = useRef<HTMLDivElement>(null) // Ref for the ScrollArea component
  const messagesEndRef = useRef<HTMLDivElement>(null) // Ref for the end of messages div for scrolling
  const scrollHeightBeforeRef = useRef<number | null>(null) // Store scrollHeight before loading older
  const scrollTopBeforeRef = useRef<number | null>(null) // Store scrollTop before loading older
  const initialScrollDoneRef = useRef<boolean>(false) // Track if initial scroll happened
  // --- End Refs ---
  const { data: agentSession } = useSession() // Get current agent session
  const agentId = agentSession?.user?.id
  const utils = api.useUtils() // Get tRPC utils for cache invalidation

  const {
    data: sessionData, // This is the *ChatSession* data
    isLoading: isLoadingSession,
    error: sessionError,
  } = api.thread.getChatSessionByThreadId.useQuery(
    { threadId },
    { staleTime: 5 * 60 * 1000, enabled: !!threadId, refetchOnWindowFocus: false }
  )
  // Derive the visitor's sessionId from the fetched sessionData
  const visitorSessionId = sessionData?.id
  const {
    data: messagePages,
    isLoading: isLoadingMessages,
    error: messagesError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.thread.getChatMessages.useInfiniteQuery(
    { threadId, limit: 30 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 1 * 60 * 1000,
      enabled: !!threadId,
      refetchOnWindowFocus: false,
    }
  )
  // const debouncedTypingHandler = useCallback(
  //   debounce((isTyping: boolean) => {
  //     if (!visitorSessionId || !threadId) return
  //     console.log('debounced')
  //     sendAgentTypingState.mutate({ sessionId: visitorSessionId, isTyping })
  //   }, 300),
  //   [visitorSessionId, threadId, sendAgentTypingState]
  // )
  // --- Scrolling Utilities ---
  const isScrolledToBottom = useCallback(() => {
    const scrollContainer = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    )
    if (!scrollContainer) return true // Assume at bottom if viewport isn't ready
    // Consider user "at bottom" if they are within ~100px of it
    const threshold = 100
    return (
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <=
      threshold
    )
  }, [])
  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    const scrollContainer = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    )
    if (scrollContainer) {
      console.log(
        `Scrolling to bottom (scrollHeight: ${scrollContainer.scrollHeight}, behavior: ${behavior})`
      )
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior })
    } else {
      // Fallback to using the ref to the end of messages
      messagesEndRef.current?.scrollIntoView({ behavior })
    }
  }, [])
  // --- Process Fetched Messages & Handle Scrolling ---
  useEffect(() => {
    if (messagePages) {
      const combinedMessages = messagePages.pages
        .flatMap((page) => page.items)
        // Ensure messages are sorted chronologically (oldest first for display)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      setMessages(combinedMessages)
      const scrollContainer = scrollAreaRef.current?.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (!scrollContainer) return
      // Use a microtask (Promise.resolve) to allow DOM to update heights before calculating scroll
      Promise.resolve().then(() => {
        const currentScrollHeight = scrollContainer.scrollHeight // Get current height *after* DOM update
        if (scrollHeightBeforeRef.current !== null && scrollTopBeforeRef.current !== null) {
          // --- Maintain scroll position after loading older messages ---
          const heightAdded = currentScrollHeight - scrollHeightBeforeRef.current
          const newScrollTop = scrollTopBeforeRef.current + heightAdded
          console.log(
            `Loaded older messages. Height added: ${heightAdded}. Restoring scroll top to: ${newScrollTop}.`
          )
          scrollContainer.scrollTop = newScrollTop
          // Reset refs
          scrollHeightBeforeRef.current = null
          scrollTopBeforeRef.current = null
        } else if (!initialScrollDoneRef.current && combinedMessages.length > 0) {
          // --- Initial Scroll (only if messages exist) ---
          console.log('Performing initial scroll to bottom.')
          scrollToBottom('auto')
          initialScrollDoneRef.current = true
        }
      })
    }
  }, [messagePages, scrollToBottom]) // Rerun when messagePages data changes
  // --- Pusher Real-time Connection ---
  useEffect(() => {
    if (!visitorSessionId) {
      return // Don't setup Pusher until we have the session ID
    }
    const pusherClient = getPusherClient(pusherEnv.key, pusherEnv.cluster)
    let channel: Channel | null = null
    if (pusherClient) {
      const channelName = `private-chat-${visitorSessionId}`
      channel = pusherClient.subscribe(channelName)
      channel.bind('pusher:subscription_succeeded', () => {
        console.log(`ChatInterface: Successfully subscribed to Pusher channel: ${channelName}`)
      })
      channel.bind('pusher:subscription_error', (error: any) => {
        console.error(`ChatInterface: Pusher subscription error for channel ${channelName}:`, error)
        toastError({
          title: 'Real-time connection error',
          description: `Failed to subscribe to chat updates (${error.status})`,
        })
      })
      // Listen for new messages (from user or *other* agents)
      channel.bind('new-message', (newMessage: ChatMessageType) => {
        console.log('ChatInterface: Received new message via Pusher:', newMessage)
        const wasAtBottom = isScrolledToBottom() // Check BEFORE updating state
        setMessages((prevMessages) => {
          // Avoid adding duplicates
          if (prevMessages.some((msg) => msg.id === newMessage.id)) {
            return prevMessages
          }
          newMessage.createdAt = new Date(newMessage.createdAt) // Ensure date object
          return [...prevMessages, newMessage]
        })
        // Only auto-scroll if user was already near the bottom
        if (wasAtBottom) {
          // Use timeout to allow DOM update before scrolling
          setTimeout(() => scrollToBottom('smooth'), 50)
        }
      })
      // Listen for user typing events
      channel.bind('typing', (typingData: { sender: string; isTyping: boolean }) => {
        console.log('ChatInterface: Received typing event:', typingData)
        if (typingData.sender === 'USER') {
          setIsUserTyping(typingData.isTyping)
        }
      })
      // Listen for session closed event
      channel.bind(
        'session-closed',
        (data: {
          closedBy: {
            id: string
            name: string
          }
        }) => {
          toastSuccess({ description: `Chat closed by ${data.closedBy?.name ?? 'agent'}` })
          utils.thread.getChatSessionByThreadId.invalidate({ threadId })
        }
      )
      // Listen for message sending errors
      channel.bind('message-error', (errorData: { clientMessageId: string; error: string }) => {
        console.warn('ChatInterface: Received message-error event:', errorData)
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === errorData.clientMessageId ? { ...msg, status: 'error' } : msg
          )
        )
        toastError({ title: 'Message Failed', description: errorData.error })
      })
    } else {
      console.warn('ChatInterface: Pusher client not initialized.')
      toastError({ title: 'Real-time Error', description: 'Cannot connect for real-time updates.' })
    }
    // Cleanup function
    return () => {
      if (channel && pusherClient) {
        const channelName = `private-chat-${visitorSessionId}`
        console.log(`ChatInterface: Unsubscribing from Pusher channel: ${channelName}`)
        channel.unbind_all() // Unbind all listeners for this channel instance
        pusherClient.unsubscribe(channelName)
      }
    }
  }, [
    visitorSessionId,
    threadId,
    utils,
    scrollToBottom,
    isScrolledToBottom,
    pusherEnv.key,
    pusherEnv.cluster,
  ])
  const sendMessageMutation = api.chat.sendAgentMessage.useMutation({
    onMutate: () => {
      setIsSending(true)
    },
    onSuccess: (data) => {
      console.log('Agent message sent successfully (backend):', data)
      // Rely on Pusher 'new-message' event for UI update
    },
    onError: (error) => {
      console.error('Failed to send agent message:', error)
      toastError({ title: 'Send Error', description: error.message })
    },
    onSettled: () => {
      setIsSending(false)
    },
  })
  const closeSessionMutation = api.chat.closeSession.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Chat session closed.' })
      utils.thread.getChatSessionByThreadId.invalidate({ threadId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to close chat', description: error.message })
    },
  })
  // --- Actions ---
  const handleSendMessage = useCallback(() => {
    const content = newMessage.trim()
    if (!content || !visitorSessionId || !threadId || sendMessageMutation.isPending) return
    // Scroll immediately when agent sends
    scrollToBottom('smooth')
    sendMessageMutation.mutate({
      sessionId: visitorSessionId,
      threadId: threadId,
      content: content,
    })
    setNewMessage('') // Clear input immediately
  }, [newMessage, visitorSessionId, threadId, sendMessageMutation, scrollToBottom])
  const handleResolveChat = useCallback(() => {
    if (!visitorSessionId || closeSessionMutation.isPending) return
    closeSessionMutation.mutate({ sessionId: visitorSessionId })
  }, [visitorSessionId, closeSessionMutation])
  const handleLoadOlder = useCallback(() => {
    const scrollContainer = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    )
    if (scrollContainer && hasNextPage && !isFetchingNextPage) {
      // Store scroll state BEFORE fetching
      scrollHeightBeforeRef.current = scrollContainer.scrollHeight
      scrollTopBeforeRef.current = scrollContainer.scrollTop
      console.log(
        `Loading older. Stored scrollHeight: ${scrollHeightBeforeRef.current}, scrollTop: ${scrollTopBeforeRef.current}`
      )
      fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])
  // --- End Actions ---
  // --- Loading / Error Handling ---
  const isLoading = isLoadingSession || (isLoadingMessages && !messagePages)
  const queryError = sessionError || messagesError
  if (isLoading && !queryError) {
    // Show skeleton only on initial load without errors
    return (
      <div className='flex h-full flex-col'>
        <div className='flex items-center justify-between border-b p-3'>
          <Skeleton className='h-6 w-1/3' />
          <div className='flex gap-2'>
            {' '}
            <Skeleton className='h-8 w-20' /> <Skeleton className='h-8 w-8' />{' '}
          </div>
        </div>
        <div className='flex grow overflow-hidden'>
          <div className='grow space-y-4 border-r p-4'>
            <Skeleton className='h-10 w-3/4' />
            <Skeleton className='ml-auto h-10 w-1/2' />
            <Skeleton className='h-8 w-2/3' />
          </div>
          <div className='w-64 shrink-0 space-y-3 border-l p-4'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-3 w-full' />
            <Skeleton className='h-3 w-full' />
            <Skeleton className='h-3 w-4/5' />
          </div>
        </div>
        <div className='border-t p-3'>
          <Skeleton className='h-20 w-full' />
        </div>
      </div>
    )
  }
  if (queryError) {
    return (
      <div className='p-4'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>Error Loading Chat</AlertTitle>
          <AlertDescription>
            {queryError?.message || 'An unexpected error occurred.'}
            <Button
              variant='outline'
              size='sm'
              onClick={() => window.location.reload()}
              className='ml-2'>
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  // Ensure data is available after loading and error checks
  if (!sessionData) {
    return (
      <div className='p-4 text-center text-muted-foreground'>
        Chat data not available. Please try reloading.
      </div>
    )
  }
  // --- Render Chat UI ---
  const isResolved = false

  return (
    <div className={cn('flex h-full flex-col bg-card', centered && 'mx-auto w-full max-w-4xl')}>
      {/* Chat Header */}
      <div className='flex items-center justify-between border-b p-3'>
        <div className='flex items-center gap-2'>
          <h2 className='text-sm font-semibold'>Subject</h2>
          {/* Status Badges */}
          {isResolved && (
            <Badge
              variant='outline'
              className='border-green-300 bg-green-100 text-xs text-green-800 dark:border-green-700 dark:bg-green-900/50 dark:text-green-300'>
              Resolved
            </Badge>
          )}
          <Badge
            variant='outline'
            className='border-blue-300 bg-blue-100 text-xs text-blue-800 dark:border-blue-700 dark:bg-blue-900/50 dark:text-blue-300'>
            Open
          </Badge>

          {/* Add more statuses as needed */}
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-xs italic text-muted-foreground'>Unassigned</span>
          {!isResolved && (
            <Button
              size='sm'
              variant='outline'
              onClick={handleResolveChat}
              disabled={closeSessionMutation.isPending}>
              {closeSessionMutation.isPending ? (
                <Loader2 className='mr-1 h-4 w-4 animate-spin' />
              ) : (
                <CircleCheck className='mr-1 h-4 w-4' />
              )}
              Resolve
            </Button>
          )}
          {isResolved && (
            <Button size='sm' variant='outline' disabled>
              {' '}
              {/* TODO: Implement Reopen */}
              <Archive className='mr-1 h-4 w-4' /> Reopen
            </Button>
          )}
          <Button size='icon' variant='ghost' title='Settings (coming soon)' disabled>
            <Settings2 className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {/* Main Content Area (Split View) */}
      <div className='flex grow overflow-hidden'>
        {/* Message Area */}
        <div className='flex grow flex-col border-r'>
          {/* Message List - use ref for ScrollArea */}
          <ScrollArea className='grow' ref={scrollAreaRef}>
            <div className='space-y-1 p-4'>
              {' '}
              {/* Add space-y for bubbles */}
              {/* Load Older Button */}
              {hasNextPage && (
                <div className='pb-4 text-center'>
                  <Button
                    variant='link'
                    size='sm'
                    onClick={handleLoadOlder}
                    disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}{' '}
                    Load Older Messages
                  </Button>
                </div>
              )}
              {/* Message Bubbles */}
              {messages.map((msg) => (
                <ChatMessageBubble key={msg.id} message={msg} currentAgentId={agentId} />
              ))}
              {/* Typing Indicator */}
              {isUserTyping && (
                <div className='mb-3 flex items-end justify-start'>
                  <Avatar className='order-1 mr-2 h-6 w-6 shrink-0'>
                    <AvatarFallback className='text-xs'>U</AvatarFallback>
                  </Avatar>
                  <div className='order-2 animate-pulse rounded-lg bg-muted p-2 px-3'>
                    <span className='text-sm'>...</span>
                  </div>
                </div>
              )}
              {/* No Messages Placeholder */}
              {messages.length === 0 && !isLoadingMessages && !isFetchingNextPage && (
                <p className='py-10 text-center text-sm text-muted-foreground'>
                  No messages in this conversation yet.
                </p>
              )}
              {/* Reference element for scrolling to bottom */}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Message Input */}
          {!isResolved && (
            <div className='border-t bg-background p-3'>
              <div className='relative'>
                <Textarea
                  placeholder='Type your message as agent...'
                  rows={3}
                  className='resize-none pr-28 focus-visible:ring-1 focus-visible:ring-ring' // Standard focus style
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value)
                    const isTyping = e.target.value.trim().length > 0
                    // Clear existing timer
                    if (agentTypingTimerRef.current) {
                      clearTimeout(agentTypingTimerRef.current)
                    }
                    // Send typing=true if we have text
                    if (isTyping) {
                      // debouncedTypingHandler(true)
                    }
                    // Set timer to send typing=false after 1.5 seconds of inactivity
                    agentTypingTimerRef.current = setTimeout(() => {
                      // debouncedTypingHandler(false)
                    }, 1500)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                      // Also send typing=false when message is sent
                      // debouncedTypingHandler(false)
                    }
                  }}
                  disabled={isSending} // Disable while sending
                />
                <div className='absolute bottom-2 right-2 flex items-center gap-1'>
                  <Button size='icon' variant='ghost' title='Attach File (coming soon)' disabled>
                    <Paperclip className='h-4 w-4' />
                  </Button>
                  <Button
                    size='sm'
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim() || isSending}>
                    {isSending ? (
                      <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                    ) : (
                      <SendHorizonal className='mr-1 h-4 w-4' />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          )}
          {isResolved && (
            <div className='border-t bg-muted p-3 text-center text-sm italic text-muted-foreground'>
              This chat has been resolved.
            </div>
          )}
        </div>

        {/* Visitor Info Sidebar */}
        <div className='w-64 shrink-0 space-y-4 overflow-y-auto border-l bg-muted/30 p-4'>
          <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
            <User size={16} /> Visitor Details
          </h3>
          <div className='space-y-1.5 text-xs'>
            {/* Session details */}
            <p title={sessionData.visitorId}>
              <strong className='font-medium'>Visitor ID:</strong>{' '}
              <span className='font-mono text-muted-foreground'>
                {sessionData.visitorId.substring(0, 8)}...
              </span>
            </p>
            <p>
              <strong className='font-medium'>Name:</strong>{' '}
              {sessionData.visitorName || (
                <span className='italic text-muted-foreground'>Not Provided</span>
              )}
            </p>
            <p>
              <strong className='font-medium'>Email:</strong>{' '}
              {sessionData.visitorEmail ? (
                <a
                  href={`mailto:${sessionData.visitorEmail}`}
                  className='text-primary-500 hover:underline'>
                  {sessionData.visitorEmail}
                </a>
              ) : (
                <span className='italic text-muted-foreground'>Not Provided</span>
              )}
            </p>

            <Separator className='my-3' />

            <p>
              <strong className='font-medium'>Started:</strong>{' '}
              {format(new Date(sessionData.createdAt), 'Pp')}
            </p>
            <p>
              <strong className='font-medium'>Last Activity:</strong>{' '}
              {format(new Date(sessionData.lastActivityAt), 'Pp')}
            </p>
            {sessionData.url && (
              <p>
                <strong className='font-medium'>Page:</strong>{' '}
                <a
                  href={sessionData.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='block truncate text-primary hover:underline'
                  title={sessionData.url}>
                  {sessionData.url}
                </a>
              </p>
            )}
            {sessionData.referrer && (
              <p>
                <strong className='font-medium'>Referrer:</strong>{' '}
                <span
                  className='truncate text-muted-foreground'
                  title={sessionData.referrer ?? undefined}>
                  {sessionData.referrer}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
