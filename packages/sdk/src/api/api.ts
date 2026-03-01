// packages/sdk/src/api/api.ts

import { complete, errored, type FetcherError } from '../errors.js'
import type { Result } from '../types/result.js'
import { Fetcher } from './fetcher.js'

// import { complete, errored, isErrored } from '../errors.js'

import { AUTH_API } from '../env.js'
import {
  appInfoSchema,
  checkBundlesResponseSchema,
  confirmBundlesResponseSchema,
  createDeploymentResponseSchema,
  fetchAppLogsResponseSchema,
  installationSchema,
  listAppsResponseSchema,
  listDeploymentsResponseSchema,
  listDevOrganizationsResponseSchema,
  oidcUserInfoSchema,
  TEST_APP_INFO,
  TEST_ORGANIZATIONS,
  tokenResponseSchema,
  whoamiSchema,
} from './schemas.js'

export type ApiError =
  | { code: 'WHOAMI_ERROR'; error: FetcherError }
  | { code: 'FETCH_APPS_ERROR'; error: FetcherError }
  | { code: 'FETCH_APP_INFO_ERROR'; error: FetcherError }
  | { code: 'CHECK_BUNDLES_ERROR'; error: FetcherError }
  | { code: 'CONFIRM_BUNDLES_ERROR'; error: FetcherError }
  | { code: 'CREATE_DEPLOYMENT_ERROR'; error: FetcherError }
  | { code: 'LIST_DEPLOYMENTS_ERROR'; error: FetcherError }
  | { code: 'FETCH_INSTALLATION_ERROR'; error: FetcherError }
  | { code: 'GET_TOKEN_ERROR'; error: FetcherError }
  | { code: 'REFRESH_TOKEN_ERROR'; error: FetcherError }
  | { code: 'FETCH_ORGANIZATIONS_ERROR'; error: FetcherError }
  | { code: 'FETCH_APP_LOGS_ERROR'; error: FetcherError }

/**
 * API client for communicating with Auxx developer portal
 */
class ApiImpl {
  private fetcher: Fetcher

  constructor() {
    this.fetcher = new Fetcher()
  }

  /**
   * Get current authenticated user information
   */
  async whoami() {
    const result = await this.fetcher.get({
      path: `${AUTH_API}/session`,
      schema: whoamiSchema,
    })

    if (!result.success) {
      return errored({ code: 'WHOAMI_ERROR', error: result.error })
    }

    return complete(result.value.session)
  }

  /**
   * List all apps for the authenticated developer
   */
  async fetchApps() {
    const result = await this.fetcher.get({
      path: '/api/v1/apps',
      schema: listAppsResponseSchema,
    })

    if (!result.success) {
      return errored({ code: 'FETCH_APPS_ERROR', error: result.error })
    }

    return complete(result.value.data.apps)
  }

  /**
   * Get app information by slug
   */
  async fetchAppInfo(appSlug: string) {
    if (process.env.NODE_ENV === 'test') {
      return complete(TEST_APP_INFO.data.app)
    }

    const result = await this.fetcher.get({
      path: `/api/v1/apps/by-slug/${appSlug}`,
      schema: appInfoSchema,
    })

    if (!result.success) {
      return errored({ code: 'FETCH_APP_INFO_ERROR', error: result.error })
    }

    return complete(result.value.data.app)
  }

  /**
   * Exchange authorization code for access token (OAuth flow)
   */
  async exchangeToken({
    code,
    codeVerifier,
    redirectUri,
    clientId,
  }: {
    code: string
    codeVerifier: string
    redirectUri: string
    clientId: string
  }): Promise<Result<any, ApiError>> {
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('code', code)
    params.append('client_id', clientId)
    params.append('redirect_uri', redirectUri)
    params.append('code_verifier', codeVerifier)

    const result = await this.fetcher.post({
      path: `${AUTH_API}/oauth2/token`,
      body: params,
      schema: tokenResponseSchema,
      authenticated: 'Not Authenticated',
    })

    if (!result.success) {
      return {
        success: false,
        error: { code: 'GET_TOKEN_ERROR', error: result.error },
      }
    }

    return result
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken({ refreshToken, clientId }: { refreshToken: string; clientId: string }) {
    const params = new URLSearchParams()
    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('client_id', clientId)

    const result = await this.fetcher.post({
      path: `${AUTH_API}/oauth2/token`,
      body: params,
      schema: tokenResponseSchema,
      authenticated: 'Not Authenticated',
    })

    if (!result.success) {
      return errored({ code: 'REFRESH_TOKEN_ERROR', error: result.error })
    }

    return complete(result.value)
  }

  /**
   * Get user info from OIDC UserInfo endpoint
   */
  async getUserInfo() {
    const result = await this.fetcher.get({
      path: `${AUTH_API}/oauth2/userinfo`,
      schema: oidcUserInfoSchema,
      authenticated: 'Authenticated',
    })

    if (!result.success) {
      return errored({ code: 'WHOAMI_ERROR', error: result.error })
    }

    return complete(result.value)
  }

  /**
   * List all developer organizations for the authenticated user
   */
  async fetchOrganizations() {
    if (process.env.NODE_ENV === 'test') {
      return complete(TEST_ORGANIZATIONS)
    }

    const result = await this.fetcher.get({
      path: '/api/v1/developers/dev-organizations',
      schema: listDevOrganizationsResponseSchema,
    })
    if (!result.success) {
      return errored({ code: 'FETCH_ORGANIZATIONS_ERROR', error: result.error })
    }
    return complete(result.value.organizations)
  }

  /**
   * Check which bundles already exist (content-addressed)
   */
  async checkBundles({
    appId,
    clientSha,
    serverSha,
  }: {
    appId: string
    clientSha: string
    serverSha: string
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/bundles/check`,
      body: { clientSha, serverSha },
      schema: checkBundlesResponseSchema,
    })
    if (!result.success) {
      return errored({ code: 'CHECK_BUNDLES_ERROR', error: result.error })
    }
    return complete(result.value)
  }

  /**
   * Confirm bundles have been uploaded
   */
  async confirmBundles({
    appId,
    clientSha,
    serverSha,
  }: {
    appId: string
    clientSha: string
    serverSha: string
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/bundles/confirm`,
      body: { clientSha, serverSha },
      schema: confirmBundlesResponseSchema,
    })
    if (!result.success) {
      return errored({ code: 'CONFIRM_BUNDLES_ERROR', error: result.error })
    }
    return complete(result.value)
  }

  /**
   * Create a deployment (development or production)
   */
  async createDeployment({
    appId,
    clientBundleSha,
    serverBundleSha,
    deploymentType,
    settingsSchema,
    targetOrganizationId,
    environmentVariables,
    version,
    metadata,
  }: {
    appId: string
    clientBundleSha: string
    serverBundleSha: string
    deploymentType: 'development' | 'production'
    settingsSchema?: { organization?: Record<string, unknown>; user?: Record<string, unknown> }
    targetOrganizationId?: string
    environmentVariables?: Record<string, string>
    version?: string
    metadata?: Record<string, unknown>
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/deployments`,
      body: {
        clientBundleSha,
        serverBundleSha,
        deploymentType,
        settingsSchema,
        targetOrganizationId,
        environmentVariables,
        version,
        metadata,
      },
      schema: createDeploymentResponseSchema,
    })
    if (!result.success) {
      return errored({ code: 'CREATE_DEPLOYMENT_ERROR', error: result.error })
    }
    return complete(result.value)
  }

  /**
   * List deployments for an app
   */
  async listDeployments({ appId, type }: { appId: string; type?: 'development' | 'production' }) {
    const params = new URLSearchParams()
    if (type) params.append('type', type)
    const queryString = params.toString()
    const path = `/api/v1/apps/${appId}/deployments${queryString ? `?${queryString}` : ''}`

    const result = await this.fetcher.get({
      path,
      schema: listDeploymentsResponseSchema,
    })
    if (!result.success) {
      return errored({ code: 'LIST_DEPLOYMENTS_ERROR', error: result.error })
    }
    return complete(result.value.deployments)
  }

  async fetchInstallation({ appId, organizationId }: { appId: string; organizationId: string }) {
    const result = await this.fetcher.get({
      path: `/api/v1/apps/${appId}/organization/${organizationId}/dev-installation`,
      schema: installationSchema,
    })

    if (!result.success) {
      if (result.error.code === 'HTTP_ERROR' && result.error.status === 404) {
        return complete(null)
        // return null
      }
      return errored({ code: 'FETCH_INSTALLATION_ERROR', error: result.error })
    }
    return complete(result)
  }

  /**
   * Fetch flattened app logs for an organization
   * Logs are already flattened by the backend
   */
  async fetchAppLogs({
    organizationHandle,
    appSlug,
    cursor,
    limit = 100,
  }: {
    organizationHandle: string
    appSlug: string
    cursor?: string
    limit?: number
  }) {
    // Build query parameters
    const params = new URLSearchParams()
    if (cursor) params.append('cursor', cursor)
    if (limit) params.append('limit', limit.toString())

    const queryString = params.toString()
    const path = `/api/v1/organizations/${organizationHandle}/apps/${appSlug}/logs${
      queryString ? `?${queryString}` : ''
    }`

    const result = await this.fetcher.get({
      path,
      schema: fetchAppLogsResponseSchema,
    })

    if (!result.success) {
      return errored({ code: 'FETCH_APP_LOGS_ERROR', error: result.error })
    }

    return complete(result.value.data)
  }

  // Additional API methods will be added as needed...
}

/** Singleton API client instance */
export const api = new ApiImpl()
