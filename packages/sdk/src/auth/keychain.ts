// packages/sdk/src/auth/keychain.ts

import { z } from 'zod'
import type { Result } from '../types/result.js'
import { isError } from '../types/result.js'

/** Token structure matching better-auth OAuth token response */
const authTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_at: z.number(),
  /** Better-auth session token if available */
  session_token: z.string().optional(),
})

export type KeychainToken = z.infer<typeof authTokenSchema>

export type KeychainError =
  | { code: 'KEYCHAIN_LOAD_ERROR'; error: unknown }
  | { code: 'KEYCHAIN_SAVE_ERROR'; error: unknown }
  | { code: 'KEYCHAIN_DELETE_ERROR'; error: unknown }

const SERVICE_NAME = 'auxx-cli'
const ACCOUNT_NAME = 'default'

/**
 * Keychain manager for secure token storage
 * Uses the system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
 */
class KeytarKeychain {
  private keytarPromise: Promise<typeof import('@postman/node-keytar')>

  constructor() {
    // @postman/node-keytar uses CommonJS (module.exports), so when imported as ESM
    // the exports are wrapped in a 'default' property. We need to unwrap it.
    this.keytarPromise = import('@postman/node-keytar').then((module) => {
      // Handle both ESM (has default) and direct CommonJS imports
      return (module as any).default || module
    })
  }

  /**
   * Load stored authentication token from keychain
   */
  async load(): Promise<Result<KeychainToken | null, KeychainError>> {
    const keytar = await this.keytarPromise

    let unparsedToken: string | null = null

    try {
      unparsedToken = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'KEYCHAIN_LOAD_ERROR',
          error,
        },
      }
    }

    if (unparsedToken === null) {
      return { success: true, value: null }
    }

    let jsonToken: unknown

    try {
      jsonToken = JSON.parse(unparsedToken)
    } catch {
      // Invalid JSON - delete the corrupted entry
      const deleteResult = await this.delete()
      if (isError(deleteResult)) {
        return {
          success: false,
          error: {
            code: 'KEYCHAIN_LOAD_ERROR',
            error: deleteResult.error,
          },
        }
      }
      console.debug('Wiped keychain entry due to invalid JSON')
      return { success: true, value: null }
    }

    const parsedToken = authTokenSchema.safeParse(jsonToken)

    if (!parsedToken.success) {
      // Schema mismatch - delete the invalid entry
      const deleteResult = await this.delete()
      if (isError(deleteResult)) {
        return {
          success: false,
          error: {
            code: 'KEYCHAIN_LOAD_ERROR',
            error: deleteResult.error,
          },
        }
      }
      console.debug('Wiped keychain entry due to schema mismatch')
      return { success: true, value: null }
    }

    // Check if token is expired (with 5 minute buffer)
    if (parsedToken.data.expires_at < Date.now() + 60_000 * 5) {
      const deleteResult = await this.delete()
      if (isError(deleteResult)) {
        return {
          success: false,
          error: {
            code: 'KEYCHAIN_LOAD_ERROR',
            error: deleteResult.error,
          },
        }
      }
      console.debug('Wiped keychain entry due to token expiration')
      return { success: true, value: null }
    }

    return { success: true, value: parsedToken.data }
  }

  /**
   * Save authentication token to keychain
   */
  async save(token: KeychainToken): Promise<Result<void, KeychainError>> {
    const keytar = await this.keytarPromise

    try {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(token))
      return { success: true, value: undefined }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'KEYCHAIN_SAVE_ERROR',
          error,
        },
      }
    }
  }

  /**
   * Delete authentication token from keychain
   */
  async delete(): Promise<Result<void, KeychainError>> {
    const keytar = await this.keytarPromise

    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
      return { success: true, value: undefined }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'KEYCHAIN_DELETE_ERROR',
          error,
        },
      }
    }
  }
}

/**
 * Test keychain for testing environment
 * Always returns a valid token
 */
class TestKeychain {
  private TEST_TOKEN: KeychainToken = {
    access_token: 'TEST',
    refresh_token: 'TEST',
    token_type: 'Bearer',
    expires_at: Number.MAX_SAFE_INTEGER,
  }

  async save(_token: KeychainToken): Promise<Result<void, KeychainError>> {
    return { success: true, value: undefined }
  }

  async load(): Promise<Result<KeychainToken | null, KeychainError>> {
    return { success: true, value: this.TEST_TOKEN }
  }

  async delete(): Promise<Result<void, KeychainError>> {
    return { success: true, value: undefined }
  }
}

let keychainInstance: KeytarKeychain | TestKeychain | null = null

/**
 * Get singleton keychain instance
 */
export function getKeychain(): KeytarKeychain | TestKeychain {
  if (keychainInstance === null) {
    keychainInstance =
      process.env.NODE_ENV === 'test' ? new TestKeychain() : new KeytarKeychain()
  }
  return keychainInstance
}
