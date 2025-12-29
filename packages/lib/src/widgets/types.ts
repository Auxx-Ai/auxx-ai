// @auxx/lib/widgets/types.ts
import { z } from 'zod'

// Widget position enum
export enum WidgetPosition {
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  TOP_RIGHT = 'TOP_RIGHT',
  TOP_LEFT = 'TOP_LEFT',
}

// Widget status enum
export enum WidgetStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// Session status enum
export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

// Message sender enum
export enum MessageSender {
  USER = 'USER',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
  AI = 'AI',
}

// Message status enum
export enum MessageStatus {
  SENDING = 'SENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  ERROR = 'ERROR',
}

// Chat widget schema for validation
export const widgetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Widget name is required'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),

  // Appearance
  title: z.string().min(1, 'Widget title is required'),
  subtitle: z.string().optional(),
  primaryColor: z.string().default('#4F46E5'),
  logoUrl: z.url().optional().or(z.literal('')),
  position: z.enum(WidgetPosition).default(WidgetPosition.BOTTOM_RIGHT),

  // Behavior
  welcomeMessage: z.string().optional(),
  autoOpen: z.boolean().default(false),
  mobileFullScreen: z.boolean().default(true),
  collectUserInfo: z.boolean().default(false),
  offlineMessage: z.string().optional(),

  // Domain allowlist
  allowedDomains: z.array(z.string()).default([]),

  // AI integration
  useAi: z.boolean().default(false),
  aiModel: z.string().optional(),
  aiInstructions: z.string().optional(),

  // Optional fields for validation
  operatingHoursEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
})

// Widget types
export type WidgetFormValues = z.infer<typeof widgetSchema>

export interface Widget {
  id: string
  organizationId: string
  name: string
  description?: string
  isActive: boolean
  title: string
  subtitle?: string
  primaryColor: string
  logoUrl?: string
  position: WidgetPosition
  welcomeMessage?: string
  autoOpen: boolean
  mobileFullScreen: boolean
  collectUserInfo: boolean
  offlineMessage?: string
  allowedDomains: string[]
  useAi: boolean
  aiModel?: string
  aiInstructions?: string
  createdAt: Date
  updatedAt: Date
}

// Visitor information
export interface VisitorInfo {
  id?: string
  name?: string
  email?: string
  metadata?: Record<string, any>
}

// Chat attachment
export interface ChatAttachment {
  id: string
  name: string
  url: string
  size: number
  type: string
}

// Chat message
export interface ChatMessage {
  id: string
  sessionId: string
  content: string
  sender: 'user' | 'agent' | 'system' | 'ai'
  timestamp: Date
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error'
  agentId?: string
  agentName?: string
  agentAvatar?: string
  attachments?: ChatAttachment[]
  metadata?: Record<string, any>
}

// Chat session
export interface ChatSession {
  id: string
  organizationId: string
  widgetId: string
  status: 'active' | 'closed'
  createdAt: Date
  lastActivityAt: Date
  visitorId: string
  visitorInfo?: VisitorInfo
  url?: string
  referrer?: string
  userAgent?: string
  ipAddress?: string
  closedAt?: Date
  closedBy?: { id: string; name: string }
  messageCount?: number
  lastMessage?: { content: string; timestamp: Date; sender: string }
  widgetName?: string
}

// Widget creation input
export interface CreateWidgetInput {
  organizationId: string
  name: string
  description?: string
  isActive?: boolean
  title: string
  subtitle?: string
  primaryColor?: string
  logoUrl?: string
  position?: WidgetPosition
  welcomeMessage?: string
  autoOpen?: boolean
  mobileFullScreen?: boolean
  collectUserInfo?: boolean
  offlineMessage?: string
  allowedDomains?: string[]
  useAi?: boolean
  aiModel?: string
  aiInstructions?: string
}

// Widget update input
export interface UpdateWidgetInput extends Partial<Omit<CreateWidgetInput, 'organizationId'>> {
  id: string
  organizationId: string
}

// Session creation input
export interface CreateSessionInput {
  widgetId: string
  visitorId?: string
  visitorInfo?: VisitorInfo
  url?: string
  referrer?: string
  userAgent?: string
  ipAddress?: string
}

// Message creation input
export interface CreateMessageInput {
  sessionId: string
  content: string
  sender: MessageSender
  agentId?: string
  attachmentIds?: string[]
  clientMessageId?: string
  metadata?: Record<string, any>
}

// Installation code input
export interface InstallationCodeInput {
  widgetId: string
  organizationId: string
}

// Service result interface
export interface ServiceResult<T> {
  success: boolean
  data?: T
  error?: string
}
