// packages/lib/src/ai-features/compose/ai-compose.service.ts
import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Message } from '../../ai/clients/base/types'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import type { LLMInvocationRequest } from '../../ai/orchestrator/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { createScopedLogger } from '../../logger'
import { MessageQueryService } from '../../messages/message-query.service'
import { formatThreadContext, getPrompt } from './prompts'
import {
  AI_OPERATION,
  type AIComposeRequest,
  type AIComposeResponse,
  type AIOperation,
  OUTPUT_FORMAT,
  type OutputFormat,
} from './types'
import { convertHtmlToTiptap, stripHtml } from './utils'

const logger = createScopedLogger('ai-compose-service')

interface AIComposeConfig {
  maxContextMessages?: number
  maxTokensPerMessage?: number
  defaultModel?: string
  defaultProvider?: string
}

export class AIComposeService {
  private llmOrchestrator: LLMOrchestrator
  private usageService: UsageTrackingService
  private config: Required<AIComposeConfig>

  constructor(
    private db: Database,
    config?: Partial<AIComposeConfig>
  ) {
    this.config = {
      maxContextMessages: 5,
      maxTokensPerMessage: 500,
      defaultModel: 'gpt-4o-mini',
      defaultProvider: 'openai',
      ...config,
    }

    this.usageService = new UsageTrackingService(db)
    this.llmOrchestrator = new LLMOrchestrator(
      this.usageService,
      db,
      {
        enableUsageTracking: true,
        defaultProvider: this.config.defaultProvider,
        defaultModel: this.config.defaultModel,
      },
      logger
    )
  }

  /**
   * Process an AI compose request
   */
  async processRequest(
    request: AIComposeRequest,
    organizationId: string,
    userId: string
  ): Promise<AIComposeResponse> {
    const startTime = Date.now()

    try {
      logger.info('Processing AI compose request', {
        operation: request.operation,
        organizationId,
        userId,
        hasEntityId: !!request.entityId,
      })

      // Get thread context if needed for compose operation
      let threadContext: ThreadContext | undefined
      if (request.operation === AI_OPERATION.COMPOSE && request.entityId) {
        threadContext = await this.getThreadContext(request.entityId, organizationId, userId)
      }

      // Build messages for LLM
      const messages = await this.buildMessages(request, threadContext)

      // Get completion parameters
      const parameters = this.getCompletionParameters(request.operation)

      // Create LLM invocation request
      const invocationRequest: LLMInvocationRequest = {
        model: this.config.defaultModel,
        provider: this.config.defaultProvider,
        messages,
        parameters,
        organizationId,
        userId,
        context: {
          source: 'compose',
          operation: request.operation,
          entityType: request.entityType,
          entityId: request.entityId,
        },
      }

      // Invoke LLM
      const response = await this.llmOrchestrator.invoke(invocationRequest)

      // Check for ERROR response indicating gibberish input
      if (response.content.trim() === 'ERROR') {
        const errorMessage = this.getErrorMessage(request.operation)
        throw new Error(errorMessage)
      }

      // Format the response
      const formattedContent = await this.formatOutput(response.content, request.output)

      const processingTime = Date.now() - startTime

      logger.info('AI compose request completed', {
        operation: request.operation,
        processingTime,
        tokensUsed: response.usage?.total_tokens,
      })

      return {
        content: formattedContent,
        format: request.output,
        operation: request.operation,
        metadata: {
          tokensUsed: response.usage?.total_tokens,
          model: response.model,
          processingTime,
        },
      }
    } catch (error) {
      logger.error('AI compose request failed', {
        operation: request.operation,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Get thread context using MessageQueryService and simple thread query
   */
  private async getThreadContext(
    threadId: string,
    organizationId: string,
    _userId: string
  ): Promise<ThreadContext> {
    try {
      // Get messages using MessageQueryService
      const messageQuery = new MessageQueryService(organizationId, this.db)
      const { messages: rawMessages } = await messageQuery.getMessagesByThread(threadId)

      // Get thread subject with simple query
      const [thread] = await this.db
        .select({ id: schema.Thread.id, subject: schema.Thread.subject })
        .from(schema.Thread)
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId))
        )
        .limit(1)

      if (!thread) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Take only the most recent messages for context
      const recentMessages = rawMessages.slice(-this.config.maxContextMessages)

      // Format messages for context
      const messages = recentMessages.map((msg) => ({
        id: msg.id,
        content: msg.textPlain || stripHtml(msg.textHtml || msg.snippet || ''),
        sender: msg.isInbound ? 'Customer' : 'Agent',
        timestamp: msg.sentAt ? new Date(msg.sentAt) : new Date(),
        type: msg.isInbound ? ('received' as const) : ('sent' as const),
      }))

      return {
        threadId: thread.id,
        subject: thread.subject || undefined,
        messages,
      }
    } catch (error) {
      logger.error('Failed to get thread context', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Build messages array for LLM
   */
  private async buildMessages(
    request: AIComposeRequest,
    threadContext?: ThreadContext
  ): Promise<Message[]> {
    const messages: Message[] = []

    // Prepare content - send raw HTML to AI for better structure preservation
    const content = request.messageHtml || ''
    const context = threadContext
      ? {
          previousMessages: formatThreadContext(
            threadContext.messages,
            this.config.maxContextMessages
          ),
          subject: threadContext.subject,
        }
      : undefined

    // Get prompts based on operation
    const prompts = getPrompt(request.operation, content, {
      tone: request.tone,
      language: request.language,
      context,
    })

    // Add system and user messages
    messages.push({
      role: 'system',
      content: prompts.system,
    })

    messages.push({
      role: 'user',
      content: prompts.user,
    })

    return messages
  }

  /**
   * Get error message for failed operations
   */
  private getErrorMessage(operation: AIOperation): string {
    switch (operation) {
      case AI_OPERATION.EXPAND:
        return 'Unable to expand'
      case AI_OPERATION.SHORTEN:
        return 'Unable to shorten'
      case AI_OPERATION.TONE:
        return 'Unable to adjust tone'
      case AI_OPERATION.TRANSLATE:
        return 'Unable to translate'
      case AI_OPERATION.FIX_GRAMMAR:
        return 'Unable to fix grammar'
      case AI_OPERATION.COMPOSE:
        return 'Unable to compose'
      default:
        return 'AI operation failed'
    }
  }

  /**
   * Get completion parameters for operation
   */
  private getCompletionParameters(operation: AIOperation): Record<string, any> {
    const baseParams = {
      max_tokens: 1000,
      temperature: 0.7,
    }

    const operationParams: Record<AIOperation, any> = {
      [AI_OPERATION.COMPOSE]: {
        ...baseParams,
        temperature: 0.7,
        max_tokens: 1500,
      },
      [AI_OPERATION.TONE]: {
        ...baseParams,
        temperature: 0.6,
        max_tokens: 1200,
      },
      [AI_OPERATION.TRANSLATE]: {
        ...baseParams,
        temperature: 0.3,
        max_tokens: 1500,
      },
      [AI_OPERATION.FIX_GRAMMAR]: {
        ...baseParams,
        temperature: 0.2,
        max_tokens: 1000,
      },
      [AI_OPERATION.EXPAND]: {
        ...baseParams,
        temperature: 0.7,
        max_tokens: 2000,
      },
      [AI_OPERATION.SHORTEN]: {
        ...baseParams,
        temperature: 0.5,
        max_tokens: 500,
      },
    }

    return operationParams[operation] || baseParams
  }

  /**
   * Format output based on requested format
   */
  private async formatOutput(content: string, format: OutputFormat): Promise<string> {
    switch (format) {
      case OUTPUT_FORMAT.RAW:
        return content.trim()

      case OUTPUT_FORMAT.HTML:
        // Trust the AI to return proper HTML
        return content.trim()

      case OUTPUT_FORMAT.EDITOR: {
        // Convert to TipTap JSON format
        const htmlContent = await this.formatOutput(content, OUTPUT_FORMAT.HTML)
        return JSON.stringify(convertHtmlToTiptap(htmlContent))
      }

      default:
        return content
    }
  }
}

// Singleton instance
let serviceInstance: AIComposeService | null = null

export function getAIComposeService(
  db: Database,
  config?: Partial<AIComposeConfig>
): AIComposeService {
  if (!serviceInstance) {
    serviceInstance = new AIComposeService(db, config)
  }
  return serviceInstance
}

// Type definitions for internal use
interface ThreadContext {
  threadId: string
  subject?: string
  messages: Array<{
    id: string
    content: string
    sender: string
    timestamp: Date
    type: 'sent' | 'received'
  }>
}
