// @auxx/lib/chat/chat-service.ts
import { type Database, schema } from '@auxx/database'
import { IntegrationType, MessageType, ThreadStatus } from '@auxx/database/enums'
import type { UserEntity as User } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import {
  deleteRedisData,
  getRedisClient,
  getRedisData,
  KEYS,
  // MESSAGE_EXPIRATION,
  SESSION_EXPIRATION,
  setRedisData,
} from '@auxx/redis'
import { TRPCError } from '@trpc/server'
import { and, eq, ne } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { RealTimeService } from '../realtime/realtime-service'
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatUserInfo,
  FrontendChatMessage,
} from './types'

const logger = createScopedLogger('chat-service')

// Define the expected message structure for the frontend more explicitly if needed
// Reuse the FrontendChatMessage type defined previously or adjust ChatMessage type slightly

// Helper function (can be moved to utils)
function isDomainAllowed(allowedDomains: string[], requestUrl?: string | null): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true
  if (!requestUrl) return true // Allow if no referer?
  try {
    const domain = new URL(requestUrl).hostname
    return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

/**
 * Service class for handling chat-related operations.
 * Manages database interactions, caching, and real-time notifications via Pusher.
 */
export class ChatService {
  private db: Database
  private realtimeService: RealTimeService

  /**
   * Creates an instance of ChatService.
   * @param {Database} db - The Drizzle database client.
   * @param {RealTimeService} realtimeService - The service for real-time communication (Pusher).
   */
  constructor(db: Database, realtimeService: RealTimeService) {
    this.db = db
    this.realtimeService = realtimeService
  }
  async initializeOrResumeSession(params: {
    integrationId: string
    visitorId?: string | null
    sessionId?: string
    threadId?: string
    userAgent?: string
    referrer?: string
    url?: string
    ipAddress?: string
    visitorName?: string
    visitorEmail?: string
  }): Promise<{
    sessionId: string
    threadId: string
    visitorId: string
    messages: FrontendChatMessage[]
    isNewSession: boolean
  }> {
    const {
      integrationId,
      visitorId: inputVisitorId, // Rename to avoid conflict with session visitorId
      sessionId: inputSessionId,
      threadId: inputThreadId,
      url,
      // ... other params
    } = params

    logger.info('Service: Attempting to initialize/resume chat session', {
      integrationId,
      sessionId: inputSessionId,
      visitorId: inputVisitorId,
      url,
    })

    // 1. Fetch Integration, Widget, and perform initial checks (Domain, Active)
    const integration = await this.db.query.Integration.findFirst({
      where: (integrations, { eq, and }) =>
        and(eq(integrations.id, integrationId), eq(integrations.provider, 'chat')),
      with: {
        chatWidget: true,
      },
    })

    if (!integration?.chatWidget) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat widget configuration not found.' })
    }
    if (!integration.enabled || !integration.chatWidget.isActive) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Chat widget is currently inactive.' })
    }
    if (!isDomainAllowed(integration.chatWidget.allowedDomains, url)) {
      logger.warn('Chat blocked: domain restriction.', {
        integrationId,
        url,
        allowed: integration.chatWidget.allowedDomains,
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Chat widget not available on this domain.',
      })
    }

    const now = new Date()
    let messages: FrontendChatMessage[] = []

    // --- Attempt to Resume Session ---
    if (inputSessionId && inputThreadId && inputVisitorId) {
      logger.info(`Service: Attempting resume for session ${inputSessionId}`)

      const existingSession = await this.db.query.ChatSession.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, inputSessionId),
        with: { widget: true }, // Include widget for status check
      })

      let canResume = false
      if (!existingSession) {
        logger.warn(`Service: Session resume failed - ID ${inputSessionId} not found.`)
      } else if (existingSession.widgetId !== integration.chatWidget.id) {
        logger.warn(`Service: Session resume failed - widget mismatch.`, {
          reqW: integration.chatWidget.id,
          sessW: existingSession.widgetId,
        })
      } else if (existingSession.visitorId !== inputVisitorId) {
        logger.error(`Service: Session resume blocked - Visitor ID mismatch.`, {
          inputV: inputVisitorId,
          sessV: existingSession.visitorId,
          sessId: inputSessionId,
        })
        // Fall through to create new session
      } else if (existingSession.threadId !== inputThreadId) {
        logger.warn(`Service: Session resume failed - Thread ID mismatch.`, {
          inputT: inputThreadId,
          sessT: existingSession.threadId,
          sessId: inputSessionId,
        })
      } else if (existingSession.status !== 'ACTIVE') {
        logger.warn(
          `Service: Session resume failed - status not ACTIVE: ${existingSession.status}`,
          { sessId: inputSessionId }
        )
      } else if (!existingSession.widget?.isActive) {
        logger.warn(`Service: Session resume failed - associated widget inactive.`, {
          widgetId: existingSession.widgetId,
        })
      }
      // Add expiry check here if needed
      else {
        canResume = true
      }

      if (canResume) {
        logger.info(`Service: Session ${inputSessionId} validation successful, resuming.`)

        // Fetch Message History using the existing service method
        const messageHistory = await this.getMessages(existingSession.id)
        messages = messageHistory // getMessages already returns the correct format

        // Update last activity
        // Run async in background, no need to wait
        this.db
          .update(schema.ChatSession)
          .set({
            lastActivityAt: now,
            url: params.url,
            referrer: params.referrer,
            userAgent: params.userAgent,
            ipAddress: params.ipAddress,
            updatedAt: new Date(),
          })
          .where(eq(schema.ChatSession.id, existingSession.id))
          .catch((err: any) =>
            logger.error('Failed background update activity on resume', {
              sessionId: existingSession.id,
              err,
            })
          )

        // Return existing session details + messages
        return {
          sessionId: existingSession.id,
          threadId: existingSession.threadId!, // Validated non-null
          visitorId: existingSession.visitorId, // Validated match
          messages: messages,
          isNewSession: false,
        }
      }
      logger.info(`Service: Session resume failed for ${inputSessionId}, creating new session.`)
    }

    // --- Create New Session ---
    logger.info('Service: Creating new chat session.', { integrationId })

    const visitorIdentifier = inputVisitorId || crypto.randomUUID() // Use provided visitorId or generate new
    messages = [] // Ensure messages are empty for new session before potential welcome message

    // Use transaction to ensure atomicity of Session + Thread + Welcome Message creation
    const result = await this.db.transaction(async (tx) => {
      // Create ChatSession
      const [newSession] = await tx
        .insert(schema.ChatSession)
        .values({
          widgetId: integration.chatWidget!.id,
          organizationId: integration.organizationId,
          status: 'ACTIVE',
          visitorId: visitorIdentifier,
          visitorName: params.visitorName,
          visitorEmail: params.visitorEmail,
          userAgent: params.userAgent,
          referrer: params.referrer,
          url: params.url,
          ipAddress: params.ipAddress,
          lastActivityAt: now,
          updatedAt: new Date(),
        })
        .returning({ id: schema.ChatSession.id, visitorId: schema.ChatSession.visitorId })

      // Create corresponding Thread
      const [newThread] = await tx
        .insert(schema.Thread)
        .values({
          externalId: newSession.id,
          subject: `Chat with ${params.visitorName || 'Visitor'} (${visitorIdentifier.substring(0, 6)})`,
          participantIds: [],
          organizationId: integration.organizationId,
          integrationId: integration.id,
          integrationType: IntegrationType.CHAT,
          messageType: MessageType.CHAT,
          status: ThreadStatus.OPEN,
          firstMessageAt: now,
          lastMessageAt: now,
        })
        .returning({ id: schema.Thread.id })

      // Link Thread to Session
      await tx
        .update(schema.ChatSession)
        .set({ threadId: newThread.id, updatedAt: new Date() })
        .where(eq(schema.ChatSession.id, newSession.id))

      // Create welcome message if configured
      if (integration.chatWidget?.welcomeMessage) {
        const [welcomeMsg] = await tx
          .insert(schema.ChatMessage)
          .values({
            sessionId: newSession.id,
            threadId: newThread.id,
            content: integration.chatWidget.welcomeMessage,
            sender: 'SYSTEM',
            status: 'DELIVERED',
            updatedAt: new Date(),
          })
          .returning({
            id: schema.ChatMessage.id,
            content: schema.ChatMessage.content,
            sender: schema.ChatMessage.sender,
            createdAt: schema.ChatMessage.createdAt,
            status: schema.ChatMessage.status,
          })

        // Add the formatted welcome message to the messages array
        messages.push({
          id: welcomeMsg.id,
          content: welcomeMsg.content,
          sender: welcomeMsg.sender as 'USER' | 'AGENT' | 'SYSTEM',
          timestamp: welcomeMsg.createdAt,
          status: welcomeMsg.status as 'SENT' | 'DELIVERED', // Map status
        })
      }

      return { sessionId: newSession.id, visitorId: newSession.visitorId, threadId: newThread.id }
    }) // End Transaction

    logger.info('Service: New chat session created successfully', {
      sessionId: result.sessionId,
      threadId: result.threadId,
    })

    // Call Post-Creation Steps (caching, notifications - NO welcome message sending)
    // Run async in background
    this.initializeSessionPostCreation({
      sessionId: result.sessionId,
      threadId: result.threadId,
      organizationId: integration.organizationId,
      widgetId: integration.chatWidget.id,
      visitorId: result.visitorId,
      visitorName: params.visitorName,
      visitorEmail: params.visitorEmail,
      url: params.url,
      referrer: params.referrer,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    }).catch((err) =>
      logger.error('Failed background post-creation steps', { sessionId: result.sessionId, err })
    )

    // Return new session details + potential welcome message
    return {
      sessionId: result.sessionId,
      threadId: result.threadId,
      visitorId: result.visitorId,
      messages: messages,
      isNewSession: true,
    }
  } // End initializeOrResumeSession method

  /**
   * Performs post-initialization tasks for a chat session after it's created
   * alongside its corresponding thread in the router. Caches the session,
   * sends welcome messages, and notifies the organization.
   * @param {object} params - Parameters for post-initialization.
   * @param {string} params.sessionId - The ID of the newly created ChatSession.
   * @param {string} params.threadId - The ID of the newly created Thread.
   * @param {string} params.organizationId - The organization ID.
   * @param {string} params.widgetId - The chat widget ID.
   * @param {string} params.visitorId - The visitor's identifier.
   * @param {string} [params.visitorName] - Optional visitor name.
   * @param {string} [params.visitorEmail] - Optional visitor email.
   * @returns {Promise<ChatSession>} The formatted and cached chat session details.
   */
  async initializeSessionPostCreation(params: {
    sessionId: string
    threadId: string
    organizationId: string
    widgetId: string
    visitorId: string
    visitorName?: string
    visitorEmail?: string
    // Include other relevant fields from session if needed: url, referrer, userAgent, ipAddress
    url?: string
    referrer?: string
    userAgent?: string
    ipAddress?: string
  }): Promise<ChatSession> {
    logger.info('Chat Service: Post-Initializing Session', {
      sessionId: params.sessionId,
      threadId: params.threadId,
      widgetId: params.widgetId,
    })

    try {
      // Fetch the widget to get welcome message etc.
      const widget = await this.db.query.ChatWidget.findFirst({
        where: (widgets, { eq }) => eq(widgets.id, params.widgetId),
      })
      if (!widget) throw new Error('Chat widget not found during post-init')

      // Session and Thread should exist from the router's transaction.
      // Construct the session object for caching based on input params and DB defaults.
      const now = new Date()
      const formattedSession: ChatSession = {
        id: params.sessionId,
        organizationId: params.organizationId,
        widgetId: params.widgetId,
        threadId: params.threadId, // Non-nullable after creation
        status: 'active', // Initial status
        createdAt: now, // Approximate, actual value is from DB
        lastActivityAt: now,
        visitorId: params.visitorId,
        visitorInfo:
          params.visitorName || params.visitorEmail
            ? { name: params.visitorName, email: params.visitorEmail }
            : undefined,
        url: params.url,
        referrer: params.referrer,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        closedAt: null,
        closedBy: null,
      }

      // Store session in Redis
      await setRedisData(`${KEYS.SESSION}${params.sessionId}`, formattedSession, SESSION_EXPIRATION)
      await this.addSessionToOrgList(params.organizationId, params.sessionId)

      // Send welcome message if configured
      // if (widget.welcomeMessage) {
      //   await this.sendSystemMessage({
      //     sessionId: params.sessionId,
      //     threadId: params.threadId,
      //     content: widget.welcomeMessage,
      //   })
      //   // sendSystemMessage now handles Pusher notification
      // }

      // Publish session creation event to organization channel via Pusher
      await this.realtimeService.sendToOrganization(params.organizationId, 'session-created', {
        sessionId: params.sessionId,
        threadId: params.threadId,
        createdAt: now,
        widgetId: params.widgetId,
        visitorId: params.visitorId,
        visitorName: params.visitorName,
        initialUrl: params.url,
        // Add other relevant details for agent dashboards
      })

      return formattedSession // Return the newly cached session info
    } catch (error) {
      logger.error('Error during chat service post-initialization', { error, params })
      throw error
    }
  }

  /**
   * Adds a session ID to the organization's set of active sessions in Redis.
   * @private
   * @param {string} organizationId - The organization ID.
   * @param {string} sessionId - The session ID to add.
   */
  private async addSessionToOrgList(organizationId: string, sessionId: string): Promise<void> {
    const redis = await getRedisClient()
    const key = `${KEYS.SESSION_LIST}${organizationId}`
    await redis.sadd(key, sessionId)
    // Consider setting an expiration on this list key if needed
  }

  /**
   * Removes a session ID from the organization's set of active sessions in Redis.
   * @private
   * @param {string} organizationId - The organization ID.
   * @param {string} sessionId - The session ID to remove.
   */
  private async removeSessionFromOrgList(organizationId: string, sessionId: string): Promise<void> {
    const redis = await getRedisClient()
    const key = `${KEYS.SESSION_LIST}${organizationId}`
    await redis.srem(key, sessionId)
  }

  /**
   * Retrieves a list of chat sessions for an organization, primarily for agent dashboards.
   * Fetches data directly from the database.
   * @param {string} organizationId - The organization ID.
   * @param {'active' | 'closed' | 'all'} [status='active'] - Filter sessions by status.
   * @returns {Promise<any[]>} A list of session objects with relevant details.
   */
  async getActiveSessions(
    organizationId: string,
    status: 'active' | 'closed' | 'all' = 'active'
  ): Promise<any[]> {
    // Consider defining a specific return type for dashboard use
    logger.info('Getting active sessions from DB', { organizationId, status })

    try {
      const dbSessions = await this.db.query.ChatSession.findMany({
        where: (sessions, { eq, and }) => {
          const conditions = [eq(sessions.organizationId, organizationId)]
          if (status !== 'all') {
            conditions.push(eq(sessions.status, status === 'active' ? 'ACTIVE' : 'CLOSED'))
          }
          return and(...conditions)
        },
        with: {
          widget: {
            columns: { name: true },
          },
          thread: {
            columns: {
              id: true,
              subject: true,
            },
            with: {
              chatMessages: {
                limit: 1,
                orderBy: (messages, { desc }) => [desc(messages.createdAt)],
                columns: {
                  content: true,
                  createdAt: true,
                  sender: true,
                },
                with: {
                  agent: {
                    columns: { name: true },
                  },
                },
              },
            },
          },
        },
        orderBy: (sessions, { desc }) => [desc(sessions.lastActivityAt)],
      })

      // Get message counts for each thread
      const messageCounts = new Map<string, number>()
      for (const session of dbSessions) {
        if (session.thread?.id) {
          const count = await this.db
            .select({ count: schema.ChatMessage.id })
            .from(schema.ChatMessage)
            .where(eq(schema.ChatMessage.threadId, session.thread.id))
          messageCounts.set(session.thread.id, count.length)
        }
      }

      // Format the sessions for client consumption
      return dbSessions.map((session: any) => {
        const lastDbMessage = session.thread?.chatMessages[0]
        let lastMessageSender: 'USER' | 'AGENT' | 'SYSTEM' | undefined
        if (lastDbMessage) {
          lastMessageSender = lastDbMessage.sender
        }

        return {
          id: session.id,
          organizationId: session.organizationId,
          widgetId: session.widgetId,
          status: session.status.toLowerCase() as 'active' | 'closed',
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          visitorId: session.visitorId,
          visitorName: session.visitorName, // Include name/email if available
          visitorEmail: session.visitorEmail,
          url: session.url || undefined,
          referrer: session.referrer || undefined,
          userAgent: session.userAgent || undefined,
          ipAddress: session.ipAddress || undefined,
          threadId: session.thread?.id, // Include threadId
          threadSubject: session.thread?.subject,
          widgetName: session.widget?.name,
          messageCount: messageCounts.get(session.thread?.id || '') ?? 0,
          lastMessage: lastDbMessage
            ? {
                content: lastDbMessage.content,
                createdAt: lastDbMessage.createdAt,
                sender: lastMessageSender,
                agent: {
                  id: lastDbMessage.agent?.id,
                  name: lastDbMessage.agent?.name,
                  image: lastDbMessage.agent?.image,
                },
              }
            : undefined,
        }
      })
    } catch (error) {
      logger.error('Error getting active sessions from DB', { error, organizationId })
      throw error
    }
  }

  /**
   * Updates the visitor's information for a given session in the database and cache,
   * and notifies the organization.
   * @param {string} sessionId - The ID of the session to update.
   * @param {ChatUserInfo} visitorInfo - The new visitor information.
   */
  async updateVisitorInfo(sessionId: string, visitorInfo: ChatUserInfo): Promise<void> {
    logger.info('Updating visitor info', { sessionId, visitorInfo })

    try {
      const session = await this.getSession(sessionId) // Use getSession to ensure it exists and get threadId
      if (!session) throw new Error('Session not found')

      // Update DB (ChatSession)
      await this.db
        .update(schema.ChatSession)
        .set({
          visitorName: visitorInfo.name,
          visitorEmail: visitorInfo.email,
          updatedAt: new Date(),
          // Consider updating a related Contact record here too if applicable
        })
        .where(eq(schema.ChatSession.id, sessionId))

      // Update Redis cache
      const sessionData = await getRedisData<ChatSession>(`${KEYS.SESSION}${sessionId}`)
      if (sessionData) {
        sessionData.visitorInfo = { ...(sessionData.visitorInfo ?? {}), ...visitorInfo }
        sessionData.visitorName = visitorInfo.name ?? sessionData.visitorName // Update top-level fields too
        sessionData.visitorEmail = visitorInfo.email ?? sessionData.visitorEmail
        await setRedisData(
          `${KEYS.SESSION}${sessionId}`,
          sessionData,
          SESSION_EXPIRATION // Refresh expiration
        )
      }

      // Publish update event to organization channel via Pusher
      await this.realtimeService.sendToOrganization(session.organizationId, 'visitor-updated', {
        sessionId,
        threadId: session.threadId, // Include threadId for context
        visitorInfo,
        createdAt: new Date(),
      })
    } catch (error) {
      logger.error('Error updating visitor info', { error, sessionId, visitorInfo })
      throw error
    }
  }

  /**
   * Retrieves a specific chat session, trying the Redis cache first, then the database.
   * Refreshes cache expiration on hit. Caches if retrieved from DB.
   * @param {string} sessionId - The ID of the session to retrieve.
   * @returns {Promise<ChatSession | null>} The chat session details or null if not found.
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const cacheKey = `${KEYS.SESSION}${sessionId}`
    try {
      // Try Redis first
      const cachedData = await getRedisData<ChatSession>(cacheKey)
      if (cachedData) {
        logger.debug('Cache hit for session', { sessionId })
        // Refresh expiration on access
        await setRedisData(cacheKey, cachedData, SESSION_EXPIRATION)
        return cachedData
      }

      logger.debug('Cache miss for session, fetching from DB', { sessionId })
      // Fall back to database
      const session = await this.db.query.ChatSession.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, sessionId),
        with: {
          closedBy: {
            columns: { id: true, name: true },
          },
        }, // Fetch closer agent name if needed
      })

      if (!session) {
        logger.warn('Session not found in DB', { sessionId })
        return null
      }

      // Format the session
      const formattedSession: ChatSession = {
        id: session.id,
        organizationId: session.organizationId,
        widgetId: session.widgetId,
        threadId: session.threadId, // Include threadId
        status: session.status.toLowerCase() as 'active' | 'closed',
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        visitorId: session.visitorId,
        visitorInfo:
          session.visitorName || session.visitorEmail
            ? { name: session.visitorName ?? undefined, email: session.visitorEmail ?? undefined }
            : undefined,
        url: session.url ?? undefined,
        referrer: session.referrer ?? undefined,
        userAgent: session.userAgent ?? undefined,
        ipAddress: session.ipAddress ?? undefined,
        closedAt: session.closedAt ?? undefined,
        closedBy: session.closedBy
          ? { id: session.closedBy.id, name: session.closedBy.name ?? 'Agent' }
          : undefined,
      }

      // Cache in Redis for future requests
      await setRedisData(cacheKey, formattedSession, SESSION_EXPIRATION)
      logger.debug('Session cached after DB fetch', { sessionId })

      return formattedSession
    } catch (error) {
      logger.error('Error getting session', { error, sessionId })
      // Don't re-throw here, let callers handle null return
      return null
    }
  }

  /**
   * Closes a chat session in the database and cache, updates the related thread status,
   * and notifies both the organization and the specific client widget.
   * @param {string} sessionId - The ID of the session to close.
   * @param {string} userId - The ID of the user (agent) closing the session.
   */
  async closeSession(sessionId: string, userId: string): Promise<void> {
    logger.info('Closing chat session', { sessionId, userId })

    // try {
    // Use getSession to fetch details including threadId and ensure it exists
    const session = await this.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.status === 'closed') {
      logger.warn('Attempted to close an already closed session', { sessionId })
      return // Already closed, nothing to do
    }
    if (!session.threadId)
      throw new Error(`Session ${sessionId} is missing threadId, cannot close properly.`)

    const now = new Date()

    // Update DB (ChatSession + Thread) in a transaction
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.ChatSession)
        .set({ status: 'CLOSED', closedAt: now, closedById: userId, updatedAt: new Date() })
        .where(eq(schema.ChatSession.id, sessionId))

      await tx
        .update(schema.Thread)
        .set({ status: 'CLOSED', closedAt: now, updatedAt: new Date() }) // Ensure thread status is also updated
        .where(eq(schema.Thread.id, session.threadId!)) // Use non-null assertion as we checked above
    })

    // Get agent information for notifications
    const agent = await this.db.query.User.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
      columns: { id: true, name: true },
    })
    const closedByName = agent?.name ?? 'Agent'

    // Remove session from Redis cache and active list
    await deleteRedisData(`${KEYS.SESSION}${sessionId}`)
    await this.removeSessionFromOrgList(session.organizationId, sessionId)
    logger.info('Session removed from Redis cache and active list', { sessionId })
    // logger.error('Session closed', {realtime: }
    console.error('realtimeService', this.realtimeService)
    // Publish closure event to organization channel via Pusher (for agent dashboards)
    await this.realtimeService.sendToOrganization(session.organizationId, 'session-closed', {
      sessionId,
      threadId: session.threadId,
      closedBy: { id: userId, name: closedByName },
      createdAt: now,
    })

    // Notify the specific client widget via Pusher
    await this.realtimeService.sendToChat(
      sessionId,
      'session-closed', // Event name widget listens for
      { closedBy: { id: userId, name: closedByName }, createdAt: now }
    )
    logger.info('Session closure notifications sent', { sessionId })
    // } catch (error) {
    //   logger.error('Error closing chat session', { error, sessionId, userId })
    //   throw error
    // }
  }

  /**
   * Sends a message from the user (chat widget). Creates the message record,
   * links it to the session and thread, updates activity timestamps, and notifies
   * the client (confirmation and new message) and organization via Pusher.
   * @param {object} params - Message parameters.
   * @param {string} params.sessionId - Session ID.
   * @param {string} params.threadId - Thread ID.
   * @param {string} params.content - Message text.
   * @param {string} [params.clientMessageId] - Optional ID generated by the client for confirmation matching.
   * @param {string[]} [params.attachmentIds] - Optional IDs of pre-uploaded attachments.
   * @returns {Promise<ChatMessage>} The created and formatted chat message.
   */
  async sendUserMessage(params: {
    sessionId: string
    threadId: string
    content: string
    clientMessageId?: string
    attachmentIds?: string[]
  }): Promise<ChatMessage> {
    logger.info('Sending user message', {
      sessionId: params.sessionId,
      threadId: params.threadId,
      clientMessageId: params.clientMessageId,
    })

    try {
      const session = await this.getSession(params.sessionId)
      if (!session || session.status === 'closed') {
        throw new Error('Session not found or is closed')
      }
      if (session.threadId !== params.threadId) {
        logger.error('Thread ID mismatch in sendUserMessage', {
          paramThreadId: params.threadId,
          sessionThreadId: session.threadId,
        })
        throw new Error('Session and Thread ID mismatch')
      }

      const messageId = params.clientMessageId || uuidv4()
      const now = new Date()

      // Create message in DB, linking to Thread and Session
      const [message] = await this.db
        .insert(schema.ChatMessage)
        .values({
          id: messageId,
          content: params.content,
          sender: 'USER',
          status: 'DELIVERED',
          sessionId: params.sessionId,
          threadId: params.threadId,
          updatedAt: new Date(),
          // attachments: params.attachmentIds ? { connect: params.attachmentIds.map((id) => ({ id })) } : undefined,
        })
        .returning({
          id: schema.ChatMessage.id,
          sessionId: schema.ChatMessage.sessionId,
          threadId: schema.ChatMessage.threadId,
          content: schema.ChatMessage.content,
          createdAt: schema.ChatMessage.createdAt,
        })

      // Update Thread and Session last activity
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ChatSession)
          .set({ lastActivityAt: now, updatedAt: new Date() })
          .where(eq(schema.ChatSession.id, params.sessionId))

        await tx
          .update(schema.Thread)
          .set({ lastMessageAt: now, status: 'OPEN', updatedAt: new Date() })
          .where(eq(schema.Thread.id, params.threadId))
      })

      // Format message
      const formattedMessage: ChatMessage = {
        id: message.id,
        sessionId: message.sessionId,
        threadId: message.threadId,
        content: message.content,
        sender: 'USER',
        createdAt: message.createdAt,
        status: 'delivered',
        attachments: [], // Placeholder
      }

      // Publish message to the specific chat channel via Pusher
      await this.realtimeService.sendToChat(params.sessionId, 'new-message', formattedMessage)

      // Publish message confirmation back to the sender via Pusher if client ID was provided
      if (params.clientMessageId) {
        await this.realtimeService.sendToChat(params.sessionId, 'message-sent', {
          clientMessageId: params.clientMessageId,
          messageId: message.id,
          status: formattedMessage.status,
          createdAt: formattedMessage.createdAt,
        })
        logger.debug('Sent message confirmation to client', {
          clientMessageId: params.clientMessageId,
          messageId: message.id,
        })
      }

      // Notify organization channel (for agents) via Pusher
      await this.realtimeService.sendToOrganization(session.organizationId, 'new-chat-message', {
        sessionId: params.sessionId,
        threadId: params.threadId,
        message: formattedMessage,
      })

      return formattedMessage
    } catch (error: any) {
      logger.error('Error sending user message', {
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
        sessionId: params.sessionId,
        threadId: params.threadId,
        clientMessageId: params.clientMessageId,
      })
      // Attempt to notify client about the error
      if (params.clientMessageId && params.sessionId) {
        try {
          const currentSession = await this.getSession(params.sessionId) // Check session still exists
          if (currentSession) {
            await this.realtimeService.sendToChat(params.sessionId, 'message-error', {
              clientMessageId: params.clientMessageId,
              error: 'Failed to send message.',
              createdAt: new Date(),
            })
            logger.warn('Sent message error notification to client', {
              clientMessageId: params.clientMessageId,
            })
          } else {
            logger.warn('Cannot send message error notification, session not found', {
              sessionId: params.sessionId,
            })
          }
        } catch (notifyError) {
          logger.error('Failed to send message error notification', {
            notifyError,
            sessionId: params.sessionId,
          })
        }
      }
      throw error // Re-throw for tRPC layer
    }
  }

  /**
   * Sends a message from an agent. Creates the message record, links it, updates
   * activity timestamps, and notifies the specific client widget via Pusher.
   * @param {object} params - Message parameters.
   * @param {string} params.sessionId - Session ID.
   * @param {string} params.threadId - Thread ID.
   * @param {string} params.agentId - ID of the sending agent.
   * @param {string} params.content - Message text.
   * @param {string[]} [params.attachmentIds] - Optional IDs of pre-uploaded attachments.
   * @returns {Promise<ChatMessage>} The created and formatted chat message.
   */
  async sendAgentMessage(params: {
    sessionId: string
    // threadId: string
    // agentId: string
    content: string
    agent: Pick<User, 'id' | 'name' | 'image'> // Agent details
    attachmentIds?: string[]
  }): Promise<ChatMessage> {
    const { agent, content, sessionId } = params
    logger.info('Sending agent message', { sessionId, agentId: agent.id })

    try {
      const session = await this.getSession(sessionId)
      if (!session || session.status === 'closed') {
        throw new Error('Session not found or is closed')
      }
      // if (session.threadId !== threadId) {
      //   logger.error('Thread ID mismatch in sendAgentMessage', {
      //     paramThreadId: threadId,
      //     sessionThreadId: threadId,
      //   })
      //   throw new Error('Session and Thread ID mismatch')
      // }

      // const agent = await this.db.user.findUnique({
      //   where: { id: params.agentId },
      //   select: { id: true, name: true, image: true },
      // })
      // if (!agent) throw new Error('Agent not found')
      // Optional: Add organization membership check here

      const messageId = uuidv4()
      const now = new Date()

      // Create message in DB
      const [message] = await this.db
        .insert(schema.ChatMessage)
        .values({
          id: messageId,
          content,
          sender: 'AGENT',
          agentId: agent.id, // Link agent
          status: 'DELIVERED',
          sessionId: sessionId,
          threadId: session.threadId!,
          updatedAt: new Date(),
          // attachments: params.attachmentIds ? { connect: params.attachmentIds.map((id) => ({ id })) } : undefined,
        })
        .returning({
          id: schema.ChatMessage.id,
          content: schema.ChatMessage.content,
          createdAt: schema.ChatMessage.createdAt,
        })

      // Update Thread and Session last activity
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ChatSession)
          .set({ lastActivityAt: now, updatedAt: new Date() })
          .where(eq(schema.ChatSession.id, sessionId))

        await tx
          .update(schema.Thread)
          .set({ lastMessageAt: now, updatedAt: new Date() })
          .where(eq(schema.Thread.id, session.threadId!))
      })

      // Format message
      const formattedMessage: ChatMessage = {
        id: message.id,
        sessionId,
        threadId: session.threadId!,
        content,
        sender: 'AGENT',
        createdAt: message.createdAt,
        status: 'delivered',
        agent: { id: agent.id, name: agent.name ?? undefined, avatar: agent.image ?? undefined },
        // agentId: agent.id,
        // agentName: agent.name ?? undefined,
        // agentAvatar: agent.image ?? undefined,
        attachments: [], // Placeholder
      }

      // Publish message to the specific chat channel via Pusher
      await this.realtimeService.sendToChat(sessionId, 'new-message', formattedMessage)

      return formattedMessage
    } catch (error) {
      logger.error('Error sending agent message', { error, ...params })
      throw error
    }
  }

  /**
   * Sends a system message (e.g., welcome, status update). Creates the message record,
   * links it, and notifies the client widget and potentially the organization via Pusher.
   * @param {object} params - Message parameters.
   * @param {string} params.sessionId - Session ID.
   * @param {string} params.threadId - Thread ID.
   * @param {string} params.content - Message text.
   * @returns {Promise<ChatMessage>} The created and formatted chat message.
   */
  async sendSystemMessage(params: {
    sessionId: string
    threadId: string
    content: string
  }): Promise<ChatMessage> {
    logger.info('Sending system message', { sessionId: params.sessionId, content: params.content })

    try {
      const session = await this.getSession(params.sessionId) // Get session for orgId
      if (!session) throw new Error('Session not found for system message')
      if (session.threadId !== params.threadId) {
        logger.error('Thread ID mismatch in sendSystemMessage', {
          paramThreadId: params.threadId,
          sessionThreadId: session.threadId,
        })
        throw new Error('Session and Thread ID mismatch for system message')
      }

      const messageId = uuidv4()

      // Create message in DB
      const [message] = await this.db
        .insert(schema.ChatMessage)
        .values({
          id: messageId,
          content: params.content,
          sender: 'SYSTEM',
          status: 'DELIVERED',
          sessionId: params.sessionId,
          threadId: params.threadId,
          updatedAt: new Date(),
        })
        .returning({
          id: schema.ChatMessage.id,
          sessionId: schema.ChatMessage.sessionId,
          threadId: schema.ChatMessage.threadId,
          content: schema.ChatMessage.content,
          createdAt: schema.ChatMessage.createdAt,
        })

      // Format message
      const formattedMessage: ChatMessage = {
        id: message.id,
        sessionId: message.sessionId,
        threadId: message.threadId,
        content: message.content,
        sender: 'SYSTEM',
        createdAt: message.createdAt,
        status: 'delivered',
      }

      // Publish message to the specific chat channel via Pusher
      await this.realtimeService.sendToChat(params.sessionId, 'new-message', formattedMessage)

      // Optionally notify organization if agents need to see system messages
      await this.realtimeService.sendToOrganization(
        session.organizationId,
        'new-system-message', // Use a distinct event or reuse 'new-chat-message'
        { sessionId: params.sessionId, threadId: params.threadId, message: formattedMessage }
      )

      return formattedMessage
    } catch (error) {
      logger.error('Error sending system message', { error, ...params })
      throw error
    }
  }

  /**
   * Retrieves the message history for a chat session by querying messages
   * linked to its corresponding thread.
   * @param {string} sessionId - The ID of the session.
   * @returns {Promise<ChatMessage[]>} An array of formatted chat messages, ordered by creation time.
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    logger.info('Getting messages from DB via Thread', { sessionId })

    try {
      // Get session to find the mandatory threadId
      const session = await this.getSession(sessionId)
      if (!session?.threadId) {
        logger.warn('Session or threadId not found when getting messages', { sessionId })
        return [] // Return empty if threadId is missing; cannot fetch messages
      }

      // Fetch messages using the threadId
      const messages = await this.db.query.ChatMessage.findMany({
        where: (chatMessages, { eq }) => eq(chatMessages.threadId, session.threadId!),
        with: {
          // attachments: true, // Include if attachments are implemented
          agent: {
            columns: { id: true, name: true, image: true },
          }, // Agent details
        },
        orderBy: (chatMessages, { asc }) => [asc(chatMessages.createdAt)],
      })

      // Format messages
      const formattedMessages: ChatMessage[] = messages.map((message) => ({
        id: message.id,
        sessionId: message.sessionId, // Keep session id for context if needed client-side
        threadId: message.threadId,
        content: message.content,
        sender: message.sender, //.toLowerCase() as 'user' | 'agent' | 'system',
        createdAt: message.createdAt,
        status: message.status.toLowerCase() as any, // Adjust status enum/type if needed
        agent: {
          id: message.agentId ?? undefined,
          name: message.agent?.name ?? undefined,
          image: message.agent?.image ?? undefined,
        },
        // agentId: message.agentId ?? undefined,
        // agentName: message.agent?.name ?? undefined,
        // agentAvatar: message.agent?.image ?? undefined,
        attachments: [], // Placeholder, populate if attachments included
      }))

      // Message caching is currently disabled. Uncomment Redis logic if needed.
      // logger.debug(`Fetched ${formattedMessages.length} messages for session`, { sessionId });
      // await this.setMessagesInRedis(sessionId, formattedMessages); // Optional caching

      return formattedMessages
    } catch (error) {
      logger.error('Error getting messages', { error, sessionId })
      throw error
    }
  }

  /**
   * Adds a message to the Redis cache for a session. (Currently Optional)
   * @private
   */
  private async addMessageToRedis(_sessionId: string, _message: ChatMessage): Promise<void> {
    // Implementation depends on whether you store messages as a list or individual keys.
    // Example (storing as list):
    /*
      const key = `${KEYS.SESSION_MESSAGES}${sessionId}`;
      try {
          const redis = await getRedisClient();
          // Append to list and trim if necessary
          await redis.rpush(key, JSON.stringify(message));
          // Optional: Trim list to keep only N recent messages
          // await redis.ltrim(key, -MAX_CACHED_MESSAGES, -1);
          await redis.expire(key, MESSAGE_EXPIRATION); // Reset/set expiration
      } catch (error) {
          logger.error("Failed to add message to Redis cache", { error, sessionId });
      }
      */
    logger.warn('Redis message caching (addMessageToRedis) is not fully implemented/enabled.')
  }

  /**
   * Retrieves messages from the Redis cache. (Currently Disabled)
   * @private
   */
  private async getMessagesFromRedis(_sessionId: string): Promise<ChatMessage[] | null> {
    // Return null to indicate cache miss or disabled cache
    logger.warn('Redis message caching (getMessagesFromRedis) is not enabled.')
    return null
    /*
     const key = `${KEYS.SESSION_MESSAGES}${sessionId}`;
     try {
         const redis = await getRedisClient();
         const data = await redis.lrange(key, 0, -1); // Get all messages
         if (data && data.length > 0) {
             await redis.expire(key, MESSAGE_EXPIRATION); // Refresh expiration on access
             return data.map(item => JSON.parse(item));
         }
         return null;
     } catch (error) {
         logger.error("Failed to get messages from Redis cache", { error, sessionId });
         return null;
     }
     */
  }

  /**
   * Sets the entire message list in the Redis cache. (Currently Optional)
   * @private
   */
  private async setMessagesInRedis(_sessionId: string, _messages: ChatMessage[]): Promise<void> {
    // Used if fetching from DB and wanting to populate cache.
    /*
     const key = `${KEYS.SESSION_MESSAGES}${sessionId}`;
     try {
         const redis = await getRedisClient();
         const pipeline = redis.pipeline();
         pipeline.del(key); // Clear existing list
         if (messages.length > 0) {
            pipeline.rpush(key, ...messages.map(m => JSON.stringify(m))); // Add all messages
         }
         pipeline.expire(key, MESSAGE_EXPIRATION);
         await pipeline.exec();
     } catch (error) {
         logger.error("Failed to set messages in Redis cache", { error, sessionId });
     }
     */
    logger.warn('Redis message caching (setMessagesInRedis) is not fully implemented/enabled.')
  }

  /**
   * Notifies the chat channel and organization channel when a user starts or stops typing.
   * @param {string} sessionId - The session ID.
   * @param {boolean} isTyping - True if the user is typing, false otherwise.
   */
  async setUserTyping(sessionId: string, isTyping: boolean): Promise<void> {
    // Don't log every typing event to avoid spam, but handle errors
    try {
      const session = await this.getSession(sessionId)
      if (!session?.threadId) {
        logger.warn('Cannot send user typing event, session or threadId not found', { sessionId })
        return
      }

      // Publish typing status to the specific chat channel via Pusher
      await this.realtimeService.sendToChat(
        sessionId,
        'typing', // Event name widget listens for
        { sessionId, threadId: session.threadId, isTyping, sender: 'USER', createdAt: new Date() }
      )
      // Also notify organization channel if agents need to see user typing indicator
      await this.realtimeService.sendToOrganization(
        session.organizationId,
        'user-typing', // Specific event for agents
        {
          sessionId,
          threadId: session.threadId,
          isTyping,
          visitorName: session.visitorName ?? session.visitorId, // Add context for agent
        }
      )
    } catch (error) {
      logger.error('Error setting user typing', { error, sessionId, isTyping })
    }
  }

  /**
   * Notifies the chat channel when an agent starts or stops typing.
   * @param {string} sessionId - The session ID.
   * @param {string} agentId - The ID of the typing agent.
   * @param {boolean} isTyping - True if the agent is typing, false otherwise.
   */
  async setAgentTyping(sessionId: string, agentId: string, isTyping: boolean): Promise<void> {
    // Don't log every event, but handle errors
    try {
      const session = await this.getSession(sessionId)
      if (!session?.threadId) {
        logger.warn('Cannot send agent typing event, session or threadId not found', { sessionId })
        return
      }

      // Get agent details for the notification
      const agent = await this.db.query.User.findFirst({
        where: (users, { eq }) => eq(users.id, agentId),
        columns: { name: true },
      })

      // Publish typing status to chat channel via Pusher
      await this.realtimeService.sendToChat(
        sessionId,
        'typing', // Event name widget listens for
        {
          sessionId,
          threadId: session.threadId,
          isTyping,
          sender: 'AGENT',
          agent: {
            id: agentId,
            name: agent?.name ?? 'Agent', // Use agent name or fallback
          },
          // agentId: agentId,
          // agentName: agent?.name ?? 'Agent', // Use agent name or fallback
          createdAt: new Date(),
        }
      )
      // No need to notify organization channel, agent initiated it.
      // Other agents viewing the same chat would get the 'typing' event via sendToChat if they are subscribed.
    } catch (error) {
      logger.error('Error setting agent typing', { error, sessionId, agentId, isTyping })
    }
  }

  /**
   * Marks USER messages in a thread as READ in the database. Optionally notifies
   * the client widget and the organization channel.
   * @param {string} sessionId - The session ID containing the messages.
   * @param {string} agentId - The ID of the agent who read the messages.
   */
  async markMessagesAsRead(sessionId: string, agentId: string): Promise<void> {
    logger.info('Marking messages as read by agent', { sessionId, agentId })

    try {
      const session = await this.getSession(sessionId)
      if (!session?.threadId)
        throw new Error('Session or threadId not found for marking messages read')

      // Update DB: Mark USER messages in the specific thread as READ
      const updateResult = await this.db
        .update(schema.ChatMessage)
        .set({ status: 'READ', updatedAt: new Date() })
        .where(
          and(
            eq(schema.ChatMessage.threadId, session.threadId!), // Target the specific thread
            eq(schema.ChatMessage.sender, 'USER'),
            ne(schema.ChatMessage.status, 'READ')
          )
        )

      logger.info(`Marked ${updateResult.count} user messages as read in thread`, {
        threadId: session.threadId,
        agentId,
      })

      // Redis cache update would go here if message caching is enabled

      // Notify ORGANIZATION that messages were read (for agent dashboard updates)
      await this.realtimeService.sendToOrganization(session.organizationId, 'chat-messages-read', {
        sessionId,
        threadId: session.threadId,
        reader: 'agent', // Indicate agent read them
        readerId: agentId,
        createdAt: new Date(),
      })

      // Optional: Notify client widget. Generally not needed for agent reads.
      /*
      await this.realtimeService.sendToChat(
        sessionId,
        'messages-read-by-agent', // Specific event if client needs it
        { agentId, timestamp: new Date() }
      )
      */
    } catch (error) {
      logger.error('Error marking messages as read by agent', { error, sessionId, agentId })
      throw error
    }
  }

  /**
   * Handles the upload of a file attachment. In a real implementation, this would
   * involve saving the file to cloud storage (e.g., S3) and then creating a
   * database record with metadata and the storage URL.
   * @param {object} params - Attachment upload parameters.
   * @returns {Promise<ChatAttachment>} Metadata of the uploaded attachment.
   */
  async uploadAttachment(params: {
    sessionId: string
    fileName: string
    fileType: string
    fileSize: number
    fileBuffer: Buffer // In a real app, this might be a stream or handled differently
  }): Promise<ChatAttachment> {
    logger.info('Uploading attachment (placeholder logic)', {
      sessionId: params.sessionId,
      fileName: params.fileName,
      fileSize: params.fileSize,
    })

    try {
      const session = await this.getSession(params.sessionId)
      if (!session?.threadId) throw new Error('Session or threadId not found for attachment upload')

      // --- Placeholder for actual file upload logic ---
      // 1. Upload params.fileBuffer to S3/Cloud Storage
      // 2. Get the public URL or signed URL for the uploaded file
      const storageUrl = `https://storage.example.com/chat-attachments/${uuidv4()}/${encodeURIComponent(params.fileName)}` // Replace with real URL
      // --- End Placeholder ---

      // Create attachment metadata record in database
      const [attachment] = await this.db
        .insert(schema.ChatAttachment)
        .values({
          filename: params.fileName,
          contentType: params.fileType,
          size: params.fileSize,
          url: storageUrl, // Store the actual URL from storage
          // Link to session and thread for context
          sessionId: params.sessionId,
          updatedAt: new Date(),
          // Optional: Link to a specific message if uploaded *with* a message
          // messageId: messageId
        })
        .returning({
          id: schema.ChatAttachment.id,
          filename: schema.ChatAttachment.filename,
          url: schema.ChatAttachment.url,
          size: schema.ChatAttachment.size,
          contentType: schema.ChatAttachment.contentType,
        })

      // Format and return attachment info
      return {
        id: attachment.id,
        name: attachment.filename,
        url: attachment.url,
        size: attachment.size,
        type: attachment.contentType,
      }
    } catch (error) {
      logger.error('Error uploading attachment', {
        error,
        sessionId: params.sessionId,
        fileName: params.fileName,
      })
      throw error
    }
  }
} // End ChatService Class

/**
 * Factory function to create an instance of ChatService with dependencies.
 * @param {Database} db - The Drizzle database client.
 * @param {RealTimeService} realtimeService - The instance of the real-time service.
 * @returns {ChatService} A new ChatService instance.
 */
export function createChatService(db: Database, realtimeService: RealTimeService): ChatService {
  logger.info('Creating ChatService instance')
  return new ChatService(db, realtimeService)
}
// Export the ChatService class for use in other modules
