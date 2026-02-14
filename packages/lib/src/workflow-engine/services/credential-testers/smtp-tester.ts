// packages/lib/src/workflow-engine/services/credential-testers/smtp-tester.ts

import type { CredentialTestResult } from '@auxx/workflow-nodes/types'
import nodemailer from 'nodemailer'

/**
 * SMTP credential testing implementation
 */
export class SmtpTester {
  static async test(credentialData: Record<string, unknown>): Promise<CredentialTestResult> {
    const startTime = Date.now()

    try {
      const host = credentialData.host as string
      const port = credentialData.port as number
      const username = credentialData.username as string
      const password = credentialData.password as string
      const secure = credentialData.secure as boolean
      const ignoreTLS = credentialData.ignoreTLS as boolean

      if (!host || !port || !username || !password) {
        return {
          success: false,
          message: 'Missing required SMTP credentials',
          error: {
            type: 'VALIDATION_ERROR',
            message: 'Host, port, username, and password are required',
          },
        }
      }

      // Create transporter with credential data
      const transporter = nodemailer.createTransporter({
        host,
        port,
        secure,
        auth: {
          user: username,
          pass: password,
        },
        // Security and timeout settings
        tls: {
          rejectUnauthorized: !ignoreTLS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      })

      // Verify connection
      await transporter.verify()

      const connectionTime = Date.now() - startTime

      // Get server info from the transporter if available
      const serverInfo = `${host}:${port} (${secure ? 'TLS' : 'No TLS'})`

      return {
        success: true,
        message: 'SMTP connection successful',
        details: {
          connectionTime,
          serverInfo,
          permissions: ['send-email'], // SMTP allows sending emails
        },
      }
    } catch (error: any) {
      const connectionTime = Date.now() - startTime

      return {
        success: false,
        message: 'SMTP connection failed',
        details: {
          connectionTime,
        },
        error: {
          type: SmtpTester.categorizeSmtpError(error),
          message: error.message || 'Unknown SMTP error',
          code: error.code,
        },
      }
    }
  }

  /**
   * Categorize SMTP errors for better user feedback
   */
  private static categorizeSmtpError(error: any): CredentialTestResult['error']['type'] {
    const message = error.message?.toLowerCase() || ''
    const code = error.code?.toLowerCase() || ''

    // Connection errors
    if (code.includes('enotfound') || message.includes('getaddrinfo notfound')) {
      return 'CONNECTION_ERROR'
    }
    if (code.includes('econnrefused') || message.includes('connection refused')) {
      return 'CONNECTION_ERROR'
    }
    if (code.includes('etimedout') || message.includes('timeout')) {
      return 'TIMEOUT_ERROR'
    }

    // Authentication errors
    if (message.includes('auth') || message.includes('login') || code.includes('auth')) {
      return 'AUTH_ERROR'
    }
    if (message.includes('invalid credentials') || message.includes('authentication failed')) {
      return 'AUTH_ERROR'
    }
    if (message.includes('username') || message.includes('password')) {
      return 'AUTH_ERROR'
    }

    // Permission/security errors
    if (message.includes('permission') || message.includes('access denied')) {
      return 'PERMISSION_ERROR'
    }
    if (message.includes('tls') || message.includes('ssl')) {
      return 'CONNECTION_ERROR'
    }

    // Quota errors (less common for SMTP testing)
    if (message.includes('quota') || message.includes('limit exceeded')) {
      return 'QUOTA_ERROR'
    }

    return 'UNKNOWN_ERROR'
  }
}
