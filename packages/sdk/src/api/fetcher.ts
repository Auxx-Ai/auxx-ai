// packages/sdk/src/api/fetcher.ts

import type { z } from 'zod'
import { authenticator } from '../auth/auth.js'
import { API } from '../env.js'
import type { FetcherError } from '../errors.js'
import type { Result } from '../types/result.js'
import { isError } from '../types/result.js'

interface FetchOptions<T> {
  path: string
  schema: z.ZodSchema<T>
  authenticated?: 'Authenticated' | 'Not Authenticated'
  headers?: Record<string, string>
}

interface GetOptions<T> extends FetchOptions<T> {}

interface PostOptions<T> extends FetchOptions<T> {
  body: any
}

/**
 * HTTP client for API requests with automatic authentication
 */
export class Fetcher {
  /**
   * Perform GET request
   */
  async get<T>(options: GetOptions<T>): Promise<Result<T, FetcherError>> {
    return this.fetch({
      method: 'GET',
      ...options,
      headers: options.headers || {},
    })
  }

  /**
   * Perform POST request
   */
  async post<T>(options: PostOptions<T>): Promise<Result<T, FetcherError>> {
    return this.fetch({
      method: 'POST',
      path: options.path,
      body: options.body,
      schema: options.schema,
      authenticated: options.authenticated,
      headers: options.headers || {},
    })
  }

  /**
   * Internal fetch implementation with authentication and error handling
   */
  private async fetch<T>({
    method,
    path,
    body,
    schema,
    authenticated = 'Authenticated',
    headers: customHeaders = {},
  }: {
    method: 'GET' | 'POST'
    path: string
    body?: any
    schema: z.ZodSchema<T>
    authenticated?: 'Authenticated' | 'Not Authenticated'
    headers?: Record<string, string>
  }): Promise<Result<T, FetcherError>> {
    try {
      const headers: Record<string, string> = {
        'x-auxx-platform': 'developer-cli',
        'Content-Type': 'application/json',
        ...customHeaders,
      }

      // Add authentication if required
      if (authenticated === 'Authenticated') {
        const tokenResult = await authenticator.ensureAuthed()

        if (isError(tokenResult)) {
          return {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              error: tokenResult.error,
            },
          }
        }

        headers['Authorization'] = `Bearer ${tokenResult.value}`
      }

      // Override Content-Type for URLSearchParams
      const finalHeaders = {
        ...headers,
        ...(body instanceof URLSearchParams
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      }

      const url = path.startsWith('http') ? path : `${API}${path}`

      // Debug logging for token exchange
      if (path.includes('/oauth2/token')) {
        process.stdout.write('[Fetcher Debug]\n')
        process.stdout.write(`URL: ${url}\n`)
        process.stdout.write(`Method: ${method}\n`)
        if (body instanceof URLSearchParams) {
          process.stdout.write(`Body params:\n`)
          body.forEach((value, key) => {
            const displayValue = value.length > 20 ? value.substring(0, 20) + '...' : value
            process.stdout.write(`  ${key}: ${displayValue}\n`)
          })
        }
        process.stdout.write('\n')
      }

      const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: body ? (body instanceof URLSearchParams ? body : JSON.stringify(body)) : undefined,
      })

      if (!response.ok) {
        const bodyText = await response.text().catch(() => undefined)

        // Debug logging for failed requests
        // process.stderr.write('\n[Fetcher Error]\n')
        // process.stderr.write(`URL: ${url}\n`)
        // process.stderr.write(`Method: ${method}\n`)
        // process.stderr.write(`Status: ${response.status} ${response.statusText}\n`)
        // if (bodyText) {
        //   process.stderr.write(`Response Body: ${bodyText}\n`)
        // }
        // process.stderr.write('\n')

        return {
          success: false,
          error: {
            code: 'HTTP_ERROR',
            status: response.status,
            statusText: response.statusText,
            body: bodyText,
          },
        }
      }

      const data = await response.json()

      // Validate response with schema
      const parseResult = schema.safeParse(data)

      if (!parseResult.success) {
        // Debug logging for validation errors
        process.stderr.write('\n[Fetcher Validation Error]\n')
        process.stderr.write(`URL: ${url}\n`)
        process.stderr.write(`Method: ${method}\n`)
        process.stderr.write(`Response data: ${JSON.stringify(data, null, 2)}\n`)
        process.stderr.write(
          `Validation errors: ${JSON.stringify(parseResult.error.issues, null, 2)}\n`
        )
        process.stderr.write('\n')

        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            error: parseResult.error,
          },
        }
      }

      return { success: true, value: parseResult.data }
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error: {
            code: 'NETWORK_ERROR',
            error,
          },
        }
      }

      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          error: new Error(String(error)),
        },
      }
    }
  }
}
