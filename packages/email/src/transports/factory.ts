// packages/lib/src/email/transports/factory.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
import { parseBoolean } from '../lib/utils'
import { createMailgunTransport } from './mailgun-transport'

const logger = createScopedLogger('email-transport')

/**
 * Factory to create a Nodemailer transporter based on configured provider
 */
export class TransportFactory {
  /**
   * Create a transporter for the configured provider
   */
  static create(): nodemailer.Transporter {
    const provider = configService.get<string>('EMAIL_PROVIDER') || 'smtp'

    switch (provider) {
      case 'ses':
        return TransportFactory.createSesTransport()
      case 'mailgun':
        return TransportFactory.createMailgunTransport()
      case 'smtp':
        return TransportFactory.createSmtpTransport()
      case 'sendmail':
        return TransportFactory.createSendmailTransport()
      default:
        throw new Error(`Unknown email provider: ${provider}`)
    }
  }

  /**
   * Create AWS SES transport using AWS SDK v3
   */
  private static createSesTransport(): nodemailer.Transporter {
    const region = configService.get<string>('AWS_REGION') || 'us-west-1'
    const accessKeyId =
      configService.get<string>('AWS_SES_ACCESS_KEY_ID') ||
      configService.get<string>('AWS_ACCESS_KEY_ID')
    const secretAccessKey =
      configService.get<string>('AWS_SES_SECRET_ACCESS_KEY') ||
      configService.get<string>('AWS_SECRET_ACCESS_KEY')

    const sesv2 = new SESv2Client({
      region,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    })

    logger.info('Creating SESv2 transporter', { region })

    return nodemailer.createTransport({
      SES: { sesClient: sesv2, SendEmailCommand },
    })
  }

  /**
   * Create Mailgun transport via custom implementation
   */
  private static createMailgunTransport(): nodemailer.Transporter {
    // Validate required environment variables
    const requiredVars = {
      MAILGUN_API_KEY: configService.get<string>('MAILGUN_API_KEY'),
      SYSTEM_FROM_EMAIL: configService.get<string>('SYSTEM_FROM_EMAIL'),
    }

    const missingVars = Object.entries(requiredVars)
      .filter(([_, value]) => !value)
      .map(([key, _]) => key)

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
    }

    // Derive sending domain from SYSTEM_FROM_EMAIL
    const fromEmail = configService.get<string>('SYSTEM_FROM_EMAIL')!
    const sendingDomain = fromEmail.split('@')[1]

    if (!sendingDomain) {
      throw new Error('Invalid SYSTEM_FROM_EMAIL: must contain a valid domain')
    }

    const auth = {
      api_key: configService.get<string>('MAILGUN_API_KEY'),
      domain: sendingDomain,
    }

    // Use MAILGUN_DOMAIN as the API host per repository convention
    const host =
      configService.get<string>('MAILGUN_DOMAIN') ||
      (configService.get<string>('MAILGUN_REGION') === 'eu'
        ? 'api.eu.mailgun.net'
        : 'api.mailgun.net')

    logger.info('Creating Mailgun transporter', { host, sendingDomain })

    const transport = createMailgunTransport({ auth, host })
    logger.info('Mailgun transport created successfully', { transportName: transport.name })

    return nodemailer.createTransport(transport as any)
  }

  /**
   * Create SMTP transport with connection pooling
   */
  private static createSmtpTransport(): nodemailer.Transporter {
    if (!configService.get<string>('SMTP_HOST'))
      throw new Error('SMTP_HOST is required for SMTP transport')

    const secureFlag = parseBoolean(configService.get<string>('SMTP_SECURE'))
    const explicitPort = configService.get<string>('SMTP_PORT')
      ? Number(configService.get<string>('SMTP_PORT'))
      : undefined
    let port = explicitPort ?? (secureFlag ? 465 : 587)
    const useImplicitTls = secureFlag === true

    if (useImplicitTls && port === 587) {
      logger.warn('SMTP secure mode requested on port 587; switching to implicit TLS port 465')
      port = 465
    }
    const requireTls = !useImplicitTls
    const transporter = nodemailer.createTransport({
      host: configService.get<string>('SMTP_HOST'),
      port,
      secure: useImplicitTls,
      requireTLS: requireTls,
      auth: configService.get<string>('SMTP_USER')
        ? {
            user: configService.get<string>('SMTP_USER'),
            pass: configService.get<string>('SMTP_PASS') || '',
          }
        : undefined,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      tls: { minVersion: 'TLSv1.2' },
    })

    logger.info('Creating SMTP transporter', {
      host: configService.get<string>('SMTP_HOST'),
      port,
      secure: useImplicitTls,
      mode: useImplicitTls ? 'implicit-tls' : 'starttls',
      requireTLS: requireTls,
    })
    return transporter
  }

  /**
   * Create local sendmail transport (development)
   */
  private static createSendmailTransport(): nodemailer.Transporter {
    logger.info('Creating sendmail transporter')
    return nodemailer.createTransport({
      sendmail: true,
      newline: 'unix',
      path: '/usr/sbin/sendmail',
    } as any)
  }
}
