// packages/workflow-nodes/src/nodes/linkedin/v1/content-operations.ts

import type { ExecuteContext, IExecuteFunctions } from '../../../types'
import type { ProfessionalNetworkClient } from './api-client'

/**
 * Content publishing operations for professional networks
 */
export class ContentPublisher {
  constructor(private apiClient: ProfessionalNetworkClient) {}

  /**
   * Publish content based on type
   */
  async publishContent(params: {
    contentType: string
    itemIndex: number
    executionContext: ExecuteContext
  }): Promise<any> {
    const { contentType, itemIndex, executionContext } = params

    switch (contentType) {
      case 'textPost':
        return this.createTextPost(itemIndex, executionContext)
      case 'imagePost':
        return this.createImagePost(itemIndex, executionContext)
      case 'articlePost':
        return this.createArticlePost(itemIndex, executionContext)
      default:
        throw new Error(`Unsupported content type: ${contentType}`)
    }
  }

  /**
   * Schedule content for later publishing
   */
  async scheduleContent(params: {
    contentType: string
    itemIndex: number
    executionContext: ExecuteContext
  }): Promise<any> {
    // Implementation for content scheduling
    throw new Error('Content scheduling not yet implemented')
  }

  /**
   * Create a text-only post
   */
  private async createTextPost(itemIndex: number, context: ExecuteContext): Promise<any> {
    const content = context.getNodeParameter('textContent', itemIndex) as string
    const visibility = context.getNodeParameter('postVisibility', itemIndex, 'PUBLIC') as string
    const authorType = context.getNodeParameter('authorType', itemIndex, 'person') as string

    if (!content?.trim()) {
      throw new Error('Text content is required for text posts')
    }

    const authorUrn = await this.getAuthorUrn(authorType, context, itemIndex)

    const requestBody = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        thirdPartyDistributionChannels: [],
      },
      visibility,
      commentary: this.formatTextContent(content),
    }

    return this.apiClient.makeRequest('POST', '/posts', requestBody)
  }

  /**
   * Create a post with image attachment
   */
  private async createImagePost(itemIndex: number, context: ExecuteContext): Promise<any> {
    const content = context.getNodeParameter('textContent', itemIndex) as string
    const imageProperty = context.getNodeParameter('imageData', itemIndex) as string
    const imageTitle = context.getNodeParameter('imageTitle', itemIndex, '') as string
    const visibility = context.getNodeParameter('postVisibility', itemIndex, 'PUBLIC') as string

    if (!imageProperty) {
      throw new Error('Image data is required for image posts')
    }

    try {
      // Get image binary data
      const imageMetadata = context.helpers.assertBinaryData(itemIndex, imageProperty)
      const imageBuffer = await context.helpers.getBinaryDataBuffer(itemIndex, imageProperty)

      // Upload image
      const imageId = await this.apiClient.uploadMedia(imageBuffer, imageMetadata.mimeType)

      const authorUrn = await this.getAuthorUrn('person', context, itemIndex)

      const requestBody = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          thirdPartyDistributionChannels: [],
        },
        visibility,
        content: {
          media: {
            title: imageTitle || 'Image Post',
            id: imageId,
          },
        },
        commentary: content ? this.formatTextContent(content) : '',
      }

      return this.apiClient.makeRequest('POST', '/posts', requestBody)
    } catch (error: any) {
      throw new Error(`Failed to create image post: ${error.message}`)
    }
  }

  /**
   * Create a post with article/link preview
   */
  private async createArticlePost(itemIndex: number, context: ExecuteContext): Promise<any> {
    const content = context.getNodeParameter('textContent', itemIndex) as string
    const articleUrl = context.getNodeParameter('articleUrl', itemIndex) as string
    const articleTitle = context.getNodeParameter('articleTitle', itemIndex) as string
    const articleDescription = context.getNodeParameter(
      'articleDescription',
      itemIndex,
      ''
    ) as string
    const visibility = context.getNodeParameter('postVisibility', itemIndex, 'PUBLIC') as string

    if (!articleUrl?.trim()) {
      throw new Error('Article URL is required for article posts')
    }

    if (!articleTitle?.trim()) {
      throw new Error('Article title is required for article posts')
    }

    const authorUrn = await this.getAuthorUrn('person', context, itemIndex)

    const requestBody = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        thirdPartyDistributionChannels: [],
      },
      visibility,
      content: {
        article: {
          title: articleTitle,
          description: articleDescription,
          source: articleUrl,
        },
      },
      commentary: content ? this.formatTextContent(content) : '',
    }

    return this.apiClient.makeRequest('POST', '/posts', requestBody)
  }

  /**
   * Get author URN based on type (person or organization)
   */
  private async getAuthorUrn(
    authorType: string,
    context: ExecuteContext,
    itemIndex: number
  ): Promise<string> {
    if (authorType === 'organization') {
      const orgId = context.getNodeParameter('organizationId', itemIndex) as string
      if (!orgId?.trim()) {
        throw new Error('Organization ID is required when posting as organization')
      }
      return this.apiClient.getOrganizationUrn(orgId)
    }

    return await this.apiClient.getCurrentUserUrn()
  }

  /**
   * Format text content according to professional network requirements
   * Escape special characters that LinkedIn treats as formatting
   */
  private formatTextContent(text: string): string {
    if (!text) return ''

    // Escape special characters that LinkedIn uses for formatting
    return text.replace(/[()[\]{}@|~_*]/g, '\\$&')
  }

  /**
   * Validate content before publishing
   */
  private validateContent(content: string, maxLength: number = 3000): void {
    if (!content?.trim()) {
      throw new Error('Content cannot be empty')
    }

    if (content.length > maxLength) {
      throw new Error(`Content exceeds maximum length of ${maxLength} characters`)
    }
  }

  /**
   * Get posting statistics
   */
  async getPostingStats(authorUrn: string, limit: number = 10): Promise<any> {
    try {
      const response = await this.apiClient.makeRequest(
        'GET',
        `/posts?author=${encodeURIComponent(authorUrn)}&count=${limit}`
      )
      return response
    } catch (error: any) {
      throw new Error(`Failed to retrieve posting stats: ${error.message}`)
    }
  }
}
