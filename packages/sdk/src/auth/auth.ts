// packages/sdk/src/auth/auth.ts

import { createHash, randomBytes } from 'crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import open from 'open'
import { api } from '../api/api.js'
import { APP_URL, SDK_CLIENT_ID } from '../env.js'
import { findAvailablePort } from '../util/find-available-port.js'
import { getKeychain, type KeychainToken } from './keychain.js'
import type { Result } from '../types/result.js'
import { isError } from '../types/result.js'
import { isErrored } from '../errors.js'

/** OAuth token response from API */
interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

const MAX_TIMEOUT = 2_147_483_647

export type AuthError =
  | { code: 'OAUTH_STATE_MISMATCH' }
  | { code: 'NO_AUTHORIZATION_CODE' }
  | { code: 'TOKEN_EXCHANGE_FAILED'; error: unknown }
  | { code: 'KEYCHAIN_ERROR'; error: unknown }
  | { code: 'USER_CANCELLED' }

/**
 * Authenticator handles OAuth PKCE flow with better-auth
 * Manages token lifecycle including refresh and storage
 */
class Authenticator {
  private clientId = SDK_CLIENT_ID
  private isRefreshingToken = false
  private refreshTimeout: NodeJS.Timeout | null = null

  /**
   * Ensure user is authenticated, prompting for login if needed
   */
  async ensureAuthed(): Promise<Result<string, AuthError | any>> {
    const existingTokenResult = await getKeychain().load()

    if (isError(existingTokenResult)) {
      return this.promptToAuthenticate()
    }

    const existingToken = existingTokenResult.value

    if (existingToken === null || existingToken.expires_at < Date.now()) {
      return this.promptToAuthenticate()
    }

    this.scheduleRefresh(existingToken)
    return { success: true, value: existingToken.access_token }
  }

  /**
   * Prompt user to authenticate in browser
   */
  private async promptToAuthenticate(): Promise<Result<string, AuthError | any>> {
    if (process.env.NODE_ENV !== 'test') {
      process.stdout.write('You need to log in with Auxx. Press Enter to continue...\n\n')
      await new Promise((resolve) => process.stdin.once('data', resolve))
    }

    return this.authenticate()
  }

  /**
   * Perform OAuth PKCE authentication flow with better-auth
   */
  async authenticate(): Promise<Result<string, AuthError | any>> {
    // Check for existing valid token
    const existingTokenResult = await getKeychain().load()
    if (!isError(existingTokenResult)) {
      const existingToken = existingTokenResult.value
      if (existingToken !== null && existingToken.expires_at > Date.now()) {
        return { success: true, value: existingToken.access_token }
      }
    }

    // Generate PKCE challenge
    const verifier = randomBytes(32)
    const verifierString = verifier.toString('base64url')
    // Hash the base64url-encoded verifier string (not the raw buffer)
    const hash = createHash('sha256')
    hash.update(verifierString)
    const challenge = hash.digest()
    const challengeString = challenge.toString('base64url')
    const state = randomBytes(32).toString('base64url')

    // Start local callback server - use ports registered with better-auth (3000-3010)
    // Start from 3006 to avoid conflicts with common dev servers (3000=web, 3005=worker)
    const port = await findAvailablePort(3006, 3010)
    const redirectUri = `http://localhost:${port}/callback`

    // Debug logging
    process.stdout.write('\n[SDK OAuth Debug]\n')
    process.stdout.write(`Client ID: ${this.clientId}\n`)
    process.stdout.write(`Redirect URI: ${redirectUri}\n`)
    process.stdout.write(`State: ${state.substring(0, 10)}...\n`)
    process.stdout.write(`Code Challenge: ${challengeString.substring(0, 10)}...\n`)
    process.stdout.write(`Code Verifier: ${verifierString.substring(0, 10)}...\n\n`)

    let resolveAsyncResult: (value: Result<string, AuthError | any>) => void
    const asyncResult = new Promise<Result<string, AuthError | any>>((resolve) => {
      resolveAsyncResult = resolve
    })

    const app = new Hono()
    let serverRef: any

    app.get('/callback', async (c) => {
      const query = c.req.query()
      const receivedCode = query.code
      const receivedState = query.state
      const error = query.error

      // Debug logging
      process.stdout.write('\n[SDK Callback Received]\n')
      process.stdout.write(
        `Code: ${receivedCode ? receivedCode.substring(0, 10) + '...' : 'NONE'}\n`
      )
      process.stdout.write(
        `State: ${receivedState ? receivedState.substring(0, 10) + '...' : 'NONE'}\n`
      )
      process.stdout.write(`Error: ${error || 'NONE'}\n\n`)

      // Handle user cancellation or errors
      if (error) {
        resolveAsyncResult({
          success: false,
          error: { code: 'USER_CANCELLED' },
        })
        return c.html(`
          <html>
            <body>
              <h1>Authentication Cancelled</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 2000)</script>
            </body>
          </html>
        `)
      }

      if (receivedState !== state) {
        resolveAsyncResult({
          success: false,
          error: { code: 'OAUTH_STATE_MISMATCH' },
        })
        return c.html(`
          <html>
            <body>
              <h1>Authentication Error</h1>
              <p>State mismatch. Please try again.</p>
              <script>setTimeout(() => window.close(), 2000)</script>
            </body>
          </html>
        `)
      }

      if (!receivedCode) {
        resolveAsyncResult({
          success: false,
          error: { code: 'NO_AUTHORIZATION_CODE' },
        })
        return c.html(`
          <html>
            <body>
              <h1>Authentication Error</h1>
              <p>No authorization code received. Please try again.</p>
              <script>setTimeout(() => window.close(), 2000)</script>
            </body>
          </html>
        `)
      }

      // Exchange code for tokens
      process.stdout.write('[SDK Token Exchange]\n')
      process.stdout.write(`Exchanging code for token...\n`)
      process.stdout.write(`Code: ${receivedCode.substring(0, 10)}...\n`)
      process.stdout.write(`Code Verifier: ${verifierString.substring(0, 10)}...\n`)
      process.stdout.write(`Redirect URI: ${redirectUri}\n`)
      process.stdout.write(`Client ID: ${this.clientId}\n\n`)

      const tokenResult = await api.exchangeToken({
        code: receivedCode,
        codeVerifier: verifierString,
        redirectUri,
        clientId: this.clientId,
      })

      if (isError(tokenResult)) {
        process.stderr.write('[SDK Token Exchange Failed]\n')
        process.stderr.write(`Error: ${JSON.stringify(tokenResult.error, null, 2)}\n\n`)
      } else {
        process.stdout.write('[SDK Token Exchange Success]\n\n')
      }

      setTimeout(() => {
        serverRef.close()
        resolveAsyncResult(tokenResult)
      }, 1000)

      return c.html(`
        <html>
          <head>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white;
                padding: 3rem;
                border-radius: 1rem;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
              }
              h1 { color: #333; margin: 0 0 1rem 0; }
              p { color: #666; }
              .success { color: #10b981; font-size: 3rem; margin-bottom: 1rem; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✓</div>
              <h1>Authentication Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
            </div>
            <script>setTimeout(() => window.close(), 2000)</script>
          </body>
        </html>
      `)
    })

    serverRef = serve({
      fetch: app.fetch,
      port,
      hostname: 'localhost', // Bind to localhost specifically to match worker
    })

    // Confirm server is listening
    process.stdout.write(`[SDK Local Server] Listening on port ${port}\n\n`)

    try {
      // Open browser for OAuth flow
      // better-auth OIDC provider endpoints
      const authUrl = new URL(`${APP_URL}/api/auth/oauth2/authorize`)
      authUrl.searchParams.append('client_id', this.clientId)
      authUrl.searchParams.append('redirect_uri', redirectUri)
      authUrl.searchParams.append('response_type', 'code')
      authUrl.searchParams.append('state', state)
      authUrl.searchParams.append('code_challenge', challengeString)
      authUrl.searchParams.append('code_challenge_method', 'S256')
      authUrl.searchParams.append('scope', 'openid profile email developer offline_access')

      process.stdout.write(`\nOpening browser for authentication...\n`)
      process.stdout.write(`If browser doesn't open, visit:\n${authUrl.toString()}\n\n`)

      await open(authUrl.toString())

      const tokenResult = await asyncResult

      if (isError(tokenResult)) {
        return tokenResult
      }

      const token = tokenResult.value as unknown as TokenResponse

      process.stdout.write('🔑 Saving authentication token to keychain\n')

      const keychainToken: KeychainToken = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        // token_type: token.token_type,
        token_type: 'Bearer',
        expires_at: Date.now() + token.expires_in * 1000,
      }

      const saveResult = await getKeychain().save(keychainToken)

      if (isError(saveResult)) {
        return {
          success: false,
          error: { code: 'KEYCHAIN_ERROR', error: saveResult.error },
        }
      }

      this.scheduleRefresh(keychainToken)
      return { success: true, value: token.access_token }
    } finally {
      serverRef.close()
    }
  }

  /**
   * Schedule automatic token refresh before expiration
   */
  private scheduleRefresh(token: KeychainToken): void {
    if (this.refreshTimeout !== null) {
      clearTimeout(this.refreshTimeout)
    }

    // Refresh at 90% of token lifetime
    const delay = Math.min(Math.max(0, (token.expires_at - Date.now()) * 0.9), MAX_TIMEOUT)

    this.refreshTimeout = setTimeout(async () => {
      if (this.isRefreshingToken) {
        return
      }

      this.isRefreshingToken = true

      try {
        await this.refreshToken(token)
      } finally {
        this.isRefreshingToken = false
        this.refreshTimeout = null
      }
    }, delay)
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshToken(token: KeychainToken): Promise<void> {
    const refreshTokenResult = await api.refreshToken({
      refreshToken: token.refresh_token,
      clientId: this.clientId,
    })

    if (isErrored(refreshTokenResult)) {
      process.stderr.write('⚠️  Error refreshing token. Please log in again.\n')
      return
    }

    const refreshedToken = refreshTokenResult.value

    const keychainToken: KeychainToken = {
      access_token: refreshedToken.access_token,
      refresh_token: refreshedToken.refresh_token,
      token_type: refreshedToken.token_type as 'Bearer',
      expires_at: Date.now() + refreshedToken.expires_in * 1000,
    }

    const saveResult = await getKeychain().save(keychainToken)

    if (isError(saveResult)) {
      process.stderr.write('⚠️  Error saving refreshed token\n')
      return
    }

    this.scheduleRefresh(keychainToken)
  }

  /**
   * Log out user and clear stored credentials
   */
  async logout(): Promise<void> {
    if (this.refreshTimeout !== null) {
      clearTimeout(this.refreshTimeout)
      this.refreshTimeout = null
    }

    await getKeychain().delete()
  }
}

/** Singleton authenticator instance */
export const authenticator = new Authenticator()
