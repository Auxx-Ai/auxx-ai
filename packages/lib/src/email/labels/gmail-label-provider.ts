// lib/email/providers/gmail-label-provider.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { google } from 'googleapis'
import { GoogleOAuthService } from '../../providers/google/google-oauth'
import { IntegrationTokenAccessor } from '../../providers/integration-token-accessor'
import { ReauthenticationRequiredError } from '../errors-handlers'
import type { LabelProvider, ProviderLabel } from './label-provider.interface'

const logger = createScopedLogger('gmail-label-provider')

export class GmailLabelProvider implements LabelProvider {
  private gmail: any
  private client: any
  private organizationId: string
  private integrationId: string
  private oauthService: GoogleOAuthService

  constructor(organizationId: string, integrationId: string) {
    this.organizationId = organizationId
    this.integrationId = integrationId
    this.oauthService = GoogleOAuthService.getInstance()
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

      // Get authenticated client from the OAuth service
      this.client = this.oauthService.getAuthenticatedClient(tokens)

      // Initialize Gmail API with the authenticated client
      this.gmail = google.gmail({ version: 'v1', auth: this.client })
    } catch (error) {
      logger.error('Error initializing Gmail label provider:', { error })
      throw error
    }
  }

  async refreshAccessToken(): Promise<void> {
    try {
      await this.oauthService.refreshTokens(this.integrationId)

      // Re-initialize with refreshed token
      await this.initialize()
    } catch (error) {
      logger.error('Error refreshing access token:', { error })
      throw error
    }
  }
  // lib/email/providers/gmail-label-provider.ts

  private async withTokenRefresh<T>(operation: () => Promise<T>): Promise<T> {
    try {
      // Make sure Gmail client is initialized
      if (!this.gmail) {
        await this.initialize()
      }

      // Try the operation
      return await operation()
    } catch (error) {
      // Check for token expiration (normal 401)
      if (error.code === 401 || (error.response && error.response.status === 401)) {
        try {
          logger.info('Access token expired, refreshing and retrying operation')

          // Refresh the token
          await this.refreshAccessToken()

          // Try operation again
          return await operation()
        } catch (refreshError) {
          // Check for the specific invalid_grant/invalid_rapt error
          if (
            refreshError.response?.data?.error === 'invalid_grant' &&
            (refreshError.response?.data?.error_subtype === 'invalid_rapt' ||
              refreshError.message?.includes('invalid_rapt'))
          ) {
            // This is a re-authentication required error
            logger.warn('Re-authentication required, refresh token no longer valid', {
              refreshError,
            })
            throw new ReauthenticationRequiredError(
              'Google requires re-authentication. Please disconnect and reconnect your Google account.',
              'google'
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
  // Convert Gmail label to our ProviderLabel format
  private convertGmailLabel(gmailLabel: any): ProviderLabel {
    // Extract background and text colors if available
    let backgroundColor = null
    let textColor = null

    if (gmailLabel.color) {
      backgroundColor = gmailLabel.color.backgroundColor || null
      textColor = gmailLabel.color.textColor || null
    }

    return {
      id: gmailLabel.id,
      name: gmailLabel.name,
      type: gmailLabel.type === 'system' ? 'system' : 'user',
      backgroundColor,
      textColor,
      visible: !gmailLabel.messageListVisibility || gmailLabel.messageListVisibility !== 'hide',
      providerSpecificData: {
        labelListVisibility: gmailLabel.labelListVisibility,
        messageListVisibility: gmailLabel.messageListVisibility,
        raw: gmailLabel,
      },
    }
  }
  async getLabels(): Promise<ProviderLabel[]> {
    return this.withTokenRefresh(async () => {
      const response = await this.gmail.users.labels.list({ userId: 'me' })

      if (!response || !response.data || !response.data.labels) {
        return []
      }

      return response.data.labels.map((label: any) => this.convertGmailLabel(label))
    })
  }

  async createLabel(label: Omit<ProviderLabel, 'id'>): Promise<ProviderLabel> {
    return this.withTokenRefresh(async () => {
      // Prepare request body
      const requestBody: any = {
        name: label.name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }

      // Add color if provided
      if (label.backgroundColor && label.textColor) {
        requestBody.color = { backgroundColor: label.backgroundColor, textColor: label.textColor }
      }

      const response = await this.gmail.users.labels.create({ userId: 'me', requestBody })

      if (!response || !response.data) {
        throw new Error('Failed to create Gmail label')
      }

      return this.convertGmailLabel(response.data)
    })
  }

  async updateLabel(id: string, label: Partial<ProviderLabel>): Promise<ProviderLabel> {
    return this.withTokenRefresh(async () => {
      // Get current label
      const current = await this.gmail.users.labels.get({ userId: 'me', id })

      if (!current || !current.data) {
        throw new Error('Failed to get Gmail label for update')
      }

      // Prepare request body
      const requestBody: any = { ...current.data }

      // Update fields
      if (label.name) {
        requestBody.name = label.name
      }

      // Update color if both background and text colors are provided
      if (label.backgroundColor && label.textColor) {
        requestBody.color = { backgroundColor: label.backgroundColor, textColor: label.textColor }
      }

      const response = await this.gmail.users.labels.update({ userId: 'me', id, requestBody })

      if (!response || !response.data) {
        throw new Error('Failed to update Gmail label')
      }

      return this.convertGmailLabel(response.data)
    })
  }

  async deleteLabel(id: string): Promise<boolean> {
    return this.withTokenRefresh(async () => {
      await this.gmail.users.labels.delete({ userId: 'me', id })

      return true
    }).catch((error) => {
      // If label doesn't exist, consider it deleted
      if (error.code === 404 || (error.response && error.response.status === 404)) {
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
      await this.gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: { addLabelIds: [labelId] },
      })

      return true
    })
  }

  async removeLabelFromThread(labelId: string, threadId: string): Promise<boolean> {
    return this.withTokenRefresh(async () => {
      await this.gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: { removeLabelIds: [labelId] },
      })

      return true
    })
  }
}
