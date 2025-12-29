// ~/components/widget/chat-widget.tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { X, Send, Paperclip, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Loader2 } from 'lucide-react'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { api } from '~/trpc/react'
import { useDropzone } from 'react-dropzone'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

export type ChatMessage = {
  id: string
  content: string
  sender: 'user' | 'agent' | 'system'
  timestamp: Date
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error'
  agentName?: string
  agentAvatar?: string
  attachments?: Array<{ id: string; name: string; url: string; size: number; type: string }>
}

export type ChatWidgetProps = {
  // Configuration
  organizationId: string
  widgetId: string
  widgetColor?: string
  widgetPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  initialMessage?: string

  // Customization
  title?: string
  subtitle?: string
  logoUrl?: string
  agentAvatarUrl?: string

  // Behavior
  autoOpen?: boolean
  mobileFullScreen?: boolean
  collectUserInfo?: boolean

  // Callbacks
  onInitialize?: () => void
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
  onMessageSent?: (message: ChatMessage) => void
  onMessageReceived?: (message: ChatMessage) => void
}

export function ChatWidget({
  organizationId,
  widgetId,
  widgetColor = '#4F46E5', // Indigo color
  widgetPosition = 'bottom-right',
  initialMessage = 'Hi there! How can we help you today?',
  title = 'Chat Support',
  subtitle = 'We typically reply within a few minutes',
  logoUrl,
  agentAvatarUrl,
  autoOpen = false,
  mobileFullScreen = true,
  collectUserInfo = false,
  onInitialize,
  onMinimize,
  onMaximize,
  onClose,
  onMessageSent,
  onMessageReceived,
}: ChatWidgetProps) {
  // State
  const [isOpen, setIsOpen] = useState(autoOpen)
  const [isMobile, setIsMobile] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messageText, setMessageText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [userInfo, setUserInfo] = useState<{ name?: string; email?: string; hasProvided: boolean }>(
    { hasProvided: false }
  )
  const [isConnecting, setIsConnecting] = useState(true)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // tRPC mutations and queries
  const initializeChat = api.widget.initializeChat.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId)
      setIsConnecting(false)

      // Add initial message if available and no messages exist yet
      if (initialMessage && messages.length === 0) {
        setMessages([
          {
            id: `system-${Date.now()}`,
            content: initialMessage,
            sender: 'agent',
            timestamp: new Date(),
            status: 'sent',
            agentName: 'Support',
            agentAvatar: agentAvatarUrl,
          },
        ])
      }

      if (onInitialize) onInitialize()
    },
    onError: (error) => {
      toastError({ title: 'Failed to connect to chat service', description: error.message })
      setIsConnecting(false)
    },
  })

  const sendMessage = api.widget.sendMessage.useMutation({
    onSuccess: (data) => {
      // Update the temporary message with the confirmed one
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.clientMessageId ? { ...data.message, status: 'sent' } : msg
        )
      )

      if (onMessageSent) onMessageSent(data.message)
    },
    onError: (error, variables) => {
      // Mark message as error
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === variables.clientMessageId ? { ...msg, status: 'error' } : msg
        )
      )

      toastError({
        title: 'Failed to send message',
        description: error.message,
        action: { label: 'Retry', onClick: () => handleSendMessage(variables.content) },
      })
    },
  })

  const loadChatHistory = api.widget.getChatHistory.useMutation({
    onSuccess: (data) => {
      setMessages(data.messages)
      setIsLoadingHistory(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to load chat history', description: error.message })
      setIsLoadingHistory(false)
    },
  })

  // File upload mutation
  const uploadFile = api.widget.uploadAttachment.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'File uploaded successfully' })
      setUploadedFiles((prev) => prev.filter((file) => file.name !== data.originalName))
    },
    onError: (error) => {
      toastError({ title: 'Failed to upload file', description: error.message })
    },
  })

  // Dropzone for file attachments
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      // Filter files that exceed size limit (10MB)
      const validFiles = acceptedFiles.filter((file) => file.size <= 10 * 1024 * 1024)
      const oversizedFiles = acceptedFiles.filter((file) => file.size > 10 * 1024 * 1024)

      if (oversizedFiles.length > 0) {
        toastError({ title: `${oversizedFiles.length} file(s) exceed the 10MB limit` })
      }

      if (validFiles.length > 0) {
        setUploadedFiles((prev) => [...prev, ...validFiles])

        // Upload each file
        validFiles.forEach((file) => {
          if (sessionId) {
            uploadFile.mutate({
              sessionId,
              file: file,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
            })
          }
        })
      }
    },
    maxSize: 10 * 1024 * 1024, // 10MB limit
  })

  // Initialization
  useEffect(() => {
    // Check if on mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    // Initialize chat session
    initializeChat.mutate({
      organizationId,
      widgetId,
      userAgent: navigator.userAgent,
      referrer: document.referrer,
      url: window.location.href,
    })

    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [organizationId, widgetId])

  // Load chat history when session is established
  useEffect(() => {
    if (sessionId && !isLoadingHistory) {
      setIsLoadingHistory(true)
      loadChatHistory.mutate({ sessionId })
    }
  }, [sessionId])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Setup WebSocket or polling for real-time messages
  useEffect(() => {
    if (!sessionId) return

    // This is a simplified polling approach
    // In production, consider using WebSockets or Server-Sent Events
    const pollInterval = setInterval(() => {
      // Poll for new messages
      // This would be a separate tRPC query in a real implementation
    }, 3000)

    return () => {
      clearInterval(pollInterval)
    }
  }, [sessionId])

  // Handle sending messages
  const handleSendMessage = (content: string = messageText) => {
    if (!content.trim() && uploadedFiles.length === 0) return
    if (!sessionId) {
      toastError({ title: 'Chat session not initialized' })
      return
    }

    const clientMessageId = `client-${Date.now()}`

    // Add message to state immediately for UI responsiveness
    const newMessage: ChatMessage = {
      id: clientMessageId,
      content: content.trim(),
      sender: 'user',
      timestamp: new Date(),
      status: 'sending',
      attachments: uploadedFiles.map((file) => ({
        id: `temp-${file.name}`,
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        type: file.type,
      })),
    }

    setMessages((prev) => [...prev, newMessage])
    setMessageText('')
    setUploadedFiles([])

    // Send to server
    sendMessage.mutate({
      sessionId,
      content: content.trim(),
      clientMessageId,
      attachmentIds: [], // In a real implementation, these would be the IDs from uploaded files
    })
  }

  // Toggle chat open/closed
  const toggleChat = () => {
    setIsOpen((prev) => !prev)
    if (!isOpen && onMaximize) onMaximize()
    if (isOpen && onMinimize) onMinimize()
  }

  // Determine position styles
  const positionStyles = {
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  }[widgetPosition]

  // User info collection form
  const renderUserInfoForm = () => {
    if (!collectUserInfo || userInfo.hasProvided) return null

    return (
      <div className="border-b border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-2 text-sm font-medium">Let us know who you are</h3>
        <div className="space-y-3">
          <Input
            placeholder="Your name"
            onChange={(e) => setUserInfo((prev) => ({ ...prev, name: e.target.value }))}
            value={userInfo.name || ''}
          />
          <Input
            placeholder="Email address"
            type="email"
            onChange={(e) => setUserInfo((prev) => ({ ...prev, email: e.target.value }))}
            value={userInfo.email || ''}
          />
          <Button
            onClick={() => setUserInfo((prev) => ({ ...prev, hasProvided: true }))}
            size="sm"
            className="w-full"
            style={{ backgroundColor: widgetColor }}>
            Continue
          </Button>
        </div>
      </div>
    )
  }

  // Button to open the chat
  const renderChatButton = () => (
    <Button
      onClick={toggleChat}
      className="h-12 w-12 rounded-full p-3 shadow-lg"
      style={{ backgroundColor: widgetColor }}>
      {isOpen ? <X size={24} /> : <MessageSquare size={24} />}
    </Button>
  )

  // The expanded chat window
  const renderChatWindow = () => {
    if (!isOpen) return null

    const chatContainerClasses = cn(
      'bg-background rounded-lg shadow-xl flex flex-col',
      'border border-border transition-all duration-300',
      isMobile && mobileFullScreen ? 'fixed inset-0 z-50 rounded-none' : 'w-80 h-96 fixed z-50'
    )

    return (
      <div className={cn(chatContainerClasses, positionStyles)}>
        {/* Chat header */}
        <div
          className="flex items-center justify-between rounded-t-lg p-3"
          style={{ backgroundColor: widgetColor }}>
          <div className="flex items-center">
            {logoUrl && (
              <div className="mr-2 h-8 w-8 overflow-hidden rounded-full">
                <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
              </div>
            )}
            <div>
              <h3 className="font-medium text-white">{title}</h3>
              <p className="text-xs text-white/80">{subtitle}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleChat} className="text-white">
            {isMobile && mobileFullScreen ? <ChevronDown size={18} /> : <X size={18} />}
          </Button>
        </div>

        {/* User info collection (if enabled) */}
        {renderUserInfoForm()}

        {/* Chat message area */}
        {(!collectUserInfo || userInfo.hasProvided) && (
          <>
            <ScrollArea className="flex-1 p-4">
              {isConnecting || isLoadingHistory ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Send a message to start chatting with our support team.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex max-w-[80%] flex-col rounded-lg p-3',
                        message.sender === 'user'
                          ? 'ml-auto bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}>
                      {message.sender === 'agent' && (
                        <div className="mb-1 flex items-center">
                          <Avatar className="mr-2 h-6 w-6">
                            <AvatarImage src={message.agentAvatar} alt={message.agentName} />
                            <AvatarFallback>{message.agentName?.[0] || 'A'}</AvatarFallback>
                          </Avatar>
                          <span className="text-xs font-medium">
                            {message.agentName || 'Agent'}
                          </span>
                        </div>
                      )}

                      <div>{message.content}</div>

                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {message.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className="flex items-center rounded bg-background/20 p-1 text-xs">
                              <Paperclip size={12} className="mr-1" />
                              <span className="truncate">{attachment.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div
                        className={cn(
                          'mt-1 text-xs',
                          message.sender === 'user'
                            ? 'text-right text-primary-foreground/70'
                            : 'text-muted-foreground'
                        )}>
                        {message.status === 'sending' && 'Sending...'}
                        {message.status === 'error' && 'Failed to send'}
                        {message.status !== 'sending' &&
                          message.status !== 'error' &&
                          new Date(message.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />

                  {isTyping && (
                    <div className="flex max-w-[80%] rounded-lg bg-muted p-3">
                      <div className="flex space-x-1">
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.2s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Attachments preview */}
            {uploadedFiles.length > 0 && (
              <div className="px-4 pt-2">
                <div className="flex flex-wrap gap-2">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center rounded bg-muted p-1 text-xs">
                      <Paperclip size={12} className="mr-1" />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-1 h-4 w-4"
                        onClick={() =>
                          setUploadedFiles((prev) => prev.filter((_, i) => i !== index))
                        }>
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Message input area */}
            <div className="border-t border-border p-3">
              <div
                {...getRootProps()}
                className={cn(
                  'relative flex items-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring',
                  isDragActive && 'ring-2 ring-primary'
                )}>
                <input {...getInputProps()} />
                <Textarea
                  placeholder="Type your message..."
                  className="min-h-10 flex-1 border-0 p-2 text-sm focus-visible:ring-0"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                />
                <div className="flex pr-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => document.getElementById('file-upload')?.click()}>
                    <Paperclip size={18} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => handleSendMessage()}
                    disabled={(!messageText.trim() && uploadedFiles.length === 0) || isConnecting}
                    style={{ backgroundColor: widgetColor }}>
                    <Send size={18} />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {renderChatButton()}
      {renderChatWindow()}
    </>
  )
}
