// packages/lib/src/chat/chat-widget-service.ts
import { schema, type Database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '../logger'
import { env } from '@auxx/config/server'
import { WidgetPosition } from '../widgets/types'
import { databaseErrorCodes } from '../errors'

const logger = createScopedLogger('chat-widget-service')

/** Type alias representing insert payload for ChatWidget */
type ChatWidgetInsert = typeof schema.ChatWidget.$inferInsert

/**
 * Interface for adding a chat widget
 */
interface AddChatWidgetInput {
  name: string
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
  inboxId?: string
}

/**
 * Interface for updating a chat widget
 */
interface UpdateChatWidgetInput extends Partial<AddChatWidgetInput> {}

/**
 * Custom error class for chat widget-related errors
 */
class ChatWidgetError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'ChatWidgetError'
  }
}

/**
 * Service for managing chat widget integrations
 */
export class ChatWidgetService {
  private db: Database
  private organizationId: string

  constructor(db: Database, organizationId: string) {
    this.db = db
    this.organizationId = organizationId
  }

  /**
   * Validate that an inbox belongs to the organization
   */
  private async validateInbox(inboxId: string) {
    const inbox = await this.db.query.Inbox.findFirst({
      where: (inboxes, { and, eq }) =>
        and(eq(inboxes.id, inboxId), eq(inboxes.organizationId, this.organizationId)),
    })

    if (!inbox) {
      throw new ChatWidgetError(
        'Selected inbox not found or does not belong to this organization',
        'INBOX_NOT_FOUND'
      )
    }

    return inbox
  }

  /**
   * Validate that a chat widget integration belongs to the organization
   */
  private async validateIntegration(integrationId: string) {
    const integration = await this.db.query.Integration.findFirst({
      where: (integrations, { and, eq }) =>
        and(
          eq(integrations.id, integrationId),
          eq(integrations.organizationId, this.organizationId),
          eq(integrations.provider, 'chat')
        ),
      with: {
        chatWidget: {
          with: {
            operatingHours: true,
          },
        },
        inboxIntegration: {
          columns: {
            inboxId: true,
          },
        },
      },
    })

    if (!integration) {
      throw new ChatWidgetError(
        'Chat widget integration not found or access denied',
        'INTEGRATION_NOT_FOUND'
      )
    }

    if (!integration.chatWidget) {
      logger.error('Inconsistency: Chat widget integration found but linked chatWidget is null.', {
        integrationId,
      })
      throw new ChatWidgetError('Chat widget settings not found', 'WIDGET_NOT_FOUND')
    }

    return integration
  }

  /**
   * Add a new chat widget integration
   */
  async addChatWidgetIntegration(input: AddChatWidgetInput) {
    try {
      logger.info('Adding new Chat Widget integration', {
        organizationId: this.organizationId,
        name: input.name,
      })

      const { inboxId, ...widgetConfig } = input

      // Validate inbox if provided
      if (inboxId) {
        await this.validateInbox(inboxId)
      }

      const result = await this.db.transaction(async (tx) => {
        // Create Integration first
        const [newIntegration] = await tx
          .insert(schema.Integration)
          .values({
            organizationId: this.organizationId,
            provider: 'chat',
            name: widgetConfig.name,
            enabled: true,
            refreshToken: null,
            updatedAt: new Date(),
          })
          .returning()

        // Create ChatWidget
        const [newChatWidget] = await tx
          .insert(schema.ChatWidget)
          .values({
            organizationId: this.organizationId,
            integrationId: newIntegration.id,
            name: widgetConfig.name,
            title: widgetConfig.title,
            subtitle: widgetConfig.subtitle,
            primaryColor: widgetConfig.primaryColor,
            logoUrl: widgetConfig.logoUrl,
            position: widgetConfig.position,
            welcomeMessage: widgetConfig.welcomeMessage,
            autoOpen: widgetConfig.autoOpen,
            mobileFullScreen: widgetConfig.mobileFullScreen,
            collectUserInfo: widgetConfig.collectUserInfo,
            offlineMessage: widgetConfig.offlineMessage,
            allowedDomains: widgetConfig.allowedDomains ?? [],
            useAi: widgetConfig.useAi,
            aiModel: widgetConfig.aiModel,
            aiInstructions: widgetConfig.aiInstructions,
            isActive: true,
            updatedAt: new Date(),
          })
          .returning()

        // Create InboxIntegration link if inboxId is provided
        if (inboxId) {
          await tx
            .insert(schema.InboxIntegration)
            .values({
              inboxId: inboxId,
              integrationId: newIntegration.id,
              isDefault: false,
              updatedAt: new Date(),
            })
          logger.info(`Linked new chat integration ${newIntegration.id} to inbox ${inboxId}`)
        }

        return { integration: newIntegration, chatWidget: newChatWidget }
      })

      logger.info('Chat Widget integration created successfully', {
        integrationId: result.integration.id,
        chatWidgetId: result.chatWidget.id,
      })

      return { success: true, integrationId: result.integration.id }
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to add Chat Widget integration', {
        error: error.message,
        organizationId: this.organizationId,
      })

      if ((error as { code?: string })?.code === databaseErrorCodes.uniqueViolation) {
        throw new ChatWidgetError(
          'A chat widget integration with this name already exists',
          'DUPLICATE_NAME'
        )
      }

      throw new ChatWidgetError('Failed to create chat widget integration', 'CREATE_FAILED', error)
    }
  }

  /**
   * Update an existing chat widget integration
   */
  async updateChatWidgetIntegration(integrationId: string, input: UpdateChatWidgetInput) {
    try {
      const { name, inboxId, ...widgetData } = input

      logger.info('Updating Chat Widget integration', {
        organizationId: this.organizationId,
        integrationId,
        inboxId,
      })

      // Validate the integration exists and belongs to this org
      const integration = await this.validateIntegration(integrationId)
      const chatWidgetId = integration.chatWidget!.id

      // Validate inbox if provided (and not null)
      if (inboxId) {
        await this.validateInbox(inboxId)
      }

      await this.db.transaction(async (tx) => {
        // Update Integration name if provided
        if (name !== undefined) {
          await tx
            .update(schema.Integration)
            .set({ name, updatedAt: new Date() })
            .where(eq(schema.Integration.id, integrationId))
          await tx
            .update(schema.ChatWidget)
            .set({ name, updatedAt: new Date() })
            .where(eq(schema.ChatWidget.id, chatWidgetId))
        }

        // Update ChatWidget settings if any widget data is provided
        if (Object.keys(widgetData).length > 0) {
          const updateData = Object.fromEntries(
            Object.entries(widgetData).filter(([, value]) => value !== undefined)
          ) as Partial<ChatWidgetInsert>

          if (Object.keys(updateData).length > 0) {
            await tx
              .update(schema.ChatWidget)
              .set({ ...updateData, updatedAt: new Date() })
              .where(eq(schema.ChatWidget.id, chatWidgetId))
          }
        }

        // Update Inbox Link if inboxId is present in input (even if null)
        if (input.hasOwnProperty('inboxId')) {
          // Delete existing link first (if any)
          await tx
            .delete(schema.InboxIntegration)
            .where(eq(schema.InboxIntegration.integrationId, integrationId))

          // Create new link if inboxId is not null
          if (inboxId !== null && inboxId !== undefined) {
            await tx
              .insert(schema.InboxIntegration)
              .values({
                inboxId: inboxId,
                integrationId: integrationId,
                isDefault: false,
                updatedAt: new Date(),
              })
            logger.info(`Updated chat integration ${integrationId} link to inbox ${inboxId}`)
          } else {
            logger.info(`Removed inbox link for chat integration ${integrationId}`)
          }
        }
      })

      logger.info('Chat Widget integration updated successfully', { integrationId })
      return { success: true }
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to update Chat Widget integration', {
        error: error.message,
        integrationId,
      })

      throw new ChatWidgetError('Failed to update chat widget integration', 'UPDATE_FAILED', error)
    }
  }

  /**
   * Get details for a specific chat widget integration
   */
  async getChatWidgetIntegration(integrationId: string) {
    try {
      const integration = await this.validateIntegration(integrationId)

      // Remove sensitive fields before returning
      const { refreshToken, ...safeIntegrationData } = integration
      return safeIntegrationData
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Error getting chat widget integration details:', {
        error: error.message,
        integrationId,
      })

      throw new ChatWidgetError(
        'Failed to get chat widget integration details',
        'GET_FAILED',
        error
      )
    }
  }

  /**
   * Get installation code for a chat widget
   */
  async getInstallationCode(integrationId: string) {
    try {
      const integration = await this.db.query.Integration.findFirst({
        where: (integrations, { and, eq }) =>
          and(
            eq(integrations.id, integrationId),
            eq(integrations.organizationId, this.organizationId),
            eq(integrations.provider, 'chat')
          ),
        columns: {
          id: true,
          organizationId: true,
        },
      })

      if (!integration) {
        throw new ChatWidgetError('Chat widget integration not found', 'INTEGRATION_NOT_FOUND')
      }

      const baseUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const scriptSrc = `${baseUrl}/api/integrations/chat/${integration.id}/script.js`
      const script = `<script src="${scriptSrc}" async defer></script>`

      return { script }
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to get installation code', {
        error: error.message,
        integrationId,
      })

      throw new ChatWidgetError(
        'Failed to get installation code',
        'GET_INSTALLATION_CODE_FAILED',
        error
      )
    }
  }

  /**
   * Link a chat widget to an inbox
   */
  async linkToInbox(integrationId: string, inboxId: string | null) {
    try {
      await this.validateIntegration(integrationId)

      if (inboxId) {
        await this.validateInbox(inboxId)
      }

      await this.db.transaction(async (tx) => {
        // Delete existing link
        await tx
          .delete(schema.InboxIntegration)
          .where(eq(schema.InboxIntegration.integrationId, integrationId))

        // Create new link if inboxId is provided
        if (inboxId) {
          await tx
            .insert(schema.InboxIntegration)
            .values({
              inboxId: inboxId,
              integrationId: integrationId,
              isDefault: false,
              updatedAt: new Date(),
            })
          logger.info(`Linked chat integration ${integrationId} to inbox ${inboxId}`)
        } else {
          logger.info(`Removed inbox link for chat integration ${integrationId}`)
        }
      })

      return { success: true }
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to link chat widget to inbox', {
        error: error.message,
        integrationId,
        inboxId,
      })

      throw new ChatWidgetError('Failed to link chat widget to inbox', 'LINK_FAILED', error)
    }
  }

  /**
   * Validate a domain for a chat widget
   */
  async validateDomain(integrationId: string, domain: string) {
    try {
      const integration = await this.validateIntegration(integrationId)

      const allowedDomains = integration.chatWidget?.allowedDomains || []

      if (allowedDomains.length === 0) {
        // No domain restrictions
        return { valid: true }
      }

      const isValid = allowedDomains.some((allowedDomain) => {
        // Simple domain matching, can be enhanced with wildcard support
        return domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
      })

      return { valid: isValid }
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to validate domain', {
        error: error.message,
        integrationId,
        domain,
      })

      throw new ChatWidgetError('Failed to validate domain', 'VALIDATE_DOMAIN_FAILED', error)
    }
  }

  /**
   * Static method to get chat widget by integration ID
   */
  static async getByIntegrationId(db: Database, integrationId: string) {
    try {
      const integration = await db.query.Integration.findFirst({
        where: (integrations, { and, eq }) =>
          and(eq(integrations.id, integrationId), eq(integrations.provider, 'chat')),
        with: {
          chatWidget: {
            with: {
              operatingHours: true,
            },
          },
          inboxIntegration: {
            columns: {
              inboxId: true,
            },
          },
        },
      })

      if (!integration || !integration.chatWidget) {
        throw new ChatWidgetError('Chat widget not found', 'WIDGET_NOT_FOUND')
      }

      return integration
    } catch (error: any) {
      if (error instanceof ChatWidgetError) throw error

      logger.error('Failed to get chat widget by integration ID', {
        error: error.message,
        integrationId,
      })

      throw new ChatWidgetError('Failed to get chat widget', 'GET_BY_ID_FAILED', error)
    }
  }

  /**
   * Static method to get all chat widgets for an organization
   */
  static async getAllForOrganization(db: Database, organizationId: string) {
    try {
      const integrations = await db.query.Integration.findMany({
        where: (integrations, { and, eq }) =>
          and(eq(integrations.organizationId, organizationId), eq(integrations.provider, 'chat')),
        orderBy: (integrations, { desc }) => [desc(integrations.createdAt)],
        with: {
          chatWidget: {
            with: {
              operatingHours: true,
            },
          },
          inboxIntegration: {
            columns: {
              inboxId: true,
            },
          },
        },
      })

      return integrations.filter((int) => int.chatWidget !== null)
    } catch (error: any) {
      logger.error('Failed to get all chat widgets for organization', {
        error: error.message,
        organizationId,
      })

      throw new ChatWidgetError('Failed to get chat widgets', 'GET_ALL_FAILED', error)
    }
  }
}
