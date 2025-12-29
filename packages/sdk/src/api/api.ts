// packages/sdk/src/api/api.ts

import { Fetcher } from './fetcher.js'
import type { Result } from '../types/result.js'
import { complete, errored, type FetcherError } from '../errors.js'
// import { complete, errored, isErrored } from '../errors.js'

import {
  tokenResponseSchema,
  whoamiSchema,
  oidcUserInfoSchema,
  listDevOrganizationsResponseSchema,
  // developerAccountSchema,
  listAppsResponseSchema,
  appInfoSchema,
  createDevVersionSchema,
  completeBundleUploadSchema,
  versionsSchema,
  installationSchema,
  createVersionSchema,
  fetchAppLogsResponseSchema,
  TEST_APP_INFO,
  TEST_ORGANIZATIONS,
} from './schemas.js'
import { AUTH_API } from '../env.js'
import { DotenvParseOutput } from 'dotenv'

export type ApiError =
  | { code: 'WHOAMI_ERROR'; error: FetcherError }
  | { code: 'FETCH_APPS_ERROR'; error: FetcherError }
  | { code: 'FETCH_APP_INFO_ERROR'; error: FetcherError }
  | { code: 'CREATE_VERSION_ERROR'; error: FetcherError }
  | { code: 'CREATE_DEV_VERSION_ERROR'; error: FetcherError }
  | { code: 'COMPLETE_BUNDLE_UPLOAD_ERROR'; error: FetcherError }
  | { code: 'COMPLETE_PROD_BUNDLE_UPLOAD_ERROR'; error: FetcherError }
  | { code: 'FETCH_VERSIONS_ERROR'; error: FetcherError }
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

  async createVersion({
    appId,
    major,
    cliVersion,
  }: {
    appId: string
    major: number
    cliVersion: string
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/prod-versions`,
      body: {
        major,
        cli_version: cliVersion,
      },
      schema: createVersionSchema,
    })
    if (!result.success) {
      return errored({ code: 'CREATE_VERSION_ERROR', error: result.error as unknown as Error })
    }
    return complete(result.value)
  }

  async completeBundleUpload({
    appId,
    versionId,
    bundleId,
    bundleSha,
    settingsSchema,
  }: {
    appId: string
    versionId: string
    bundleId: string
    bundleSha: string
    settingsSchema?: { organization?: Record<string, unknown>; user?: Record<string, unknown> }
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/dev-versions/${versionId}/bundles/${bundleId}/complete`,
      body: {
        bundle_sha: bundleSha,
        settings_schema: settingsSchema,
      },
      schema: completeBundleUploadSchema,
    })
    if (!result.success) {
      return errored({ code: 'COMPLETE_BUNDLE_UPLOAD_ERROR', error: result.error })
    }
    return complete(undefined)
  }

  async completeProdBundleUpload({
    appId,
    versionId,
    bundleId,
    bundleSha,
    settingsSchema,
  }: {
    appId: string
    versionId: string
    bundleId: string
    bundleSha: string
    settingsSchema?: { organization?: Record<string, unknown>; user?: Record<string, unknown> }
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/prod-versions/${versionId}/bundles/${bundleId}/complete`,
      body: {
        bundle_sha: bundleSha,
        settings_schema: settingsSchema,
      },
      schema: completeBundleUploadSchema,
    })
    if (!result.success) {
      return errored({ code: 'COMPLETE_PROD_BUNDLE_UPLOAD_ERROR', error: result.error })
    }
    return complete(undefined)
  }

  /**
   * Create a new development version for an app
   */
  async createDevVersion({
    appId,
    cliVersion,
    targetOrganizationId,
    environmentVariables,
  }: {
    appId: string
    cliVersion: string
    targetOrganizationId: string
    environmentVariables: DotenvParseOutput
  }) {
    const result = await this.fetcher.post({
      path: `/api/v1/apps/${appId}/dev-versions`,
      body: {
        target_organization_id: targetOrganizationId,
        environment_variables: environmentVariables,
        cli_version: cliVersion,
      },
      schema: createDevVersionSchema,
    })
    if (!result.success) {
      return errored({ code: 'CREATE_DEV_VERSION_ERROR', error: result.error })
    }
    return complete(result.value)
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
   * Fetch all production versions for an app
   */
  async fetchVersions(appId: string) {
    const result = await this.fetcher.get({
      path: `/api/v1/apps/${appId}/prod-versions`,
      schema: versionsSchema,
    })
    if (!result.success) {
      return errored({ code: 'FETCH_VERSIONS_ERROR', error: result.error })
    }
    return complete(result.value.app_prod_versions) //{ success: true, value: result.value.app_prod_versions }
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
