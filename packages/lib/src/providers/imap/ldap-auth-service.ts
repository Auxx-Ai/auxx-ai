// packages/lib/src/providers/imap/ldap-auth-service.ts

import { createScopedLogger } from '@auxx/logger'
import ldap from 'ldapjs'
import { BadRequestError, UnauthorizedError } from '../../errors'
import { LDAP_TIMEOUT_MS } from './constants'
import type { ImapCredentialData } from './types'

const logger = createScopedLogger('ldap-auth')

export interface LdapUserInfo {
  dn: string
  email: string
  username: string
  displayName?: string
}

export class LdapAuthService {
  /**
   * Verify credentials against LDAP directory.
   * 1. Bind with service account (bindDN/bindPassword)
   * 2. Search for user by email
   * 3. Re-bind as the found user to verify their password
   */
  async verifyCredentials(
    ldapConfig: NonNullable<ImapCredentialData['ldap']>,
    userEmail: string,
    userPassword: string
  ): Promise<LdapUserInfo> {
    const client = ldap.createClient({
      url: ldapConfig.url,
      timeout: LDAP_TIMEOUT_MS,
      connectTimeout: LDAP_TIMEOUT_MS,
      tlsOptions: {
        rejectUnauthorized: !ldapConfig.allowUnauthorizedCerts,
      },
    })

    try {
      // Step 1: Bind with service account
      await this.bind(client, ldapConfig.bindDN, ldapConfig.bindPassword)

      // Step 2: Search for user entry
      const searchFilter = ldapConfig.searchFilter.replace(
        '{{email}}',
        this.escapeLdapFilter(userEmail)
      )

      const userEntry = await this.searchUser(client, ldapConfig.searchBase, searchFilter, [
        ldapConfig.usernameAttribute,
        ldapConfig.emailAttribute,
        'cn',
        'displayName',
      ])

      if (!userEntry) {
        throw new UnauthorizedError(`User not found in LDAP directory: ${userEmail}`)
      }

      // Step 3: Re-bind as the user to verify password
      await this.bind(client, userEntry.dn, userPassword)

      const email = this.getAttribute(userEntry, ldapConfig.emailAttribute) || userEmail
      const username = this.getAttribute(userEntry, ldapConfig.usernameAttribute) || email
      const displayName =
        this.getAttribute(userEntry, 'displayName') || this.getAttribute(userEntry, 'cn')

      logger.info('LDAP authentication successful', { email, username })

      return { dn: userEntry.dn, email, username, displayName }
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error
      throw this.parseLdapError(error)
    } finally {
      client.unbind(() => {})
      client.destroy()
    }
  }

  /**
   * Test LDAP connection without user authentication.
   * Verifies service account can bind and search base is accessible.
   */
  async testConnection(
    ldapConfig: NonNullable<ImapCredentialData['ldap']>
  ): Promise<{ success: boolean; message: string }> {
    const client = ldap.createClient({
      url: ldapConfig.url,
      timeout: LDAP_TIMEOUT_MS,
      connectTimeout: LDAP_TIMEOUT_MS,
      tlsOptions: {
        rejectUnauthorized: !ldapConfig.allowUnauthorizedCerts,
      },
    })

    try {
      await this.bind(client, ldapConfig.bindDN, ldapConfig.bindPassword)
      return { success: true, message: 'LDAP connection successful' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LDAP error'
      return { success: false, message }
    } finally {
      client.unbind(() => {})
      client.destroy()
    }
  }

  private bind(client: ldap.Client, dn: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private searchUser(
    client: ldap.Client,
    base: string,
    filter: string,
    attributes: string[]
  ): Promise<ldap.SearchEntry | null> {
    return new Promise((resolve, reject) => {
      client.search(base, { filter, scope: 'sub', attributes, sizeLimit: 1 }, (err, res) => {
        if (err) return reject(err)

        let found: ldap.SearchEntry | null = null

        res.on('searchEntry', (entry) => {
          found = entry
        })

        res.on('error', (searchErr) => reject(searchErr))
        res.on('end', () => resolve(found))
      })
    })
  }

  private getAttribute(entry: ldap.SearchEntry, name: string): string | undefined {
    const attr = entry.attributes?.find((a) => a.type.toLowerCase() === name.toLowerCase())
    if (!attr) return undefined
    const vals = attr.values
    return Array.isArray(vals) ? vals[0] : String(vals)
  }

  private escapeLdapFilter(value: string): string {
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00')
  }

  private parseLdapError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new BadRequestError('Unknown LDAP error')
    }

    const ldapError = error as { code?: number; name?: string }

    // Invalid credentials (LDAP result code 49)
    if (ldapError.code === 49 || ldapError.name === 'InvalidCredentialsError') {
      return new UnauthorizedError(`LDAP authentication failed: ${error.message}`)
    }

    if (ldapError.name === 'ConnectionError' || ldapError.code === -1) {
      return new BadRequestError(`LDAP connection failed: ${error.message}`)
    }

    if (ldapError.name === 'TimeoutError') {
      return new BadRequestError(`LDAP timeout: ${error.message}`)
    }

    return new BadRequestError(`LDAP error: ${error.message}`)
  }
}
