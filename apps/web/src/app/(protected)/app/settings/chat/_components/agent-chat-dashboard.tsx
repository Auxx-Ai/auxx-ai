// // ~/app/dashboard/chats/page.tsx
// import { Metadata } from 'next'
// import DashboardShell from '~/components/dashboard/dashboard-shell'
// import AgentChatDashboard from '~/components/chat/agent-chat-dashboard'

// export const metadata: Metadata = {
//   title: 'Live Chat | Dashboard',
//   description: 'Manage and respond to customer chat conversations',
// }

// export default function ChatDashboardPage() {
//   return (
//     <DashboardShell>
//       <AgentChatDashboard />
//     </DashboardShell>
//   )
// }

// ~/components/chat/agent-chat-dashboard.tsx
;('use client')

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@auxx/ui/components/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { format, formatDistanceToNow } from 'date-fns'
import { ArrowUpRight, CheckCircle2, Clock, Globe, Paperclip, Send, User } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'

type ChatSessionItem = {
  id: string
  widgetName: string
  createdAt: Date
  lastActivityAt: Date
  status: string
  messageCount: number
  lastMessage: { content: string; createdAt: Date; sender: string } | null
  url?: string | null
  referrer?: string | null
}

type ChatMessage = {
  id: string
  content: string
  sender: 'user' | 'agent' | 'system'
  timestamp: Date
  status: string
  agentName?: string
  agentAvatar?: string
  attachments?: Array<{ id: string; name: string; url: string; size: number; type: string }>
}

export default function AgentChatDashboard() {
  // const { organization } = useOrganization()
  // const router = useRouter()

  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messageText, setMessageText] = useState('')
  const [sessions, setSessions] = useState<ChatSessionItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Queries and Mutations
  const getActiveSessions = api.chat.getActiveSessions.useQuery(
    {
      organizationId: organization?.id || '',
      status: activeTab === 'active' ? 'ACTIVE' : activeTab === 'closed' ? 'CLOSED' : 'ALL',
    },
    {
      enabled: !!organization?.id,
      refetchInterval: 30000, // Refetch every 30 seconds
      onSuccess: (data) => {
        setSessions(data.sessions)

        // If no session is selected but we have sessions, select the first one
        if (!selectedSessionId && data.sessions.length > 0) {
          setSelectedSessionId(data.sessions[0].id)
        }
      },
    }
  )

  const getChatHistory = api.chat.getChatHistory.useMutation({
    onSuccess: (data) => {
      setMessages(data.messages)
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    },
    onError: (error) => {
      toastError({ title: 'Failed to load chat history', description: error.message })
    },
  })

  const sendAgentMessage = api.chat.sendAgentMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, data.message])
      setMessageText('')
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to send message', description: error.message })
    },
  })

  const closeSession = api.chat.closeSession.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Chat session closed' })
      getActiveSessions.refetch()

      // If we're in the active tab, select another active session if available
      if (activeTab === 'active') {
        const remainingSessions = sessions.filter((s) => s.id !== selectedSessionId)
        if (remainingSessions.length > 0) {
          setSelectedSessionId(remainingSessions[0].id)
        } else {
          setSelectedSessionId(null)
          setMessages([])
        }
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to close session', description: error.message })
    },
  })

  // Load chat history when session is selected
  useEffect(() => {
    if (selectedSessionId) {
      getChatHistory.mutate({ sessionId: selectedSessionId })
    } else {
      setMessages([])
    }
  }, [selectedSessionId])

  // Real-time updates via polling
  useEffect(() => {
    // Clear any existing interval
    if (pollingInterval) {
      clearInterval(pollingInterval)
    }

    // Only set up polling if a session is selected
    if (selectedSessionId) {
      const interval = setInterval(() => {
        getChatHistory.mutate({ sessionId: selectedSessionId })
      }, 5000) // Poll every 5 seconds

      setPollingInterval(interval)
    }

    return () => {
      if (pollingInterval) clearInterval(pollingInterval)
    }
  }, [selectedSessionId])

  // Handle sending messages
  const handleSendMessage = () => {
    if (!messageText.trim() || !selectedSessionId) return

    sendAgentMessage.mutate({ sessionId: selectedSessionId, content: messageText.trim() })
  }

  // Handle closing a session
  const handleCloseSession = () => {
    if (!selectedSessionId) return

    closeSession.mutate({ sessionId: selectedSessionId })
  }

  // Format date for display
  const formatDate = (date: Date) => {
    const now = new Date()
    const messageDate = new Date(date)

    // If the message is from today, just show the time
    if (
      messageDate.getDate() === now.getDate() &&
      messageDate.getMonth() === now.getMonth() &&
      messageDate.getFullYear() === now.getFullYear()
    ) {
      return format(messageDate, 'h:mm a')
    }

    // Otherwise, show the date and time
    return format(messageDate, 'MMM d, h:mm a')
  }

  // Loading states
  const isLoading = getActiveSessions.isLoading
  const isLoadingHistory = getChatHistory.isPending

  // Get details of selected session
  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  return (
    <div className='flex h-[calc(100vh-9rem)] w-full flex-col space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Live Chat</h2>
          <p className='text-muted-foreground'>Manage and respond to customer conversations</p>
        </div>
      </div>

      <Separator />

      <div className='grid flex-1 gap-4 md:grid-cols-3 lg:grid-cols-4'>
        {/* Sessions List */}
        <div className='md:col-span-1'>
          <Card className='flex h-full flex-col'>
            <CardHeader className='pb-2'>
              <CardTitle>Conversations</CardTitle>
              <Tabs
                defaultValue='active'
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as 'active' | 'closed')}
                className='w-full'>
                <TabsList className='grid w-full grid-cols-2'>
                  <TabsTrigger value='active'>Active</TabsTrigger>
                  <TabsTrigger value='closed'>Closed</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className='flex-1 p-0'>
              <ScrollArea className='h-[calc(100vh-16rem)]'>
                {isLoading ? (
                  <div className='space-y-2 p-4'>
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className='flex items-start space-x-3 rounded-md border p-3'>
                        <Skeleton className='h-10 w-10 rounded-full' />
                        <div className='flex-1 space-y-2'>
                          <Skeleton className='h-4 w-2/3' />
                          <Skeleton className='h-3 w-full' />
                          <div className='flex justify-between'>
                            <Skeleton className='h-3 w-1/3' />
                            <Skeleton className='h-3 w-1/4' />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <div className='flex h-full items-center justify-center p-4'>
                    <div className='text-center'>
                      <p className='text-sm text-muted-foreground'>
                        No {activeTab} conversations found
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className='space-y-1 p-2'>
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        className={`flex w-full flex-col space-y-2 rounded-md border p-3 text-left hover:bg-accent ${
                          selectedSessionId === session.id ? 'bg-accent' : ''
                        }`}
                        onClick={() => setSelectedSessionId(session.id)}>
                        <div className='flex items-center justify-between'>
                          <div className='flex items-center space-x-2'>
                            <Avatar className='h-8 w-8'>
                              <AvatarFallback>{session.widgetName?.[0] || 'W'}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className='text-sm font-medium'>{session.widgetName}</p>
                              <p className='text-xs text-muted-foreground'>
                                {session.messageCount} messages
                              </p>
                            </div>
                          </div>
                          <Badge variant={session.status === 'ACTIVE' ? 'default' : 'secondary'}>
                            {session.status === 'ACTIVE' ? 'Active' : 'Closed'}
                          </Badge>
                        </div>

                        {session.lastMessage && (
                          <div className='line-clamp-2 text-xs text-muted-foreground'>
                            <span className='font-medium'>
                              {session.lastMessage.sender === 'USER' ? 'Customer: ' : 'Agent: '}
                            </span>
                            {session.lastMessage.content}
                          </div>
                        )}

                        <div className='flex items-center justify-between text-xs text-muted-foreground'>
                          <div className='flex items-center'>
                            <Clock className='mr-1 h-3 w-3' />
                            {formatDistanceToNow(new Date(session.lastActivityAt), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Chat Area */}
        <div className='flex flex-col md:col-span-2 lg:col-span-3'>
          <Card className='flex h-full flex-col'>
            {selectedSession ? (
              <>
                <CardHeader className='flex flex-row items-center justify-between border-b pb-2'>
                  <div>
                    <CardTitle className='flex items-center'>
                      <Avatar className='mr-2 h-8 w-8'>
                        <AvatarFallback>{selectedSession.widgetName?.[0] || 'W'}</AvatarFallback>
                      </Avatar>
                      {selectedSession.widgetName}
                    </CardTitle>
                    <CardDescription className='mt-1 flex items-center'>
                      {selectedSession.url && (
                        <div className='mr-4 flex items-center'>
                          <Globe className='mr-1 h-3 w-3' />
                          <a
                            href={selectedSession.url}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='flex items-center text-xs hover:underline'>
                            {new URL(selectedSession.url).hostname}
                            <ArrowUpRight className='ml-1 h-3 w-3' />
                          </a>
                        </div>
                      )}
                      <div className='flex items-center'>
                        <Clock className='mr-1 h-3 w-3' />
                        <span className='text-xs'>
                          Started{' '}
                          {formatDistanceToNow(new Date(selectedSession.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </CardDescription>
                  </div>

                  {selectedSession.status === 'ACTIVE' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant='outline' size='sm'>
                          Close Chat
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Close chat session?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will end the current chat session. The customer will no longer be
                            able to send messages, and the chat will be moved to the closed list.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleCloseSession}>
                            Close Chat
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </CardHeader>

                <CardContent className='flex-1 overflow-hidden p-0'>
                  <ScrollArea className='h-[calc(100vh-20rem)]'>
                    {isLoadingHistory ? (
                      <div className='flex h-full items-center justify-center p-4'>
                        <div className='text-center'>
                          <Skeleton className='mx-auto h-6 w-6 rounded-full' />
                          <p className='mt-2 text-sm text-muted-foreground'>
                            Loading conversation...
                          </p>
                        </div>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className='flex h-full items-center justify-center p-4'>
                        <div className='text-center'>
                          <p className='text-sm text-muted-foreground'>
                            No messages in this conversation yet.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className='space-y-4 p-4'>
                        {messages.map((message) => (
                          <div
                            key={message.id}
                            className={`flex ${
                              message.sender === 'user' ? 'justify-start' : 'justify-end'
                            }`}>
                            <div
                              className={`max-w-[75%] rounded-lg p-3 ${
                                message.sender === 'user'
                                  ? 'bg-muted text-foreground'
                                  : message.sender === 'system'
                                    ? 'bg-secondary text-secondary-foreground'
                                    : 'bg-primary text-primary-foreground'
                              }`}>
                              {message.sender === 'agent' && message.agentName && (
                                <div className='mb-1 flex items-center'>
                                  <Avatar className='mr-1 h-5 w-5'>
                                    <AvatarImage
                                      src={message.agentAvatar}
                                      alt={message.agentName}
                                    />
                                    <AvatarFallback>{message.agentName[0]}</AvatarFallback>
                                  </Avatar>
                                  <span className='text-xs font-medium'>{message.agentName}</span>
                                </div>
                              )}

                              <div className='whitespace-pre-wrap break-words'>
                                {message.content}
                              </div>

                              {message.attachments && message.attachments.length > 0 && (
                                <div className='mt-2 space-y-1'>
                                  {message.attachments.map((attachment) => (
                                    <a
                                      key={attachment.id}
                                      href={attachment.url}
                                      target='_blank'
                                      rel='noopener noreferrer'
                                      className='flex items-center rounded bg-background/20 p-1 text-xs hover:bg-background/30'>
                                      <Paperclip size={12} className='mr-1' />
                                      <span className='truncate'>{attachment.name}</span>
                                    </a>
                                  ))}
                                </div>
                              )}

                              <div
                                className={`mt-1 text-xs ${
                                  message.sender === 'user'
                                    ? 'text-muted-foreground'
                                    : message.sender === 'system'
                                      ? 'text-secondary-foreground/70'
                                      : 'text-primary-foreground/70'
                                }`}>
                                {formatDate(message.timestamp)}
                                {message.status === 'DELIVERED' && message.sender === 'agent' && (
                                  <span className='ml-1 inline-flex items-center'>
                                    <CheckCircle2 className='ml-1 h-3 w-3' />
                                  </span>
                                )}
                                {message.status === 'READ' && message.sender === 'agent' && (
                                  <span className='ml-1 inline-flex items-center'>
                                    <CheckCircle2 className='ml-1 h-3 w-3 text-green-500' />
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>

                <CardFooter className='border-t p-3'>
                  {selectedSession.status === 'ACTIVE' ? (
                    <div className='flex w-full items-center space-x-2'>
                      <Input
                        placeholder='Type your message...'
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSendMessage()
                          }
                        }}
                        disabled={sendAgentMessage.isPending}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!messageText.trim() || sendAgentMessage.isPending}>
                        <Send />
                        <span className='ml-2 hidden sm:inline'>Send</span>
                      </Button>
                    </div>
                  ) : (
                    <div className='w-full text-center text-sm text-muted-foreground'>
                      <p>This chat session is closed.</p>
                    </div>
                  )}
                </CardFooter>
              </>
            ) : (
              <div className='flex h-full items-center justify-center p-4'>
                <div className='text-center'>
                  <User className='mx-auto h-12 w-12 text-muted-foreground' />
                  <h3 className='mt-4 text-lg font-medium'>No chat selected</h3>
                  <p className='mt-2 text-sm text-muted-foreground'>
                    Select a chat from the list to view the conversation
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
