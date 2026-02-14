// packages/workflow-nodes/src/nodes/linkedin/v1/api-client.ts

import type { ExecuteContext, IHttpRequestMethods, IRequestOptions } from '../../../types'

/**
 * Professional Network API Client
 * Handles all interactions with LinkedIn API
 */
export class ProfessionalNetworkClient {
  private readonly API_BASE = 'https://api.linkedin.com'
  private readonly API_VERSION = '202410'

  constructor(private context: ExecuteContext) {}

  /**
   * Make authenticated request to LinkedIn API
   */
  async makeRequest(
    method: IHttpRequestMethods,
    endpoint: string,
    payload: Record<string, any> = {},
    options: { isBinary?: boolean; customHeaders?: Record<string, string> } = {}
  ): Promise<any> {
    const { isBinary = false, customHeaders = {} } = options

    const requestConfig: IRequestOptions = {
      headers: {
        Accept: 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': this.API_VERSION,
        ...customHeaders,
      },
      method,
      url: isBinary ? endpoint : `${this.API_BASE}/rest${endpoint}`,
      json: !isBinary,
    }

    if (Object.keys(payload).length > 0) {
      requestConfig.body = payload
    }

    if (isBinary) {
      requestConfig.encoding = null
    }

    try {
      const response = await this.context.helpers.requestOAuth2.call(
        this.context,
        'professionalNetworkOAuth2',
        requestConfig,
        { tokenType: 'Bearer' }
      )

      return this.processResponse(response)
    } catch (error: any) {
      throw new Error(`Professional network API error: ${error.message}`)
    }
  }

  /**
   * Process API response and extract relevant data
   */
  private processResponse(response: any): any {
    if (response.statusCode === 201) {
      return {
        id: response.headers['x-restli-id'],
        success: true,
        created: true,
        timestamp: new Date().toISOString(),
      }
    }
    return response.body || response
  }

  /**
   * Upload media content to LinkedIn
   */
  async uploadMedia(mediaData: ArrayBuffer | Buffer, contentType: string): Promise<string> {
    try {
      // Initialize upload request
      const uploadRequest = {
        initializeUploadRequest: {
          owner: await this.getCurrentUserUrn(),
        },
      }

      const uploadResponse = await this.makeRequest(
        'POST',
        '/images?action=initializeUpload',
        uploadRequest
      )

      const { uploadUrl, image } = uploadResponse.value

      // Upload the actual media data
      await this.makeRequest('POST', uploadUrl, mediaData, {
        isBinary: true,
        customHeaders: { 'Content-Type': contentType },
      })

      return image
    } catch (error: any) {
      throw new Error(`Media upload failed: ${error.message}`)
    }
  }

  /**
   * Get current authenticated user's URN
   */
  async getCurrentUserUrn(): Promise<string> {
    try {
      const userInfo = await this.makeRequest('GET', '/v2/userinfo')
      return `urn:li:person:${userInfo.sub}`
    } catch (error: any) {
      throw new Error(`Failed to get user information: ${error.message}`)
    }
  }

  /**
   * Get organization URN by ID
   */
  async getOrganizationUrn(organizationId: string): Promise<string> {
    return `urn:li:organization:${organizationId}`
  }

  /**
   * Validate API connection and permissions
   */
  async validateConnection(): Promise<boolean> {
    try {
      await this.getCurrentUserUrn()
      return true
    } catch {
      return false
    }
  }
}
