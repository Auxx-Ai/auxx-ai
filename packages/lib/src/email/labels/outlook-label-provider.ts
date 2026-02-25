// lib/email/providers/outlook-label-provider.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'
import { IntegrationTokenAccessor } from '../../providers/integration-token-accessor'
import {
  type OutlookIntegrationMetadata,
  OutlookOAuthService,
} from '../../providers/outlook/outlook-oauth'
import { ReauthenticationRequiredError } from '../errors-handlers'
import type { LabelProvider, ProviderLabel } from './label-provider.interface'

const logger = createScopedLogger('outlook-label-provider')

export class OutlookLabelProvider implements LabelProvider {
  private client: Client | null = null
  private organizationId: string
  private integrationId: string
  private oauthService: OutlookOAuthService

  constructor(organizationId: string, integrationId: string) {
    this.organizationId = organizationId
    this.integrationId = integrationId
    this.oauthService = OutlookOAuthService.getInstance()
  }

  async initialize(): Promise<void> {
    try {
      // Get the integration for this organization
      const [integration] = await database
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, this.integrationId))
        .limit(1)

      if (!integration) {
        throw new Error('Integration not found')
      }

      // Get tokens from encrypted credentials
      const tokens = await IntegrationTokenAccessor.getTokens(this.integrationId)
      if (!tokens.refreshToken) {
        throw new Error('Missing refresh token for Outlook integration')
      }

      const metadata = integration.metadata as unknown as Partial<OutlookIntegrationMetadata>
      if (!metadata?.homeAccountId) {
        throw new Error('Missing homeAccountId in Outlook integration metadata')
      }

      this.client = this.oauthService.getAuthenticatedClient({
        integrationId: integration.id,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
        homeAccountId: metadata.homeAccountId,
        email: metadata.email || '',
      })
    } catch (error) {
      logger.error('Error initializing Outlook label provider:', { error })
      throw error
    }
  }

  private async withTokenRefresh<T>(operation: () => Promise<T>): Promise<T> {
    try {
      // Make sure Graph client is initialized
      if (!this.client) {
        await this.initialize()
      }

      // Try the operation
      return await operation()
    } catch (error) {
      // If token expired, refresh token and try once more
      if (error.statusCode === 401 || (error.code && error.code === 'InvalidAuthenticationToken')) {
        try {
          logger.info('Access token expired, refreshing and retrying operation')

          // Re-initialize with the new token
          await this.initialize()

          // Try operation again
          return await operation()
        } catch (refreshError) {
          // Check for invalid_grant errors that might indicate re-auth needed
          if (
            refreshError.message?.includes('invalid_grant') ||
            refreshError.message?.includes('AADSTS70000')
          ) {
            logger.warn('Re-authentication required, refresh token no longer valid', {
              refreshError,
            })
            throw new ReauthenticationRequiredError(
              'Microsoft requires re-authentication. Please disconnect and reconnect your Outlook account.',
              'outlook'
            )
          }

          // Other refresh errors
          throw refreshError
        }
      }

      // For any other errors, just propagate them
      throw error
    }
  }

  // Convert Outlook category to our ProviderLabel format
  private convertOutlookCategory(category: any): ProviderLabel {
    return {
      id: category.id,
      name: category.displayName,
      type: 'user', // Outlook categories are all user-created
      backgroundColor: category.color || null,
      textColor: '#FFFFFF', // Default, Outlook doesn't specify text color
      visible: true,
      providerSpecificData: category,
    }
  }

  async getLabels(): Promise<ProviderLabel[]> {
    return this.withTokenRefresh(async () => {
      const response = await this.client!.api('/me/outlook/masterCategories').get()

      if (!response || !response.value) {
        return []
      }

      return response.value.map((category: any) => this.convertOutlookCategory(category))
    })
  }

  async createLabel(label: Omit<ProviderLabel, 'id'>): Promise<ProviderLabel> {
    return this.withTokenRefresh(async () => {
      const requestBody = { displayName: label.name, color: label.backgroundColor || 'None' }

      const response = await this.client!.api('/me/outlook/masterCategories').post(requestBody)

      if (!response) {
        throw new Error('Failed to create Outlook category')
      }

      return this.convertOutlookCategory(response)
    })
  }

  async updateLabel(id: string, label: Partial<ProviderLabel>): Promise<ProviderLabel> {
    return this.withTokenRefresh(async () => {
      const updateBody: any = {}

      if (label.name) {
        updateBody.displayName = label.name
      }

      if (label.backgroundColor) {
        updateBody.color = label.backgroundColor
      }

      const response = await this.client!.api(`/me/outlook/masterCategories/${id}`).patch(
        updateBody
      )

      if (!response) {
        throw new Error('Failed to update Outlook category')
      }

      return this.convertOutlookCategory(response)
    })
  }

  async deleteLabel(id: string): Promise<boolean> {
    return this.withTokenRefresh(async () => {
      await this.client!.api(`/me/outlook/masterCategories/${id}`).delete()

      return true
    }).catch((error) => {
      // If category doesn't exist, consider it deleted
      if (error.statusCode === 404) {
        return true
      }
      throw error
    })
  }

  async syncLabels(): Promise<ProviderLabel[]> {
    return this.getLabels()
  }

  async addLabelToThread(labelId: string, threadId: string): Promise<boolean> {
    return this.withTokenRefresh(async () => {
      // First get the category to get its name
      const categoryResponse = await this.client!.api(
        `/me/outlook/masterCategories/${labelId}`
      ).get()

      if (!categoryResponse) {
        throw new Error('Category not found')
      }

      // Get the thread messages
      const messagesResponse = await this.client!.api(
        `/me/messages?$filter=conversationId eq '${threadId}'`
      ).get()

      if (!messagesResponse || !messagesResponse.value || messagesResponse.value.length === 0) {
        throw new Error('No messages found in thread')
      }

      // Add category to each message in the thread
      for (const message of messagesResponse.value) {
        // Get current categories
        const categories = message.categories || []

        // Add the new category if not already present
        if (!categories.includes(categoryResponse.displayName)) {
          categories.push(categoryResponse.displayName)

          // Update the message
          await this.client!.api(`/me/messages/${message.id}`).patch({ categories: categories })
        }
      }

      return true
    })
  }

  async removeLabelFromThread(labelId: string, threadId: string): Promise<boolean> {
    return this.withTokenRefresh(async () => {
      // First get the category to get its name
      const categoryResponse = await this.client!.api(
        `/me/outlook/masterCategories/${labelId}`
      ).get()

      if (!categoryResponse) {
        throw new Error('Category not found')
      }

      // Get the thread messages
      const messagesResponse = await this.client!.api(
        `/me/messages?$filter=conversationId eq '${threadId}'`
      ).get()

      if (!messagesResponse || !messagesResponse.value || messagesResponse.value.length === 0) {
        throw new Error('No messages found in thread')
      }

      // Remove category from each message in the thread
      for (const message of messagesResponse.value) {
        // Get current categories
        const categories = message.categories || []

        // Remove the category if present
        const categoryIndex = categories.indexOf(categoryResponse.displayName)
        if (categoryIndex !== -1) {
          categories.splice(categoryIndex, 1)

          // Update the message
          await this.client!.api(`/me/messages/${message.id}`).patch({ categories: categories })
        }
      }

      return true
    })
  }
}
