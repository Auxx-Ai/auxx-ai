/**
 * Represents information about the chat visitor.
 */
export type ChatUserInfo = {
  id?: string // Internal ID if tracked
  name?: string
  email?: string
  metadata?: Record<string, any> // Additional custom data
}

/**
 * Represents a file attachment in the chat.
 */
export type ChatAttachment = {
  id: string // Database ID of the attachment record
  name: string // Original filename
  url: string // URL to access the file
  size: number // Size in bytes
  type: string // MIME type
}

/**
 * Represents a single message within a chat session.
 */
export type ChatMessage = {
  id: string // Unique message ID (can be client-generated initially)
  sessionId: string // ID of the session this message belongs to
  threadId: string // ID of the thread this message belongs to
  content: string // The text content of the message
  sender: 'USER' | 'AGENT' | 'SYSTEM' // Who sent the message
  createdAt: Date // When the message was created/sent
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error' // Delivery status
  agent?: AgentInfo
  // agentId?: string // ID of the agent if sender is 'agent'
  // agentName?: string // Name of the agent
  // agentAvatar?: string // URL for agent's avatar
  attachments?: ChatAttachment[] // Any files attached to the message
  metadata?: Record<string, any> // Additional metadata
}

/**
 * Represents a chat session instance.
 */
export type ChatSession = {
  id: string // Unique session ID
  organizationId: string // ID of the organization
  widgetId: string // ID of the chat widget used
  threadId: string | null // ID of the corresponding Thread, nullable initially? No, should be required after router init.
  status: 'active' | 'closed' // Current status of the session
  createdAt: Date // When the session was created
  lastActivityAt: Date // Timestamp of the last activity (message, etc.)
  visitorId: string // Unique identifier for the visitor (e.g., from cookie)
  visitorInfo?: ChatUserInfo // Collected visitor details
  url?: string // URL where the chat was initiated
  referrer?: string // Referring URL
  userAgent?: string // Visitor's browser user agent
  ipAddress?: string // Visitor's IP address (handle privacy)
  closedAt?: Date | null // When the session was closed
  closedBy?: { id: string; name: string } | null // Who closed the session (agent ID and name)
}

export type AgentInfo = {
  id?: string // Agent ID if applicable
  name?: string // Agent name
  image?: string // URL for agent's avatar
}

export type FrontendChatMessage = {
  id: string
  content: string
  sender: 'USER' | 'AGENT' | 'SYSTEM' // Match your sender types
  timestamp: Date // Send Date objects
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'ERROR' | 'SENDING' // Optional status
  agent: AgentInfo

  // Add other fields if needed by frontend (agentName, etc.)
  // agentId?: string
  // agentName?: string
  // agentAvatar?: string
  attachments?: ChatAttachment[]
}
