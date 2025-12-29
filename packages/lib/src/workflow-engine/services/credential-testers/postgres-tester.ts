// packages/lib/src/workflow-engine/services/credential-testers/postgres-tester.ts

import type { CredentialTestResult } from '@auxx/workflow-nodes/types'

/**
 * PostgreSQL credential testing implementation
 */
export class PostgresTester {
  static async test(credentialData: Record<string, unknown>): Promise<CredentialTestResult> {
    const startTime = Date.now()

    try {
      const host = credentialData.host as string
      const port = credentialData.port as number
      const database = credentialData.database as string
      const user = credentialData.user as string
      const password = credentialData.password as string
      const sslMode = (credentialData.ssl as string) || 'prefer'

      if (!host || !database || !user || !password) {
        return {
          success: false,
          message: 'Missing required PostgreSQL credentials',
          error: {
            type: 'VALIDATION_ERROR',
            message: 'Host, database, user, and password are required',
          },
        }
      }

      // Import pg dynamically (it might not be installed in all environments)
      let Client
      try {
        const pg = await import('pg')
        Client = pg.Client
      } catch (importError) {
        return {
          success: false,
          message: 'PostgreSQL client library not available',
          error: {
            type: 'UNKNOWN_ERROR',
            message:
              'pg library is not installed. Please install it to test PostgreSQL connections.',
          },
        }
      }

      const client = new Client({
        host,
        port: port || 5432,
        database,
        user,
        password,
        ssl: sslMode !== 'disable' ? { rejectUnauthorized: sslMode === 'require' } : false,
        connectionTimeoutMillis: 10000,
      })

      await client.connect()

      // Test basic query to verify connection works
      const result = await client.query(
        'SELECT version() as version, current_database() as database'
      )
      const connectionTime = Date.now() - startTime

      await client.end()

      const serverVersion = result.rows[0]?.version || 'PostgreSQL'
      const currentDatabase = result.rows[0]?.database || database

      return {
        success: true,
        message: 'PostgreSQL connection successful',
        details: {
          connectionTime,
          serverInfo: `${serverVersion} - Database: ${currentDatabase}`,
          permissions: ['read', 'write'], // Basic assumption, could be enhanced
        },
      }
    } catch (error: any) {
      const connectionTime = Date.now() - startTime

      return {
        success: false,
        message: 'PostgreSQL connection failed',
        details: {
          connectionTime,
        },
        error: {
          type: PostgresTester.categorizeDbError(error),
          message: error.message || 'Database connection error',
          code: error.code,
        },
      }
    }
  }

  /**
   * Categorize PostgreSQL errors for better user feedback
   */
  private static categorizeDbError(error: any): CredentialTestResult['error']['type'] {
    const code = error.code || ''
    const message = error.message?.toLowerCase() || ''

    // Connection errors
    if (code === 'ENOTFOUND' || message.includes('getaddrinfo notfound')) {
      return 'CONNECTION_ERROR'
    }
    if (code === 'ECONNREFUSED' || message.includes('connection refused')) {
      return 'CONNECTION_ERROR'
    }
    if (code === 'ETIMEDOUT' || message.includes('timeout')) {
      return 'TIMEOUT_ERROR'
    }

    // Authentication errors
    if (code === '28P01' || code === '28000') {
      // Invalid password / auth method
      return 'AUTH_ERROR'
    }
    if (message.includes('authentication') || message.includes('password')) {
      return 'AUTH_ERROR'
    }

    // Permission errors
    if (code === '42501') {
      // Insufficient privileges
      return 'PERMISSION_ERROR'
    }
    if (message.includes('permission') || message.includes('access')) {
      return 'PERMISSION_ERROR'
    }

    // Database not found
    if (code === '3D000') {
      // Invalid database name
      return 'VALIDATION_ERROR'
    }

    // SSL/TLS errors
    if (message.includes('ssl') || message.includes('tls')) {
      return 'CONNECTION_ERROR'
    }

    return 'UNKNOWN_ERROR'
  }
}
